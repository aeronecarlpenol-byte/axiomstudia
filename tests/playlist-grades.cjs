const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const list = 'PL1234567890_abc';
const seed = {
  subjects: [{id:'first',code:'FIRST'}, {id:'math',code:'MATH',name:'Mathematics',units:3,grades:{prelim:85,midterm:90,endterm:95},targetGrade:90}],
  tasks:[],resources:[{id:'old-pdf',subjectId:'math',type:'pdf',title:'Existing PDF',pdfDataUrl:'data:application/pdf;base64,JVBERg=='}],
  gradingSystem:{minimum:0,maximum:100,passing:75,direction:'higher',weights:{prelim:50,midterm:40,endterm:10}}
};
(async () => {
  const browser = await chromium.launch({executablePath:process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1365,height:900}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*', route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='www.youtube.com' && url.pathname.startsWith('/embed/')) return route.fulfill({contentType:'text/html',body:'<button>Native playlist controls</button>'});
      if(url.hostname!=='axiom.test') return route.abort();
      const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file)) return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
    });
    await page.addInitScript(({seed})=>{
      if(window!==window.top)return;
      if(!localStorage.getItem('playlist-test-seeded')) {
        localStorage.setItem('axiom_studia_database_v16',JSON.stringify(seed));
        localStorage.setItem('playlist-test-seeded','true');
      }
      window.YT={PlayerState:{PAUSED:2,ENDED:0,PLAYING:1},Player:class {
        constructor(el,options){this.options=options;this.index=options.playerVars.index||0;window.testPlayer=this;setTimeout(()=>options.events.onReady(),0);}
        getCurrentTime(){return 42;}
        getPlaylist(){return ['dQw4w9WgXcQ','M7lc1UVf-VE'];}
        getPlaylistIndex(){return this.index;}
        getVideoData(){return {video_id:this.getPlaylist()[this.index],title:`Lecture ${this.index+1}`};}
        nextVideo(){this.index=1;this.options.events.onStateChange({data:1});}
        previousVideo(){this.index=0;this.options.events.onStateChange({data:1});}
        destroy(){}
      }};
    },{seed});
    await page.goto('http://axiom.test/#grades');
    assert.equal(await page.locator('[data-avg-for="math"]').innerText(),'90.50');
    assert.match(await page.locator('[data-proj-note="math"]').innerText(),/93.75/);
    await page.locator('[data-sub-id="math"].tup-target-input').fill('95');
    assert.match(await page.locator('[data-proj-note="math"]').innerText(),/Target Unreachable/);
    await page.locator('[data-sub-id="math"].tup-target-input').fill('50');
    assert.match(await page.locator('[data-proj-note="math"]').innerText(),/Target Already Secured/);
    await page.locator('[data-sub-id="math"].tup-target-input').fill('90');
    await page.locator('[data-sub-id="math"][data-term="prelim"]').fill('');
    assert.match(await page.locator('[data-proj-note="math"]').innerText(),/Enter valid/);
    await page.locator('[data-sub-id="math"][data-term="prelim"]').fill('85.5');
    await page.locator('[data-sub-id="math"][data-term="midterm"]').fill('90.25');
    await page.locator('[data-sub-id="math"].tup-target-input').fill('90.1');
    assert.match(await page.locator('[data-proj-exact="math"]').textContent(),/93.4375/);
    await page.locator('[data-sub-id="math"][data-term="prelim"]').fill('bad');
    assert.match(await page.locator('[data-proj-note="math"]').innerText(),/Enter valid/);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('axiom_studia_database_v16')).subjects[1].grades.prelim),85.5);
    await page.evaluate(()=>sessionStorage.setItem('axiom_target_subject_id','math'));
    await page.goto('http://axiom.test/#subjects');
    await page.locator('#ws-choose-playlist').click();
    await page.locator('#ws-youtube-url').fill(`https://youtube.com/watch?v=dQw4w9WgXcQ&list=${list}`);
    await page.locator('#ws-youtube-form button[type="submit"]').click();
    await page.waitForFunction(()=>!document.querySelector('#ws-playlist-next').disabled);
    assert.equal(new URL(await page.locator('#ws-video-frame iframe').getAttribute('src')).searchParams.get('list'),list);
    await page.locator('#ws-playlist-next').click();
    assert.equal(await page.locator('#ws-current-video-title').innerText(),'Lecture 2');
    await page.reload();
    await page.waitForFunction(()=>window.testPlayer?.getPlaylistIndex()===1);
    assert.equal(new URL(await page.locator('#ws-video-frame iframe').getAttribute('src')).searchParams.get('start'),'42');
    await page.locator('#ws-playlist-prev').click();
    assert.equal(await page.locator('#ws-current-video-title').innerText(),'Lecture 1');
    await page.locator('#ws-change-resource').click();
    await page.locator('#ws-choose-playlist').click();
    await page.locator('#ws-youtube-url').fill(`https://youtube.com/playlist?list=${list}`);
    await page.locator('#ws-youtube-form button[type="submit"]').click();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('axiom_studia_database_v16')).resources.length),2);
    await page.locator('#ws-change-resource').click();
    await page.locator('#ws-resource-cancel').click();
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
    await page.locator('.ws-mobile-tab[data-tab="resources"]').click();
    await page.locator('.ws-resource-card').filter({hasText:'YouTube Playlist'}).click();
    await page.locator('#ws-video-frame iframe').waitFor();
    await page.evaluate(()=>window.testPlayer.options.events.onError({data:100}));
    assert.match(await page.locator('#ws-video-error p').innerText(),/unavailable, private, or deleted/);
    await page.evaluate(()=>{delete window.YT;});
    await page.locator('#ws-video-retry').click();
    await page.waitForFunction(()=>!document.querySelector('script[src="https://www.youtube.com/iframe_api"]'));
    assert.equal(await page.locator('#ws-video-frame iframe').isVisible(),true);
    assert.equal(await page.locator('#ws-playlist-next').isDisabled(),true);
    assert.deepEqual(errors,[]);
    console.log('Browser grades and playlists passed: fixed legacy weights, live targets, validation, exact decimals, navigation, titles, refresh/resume on second subject, deduplication, legacy PDF, mobile, and unavailable playlist.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
