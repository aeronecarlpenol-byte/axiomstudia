const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('http://localhost:8043/**', route => route.fulfill({ contentType: 'text/html', body: '<button id="float">Float</button><script>document.getElementById("float").onclick=async()=>{try{window.pip=await documentPictureInPicture.requestWindow({width:320,height:210});window.pip.document.body.textContent="Timer only"}catch(e){window.pipError=e.message}}</script>' }));
    await page.goto('http://localhost:8043/');
    const supported = await page.evaluate(() => !!window.documentPictureInPicture?.requestWindow);
    if (!supported) { console.log('Document Picture-in-Picture unavailable in this Edge runtime.'); return; }
    await page.locator('#float').click();
    await page.waitForFunction(() => window.pip || window.pipError);
    const result = await page.evaluate(() => ({ opened: !!window.pip && !window.pip.closed, content: window.pip?.document.body.textContent, error: window.pipError }));
    assert.equal(result.error, undefined);
    assert.equal(result.opened, true);
    assert.equal(result.content, 'Timer only');
    console.log('Native Document Picture-in-Picture window opened outside the page.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
