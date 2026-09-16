const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
  try {
    const page = await browser.newPage();
    await page.clock.install({ time: new Date('2026-09-16T18:15:00+05:30') });
    let calls = 0;
    let limited = false;
    await page.route('**/integrations/volvo/driver-standstill?**', async route => {
      calls++;
      await route.fulfill(limited
        ? { status: 429, json: { message: 'limited', retryAfterSeconds: 120 } }
        : { json: { reportType: 'Driverwise Standstill Tracking', generatedAt: '2026-09-16T12:40:00Z', columns: ['Vehicles'], rows: [{ Vehicles: 'V-605' }] } });
    });
    await page.goto((process.env.PERFORMANCE_BASE_URL || 'http://127.0.0.1:5173') + '/test/fixtures/performance.html');
    await page.getByText('Reports ready', { exact: true }).waitFor();
    const fetchReport = (differentSite = false) => page.evaluate(async (differentSite) => {
      const a = window.testApi;
      return a.fetchVolvoDriverStandstillReport({ ...a.filters, ...(differentSite ? { siteId: 'site-wcl-dhoptala-ocm' } : {}) }, { forceRefresh: true });
    }, differentSite);
    const first = await fetchReport();
    limited = true;
    await page.evaluate(() => window.testApi.invalidateVolvoReportCache());
    const stale = await fetchReport();
    assert.equal(stale.generatedAt, first.generatedAt);
    assert.deepEqual(stale.rows, first.rows);
    assert.match(stale.notice, /previous report/);
    assert.equal(calls, 2);
    await fetchReport();
    assert.equal(calls, 2, 'force refresh must respect cooldown');
    const other = await fetchReport(true);
    assert.equal(other.error.kind, 'rate_limit');
    assert.deepEqual(other.rows, [], 'never reuse a different site report');
    assert.equal(calls, 2);
    await page.clock.fastForward(120001);
    limited = false;
    const fresh = await fetchReport();
    assert.equal(calls, 3);
    assert.equal(fresh.notice, undefined);
    await page.evaluate(() => sessionStorage.setItem('mining.auth.session.v1', JSON.stringify({ token: 'another-user' })));
    limited = true;
    const separate = await fetchReport();
    assert.equal(separate.error.kind, 'rate_limit');
    assert.deepEqual(separate.rows, []);
    console.log('Passed: cooldown, forced refresh, safe cached fallback, expiry, site and session isolation.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
