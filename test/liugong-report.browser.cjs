const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { vehicles } = require('../api/src/lib/liugong/service');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || undefined});
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => sessionStorage.setItem('mining.auth.session.v1', JSON.stringify({token:'fixture'})));
    await page.route('**/integrations/liugong/vehicles?*', route => route.fulfill({json:{vehicles:vehicles(), rows:vehicles().map(v=>({serialNumber:v.trackerId,engineHours:4,workingHours:3,idleHours:1,fuelLitres:80,fuelRate:20,workPercent:75,idlePercent:25,daysReported:1})), notice:'Daily totals only.'}}));
    await page.goto((process.env.PERFORMANCE_BASE_URL || 'http://127.0.0.1:5174')+'/test/fixtures/liugong-report.html');
    await page.waitForFunction(()=>typeof window.checkLiuGong === 'function');
    const all = await page.evaluate(()=>window.checkLiuGong('All','All'));
    assert.equal(all.rows.length,28);
    assert.deepEqual(all.displayColumns,all.columns);
    assert.equal(all.rows[0]['Fuel (L)'],80);
    assert.equal((await page.evaluate(()=>window.checkLiuGong('site-wcl-sasti-ocm','Truck'))).rows.length,14);
    assert.equal((await page.evaluate(()=>window.checkLiuGong('site-wcl-gauri-pauni','Truck'))).rows.length,12);
    assert.equal((await page.evaluate(()=>window.checkLiuGong('site-wcl-sasti-ocm','HEMM'))).rows.length,2);
    const shift = await page.evaluate(()=>window.checkLiuGong('All','All','A'));
    assert.equal(shift.rows.length,0);
    assert.match(shift.notice,/daily totals/);
    console.log('LiuGong 28-machine report, site/category filters, columns and shift guard passed.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
