const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const seed = {
  subjects: [
    {id:'math',code:'DE',name:'Differential Equations',color:'#8855ff'},
    {id:'circuits',code:'DC',name:'Elementary DC Circuits',color:'#8855ff'},
    {id:'physics',code:'EP2',name:'Engineering Physics 2',color:'#8855ff'}
  ], topics:[{id:'mesh',subjectId:'circuits',name:'Mesh Analysis'}], tasks:[],
  resources:[
    {id:'pdf-1',subjectId:'math',type:'pdf',title:'Chapter 1 Notes.pdf',pdfDataUrl:'data:application/pdf;base64,JVBERg==',customMetadata:{keep:true}},
    {id:'playlist-1',subjectId:'circuits',type:'playlist',title:'Circuit Analysis Playlist',url:'https://youtube.com/playlist?list=PL1234567890_abc',playlistId:'PL1234567890_abc',lastPlaylistIndex:2,lastPlaybackPosition:42},
    {id:'orphan',subjectId:'deleted-subject',type:'link',title:'Legacy link',url:'https://example.com'},
    {id:'unassigned',type:'pdf',title:'Old upload',pdfDataUrl:'data:application/pdf;base64,JVBERg=='}
  ]
};

(async () => {
  const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1365, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'axiom.test') return route.abort();
    const requestPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, '.' + requestPath);
    if (!file.startsWith(root) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
  });
  await page.addInitScript(data => {
    if (window !== window.top) return;
    if (!localStorage.getItem('axiom_studia_database_v16')) localStorage.setItem('axiom_studia_database_v16', JSON.stringify(data));
    localStorage.setItem('axiom_studia_fresh_start_v1', 'done');
    window.YT = {
      PlayerState: { PAUSED: 2, ENDED: 0 },
      Player: class {
        constructor(element, options) {
          window.__videoOptions = options;
          element.innerHTML = '<span>Player ready</span>';
          setTimeout(() => options.events.onReady(), 0);
        }
        getCurrentTime() { return 1125; }
        destroy() {}
      }
    };
    window['pdfjs-dist/build/pdf'] = {
      GlobalWorkerOptions: {},
      getDocument() { return { promise: Promise.resolve({
        numPages: 2,
        getPage: async () => ({
          getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
          render: () => ({ promise: Promise.resolve(), cancel() {} })
        })
      }) }; }
    };
  }, seed);
  try {
    await page.goto('http://axiom.test/#resources');
    const group = id => page.locator(`[data-subject-group="${id}"]`);
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('axiom_studia_database_v16')).resources);
    assert.equal(await page.locator('[data-subject-group]').count(),4);
    assert.equal(await group('__uncategorized__').locator('.resource-card').count(),2);
    assert.match(await group('physics').innerText(),/No resources yet/);
    assert.match(await group('circuits').locator('.library-count').textContent(),/1 resource/);
    assert.deepEqual(await stored(),seed.resources);
    await group('math').locator('summary').click();
    assert.equal(await group('math').getAttribute('open'),null);
    await group('math').locator('summary').press('Enter');
    assert.notEqual(await group('math').getAttribute('open'),null);
    await page.locator('#resource-search').fill('differential');
    assert.equal(await page.locator('[data-subject-group]').count(),1);
    await page.locator('#resource-search').fill('circuit analysis');
    assert.equal(await group('circuits').locator('.resource-card').count(),1);
    await page.locator('#resource-search').fill('nothing-matches');
    assert.match(await page.locator('#resource-library').textContent(),/No subjects or resources/);
    await page.locator('#resource-search').fill('');
    await page.locator('#resource-subject-filter').selectOption('circuits');
    assert.equal(await page.locator('[data-subject-group]').count(),1);
    await page.locator('#resource-subject-filter').selectOption('');
    await group('math').locator('[data-action="move-resource"]').click();
    await page.locator('#move-resource-subject').selectOption('circuits');
    await page.locator('#move-resource-form').evaluate(form=>form.requestSubmit());
    assert.equal(await group('circuits').locator('.resource-card').count(),2);
    const moved = (await stored()).find(r=>r.id==='pdf-1');
    assert.deepEqual(moved,{...seed.resources[0],subjectId:'circuits'});
    await page.reload();
    assert.equal(await group('circuits').locator('.resource-card').count(),2);
    await page.locator('#btn-add-resource').click();
    await page.locator('#res-title-input').fill('New notes');
    await page.locator('#res-url-input').fill('https://example.com/notes');
    await page.locator('#save-res-btn').click();
    assert.equal(await page.locator('#resource-modal').count(),1);
    assert.equal((await stored()).length,4);
    await page.locator('#res-subject').selectOption('circuits');
    assert.equal(await page.locator('[name="topicId"] option').count(),2);
    await page.locator('#res-subject').selectOption('math');
    assert.equal(await page.locator('[name="topicId"] option').count(),1);
    await page.locator('#save-res-btn').click();
    await page.locator('#resource-modal').waitFor({state:'detached'});
    assert.equal((await stored()).length,5);
    assert.match(await group('math').textContent(),/New notes/);
    // Upload uses IndexedDB, retains its ID when moved, and opens the saved blob.
    await page.locator('#btn-add-resource').click();
    await page.locator('#res-type-select').selectOption('pdf');
    await page.locator('#res-title-input').fill('Uploaded PDF');
    await page.locator('#res-subject').selectOption('math');
    await page.locator('#res-pdf-file').setInputFiles({name:'upload.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});
    await page.locator('#save-res-btn').click();
    await page.locator('#resource-modal').waitFor({state:'detached'});
    const uploaded=(await stored()).find(r=>r.title==='Uploaded PDF');
    assert.equal(uploaded.hasPdfFile,true);
    assert.equal(await page.evaluate(async id => {
      const {getPdfFromStorage}=await import('/js/pdfStorage.js');
      return (await getPdfFromStorage(id)).size;
    },uploaded.id),14);
    await page.reload();
    await group('math').locator(`[data-study-resource="${uploaded.id}"]`).click();
    await page.locator('#ws-pdf-page-num').waitFor();
    assert.match(await page.locator('.ws-studying-resource').textContent(),/Uploaded PDF/);
    await page.goto('http://axiom.test/#resources');
    await group('circuits').locator('[data-study-resource="playlist-1"]').click();
    await page.locator('#ws-youtube-player').waitFor();
    await page.goto('http://axiom.test/#resources');
    await group('__uncategorized__').locator('[data-study-resource="unassigned"]').click();
    await page.locator('#move-resource-subject').selectOption('math');
    await page.locator('#move-resource-form').evaluate(form=>form.requestSubmit());
    await page.locator('#ws-pdf-page-num').waitFor();
    await page.goto('http://axiom.test/#resources');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),true);
    await page.setViewportSize({width:1365,height:900});
    // A workspace without subjects offers guidance and cannot save unassigned records.
    await page.evaluate(async () => {
      const {db}=await import('/js/db.js'); db.data.subjects=[]; db.save();
    });
    await page.reload();
    assert.equal(await page.locator('[data-subject-group]').count(),1);
    await page.locator('#btn-add-resource').click();
    assert.match(await page.locator('#resource-modal').textContent(),/Create a subject/);
    assert.equal(await page.locator('#save-res-btn').isDisabled(),true);
    assert.deepEqual(errors,[]);
    console.log('Subject grouping, search, filters, required assignment, moves, PDF storage, viewer handoffs, refresh preservation, and mobile layout passed.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});

