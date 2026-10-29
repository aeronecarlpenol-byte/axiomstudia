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

seed.resources = Array.from({length:40}, (_,i)=>({id:'r'+i,subjectId:'math',type:'notes',title:'Resource '+i+' '+ 'Long title '.repeat(8)}));
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
    for (const [width,height] of [[1365,768],[1024,600],[820,1180],[390,844],[320,568]]) {
      await page.setViewportSize({width,height});
      await page.goto('http://axiom.test/#subjects');
      if(width<=900) await page.locator('[data-tab="resources"]').click();
      const grid=page.locator('.ws-resource-compact-grid');
      await grid.scrollIntoViewIfNeeded();
      const metrics=await grid.evaluate(el=>{el.scrollTop=el.scrollHeight; return {scroll:el.scrollTop,overflow:el.scrollHeight-el.clientHeight,card:el.lastElementChild.getBoundingClientRect().height};});
      assert(metrics.scroll>0, `${width}: resources must scroll: ${JSON.stringify(metrics)}`);
      assert(metrics.card>60, `${width}: cards must not shrink and clip`);
      await page.locator('[data-resource-id="r39"]').scrollIntoViewIfNeeded();
      const bounds=await page.locator('[data-resource-id="r39"]').boundingBox();
      assert(bounds.y+bounds.height<=height+1, `${width}: last resource clipped below viewport`);
      assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),`${width}: horizontal overflow`);
      console.log(`Workspace scroll passed ${width}x${height}`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
