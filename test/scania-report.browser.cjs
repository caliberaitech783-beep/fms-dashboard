const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || undefined});
 try {
  const page = await browser.newPage({viewport:{width:1600,height:1000}});
  await page.goto((process.env.PERFORMANCE_BASE_URL || 'http://127.0.0.1:5173')+'/test/fixtures/scania-report.html');
  await page.getByText('Summary (70)',{exact:true}).waitFor();
  assert.equal(await page.locator('thead th').last().innerText(), 'Adjusted Idling (%)');
  assert.equal(await page.locator('thead').getByText(/Performance mode/).count(),0);
  assert.equal(await page.locator('tbody tr').first().locator('td').first().innerText(),'Summary (70)');
  await fs.mkdir('tmp/pdfs',{recursive:true});
  await page.screenshot({path:'tmp/pdfs/scania-screen.png'});
  for(const format of ['Csv','Excel','Pdf']) {
   const download = page.waitForEvent('download');
   await page.getByRole('button',{name:format,exact:true}).click();
   const d = await download;
   const file = 'tmp/pdfs/'+d.suggestedFilename(); await d.saveAs(file);
   if(format !== 'Pdf') {
    const contents = await fs.readFile(file,'utf8');
    assert.ok(contents.includes('Summary (70)'));
    assert.ok(contents.includes('Adjusted Idling (%)'));
    assert.ok(!contents.includes('Performance mode - Power'));
   }
  }
  console.log('Scania screen, CSV, Excel and PDF downloads verified; QA artifacts in tmp/pdfs.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
