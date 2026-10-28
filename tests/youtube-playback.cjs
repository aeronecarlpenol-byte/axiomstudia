const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const seed = {
  version: 16, userProfile: { theme: 'dark' },
  subjects: [{ id: 'math', code: 'MATH', name: 'Mathematics' }],
  tasks: [], topics: [], focusSessions: [],
  resources: [{ id: 'imported', subjectId: 'math', title: 'Imported lecture', type: 'link', url: 'https://youtube.com/live/M7lc1UVf-VE', lastPlaybackPosition: 120 }]
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    for (const mode of ['api', 'api-blocked', 'stalled']) {
      const page = await browser.newPage({ viewport: { width: 1365, height: 768 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'www.youtube.com' && url.pathname.startsWith('/embed/')) return route.fulfill({ contentType: 'text/html', body: '<button>Native YouTube controls</button>' });
        if (url.hostname !== 'axiom.test') return route.abort();
        const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
        return route.fulfill({ contentType, body: fs.readFileSync(file) });
      });
      await page.addInitScript(({ seed, mode }) => {
        if (window !== window.top) return;
        localStorage.setItem('axiom_studia_database_v16', JSON.stringify(seed));
        localStorage.setItem('axiom_studia_fresh_start_v1', 'done');
        const nativeSetTimeout = window.setTimeout.bind(window);
        const nativeClearTimeout = window.clearTimeout.bind(window);
        const pending = new Map();
        window.setTimeout = (fn, delay, ...args) => {
          const id = nativeSetTimeout(fn, delay, ...args);
          if (delay === 25000) pending.set(id, fn);
          return id;
        };
        window.clearTimeout = id => { pending.delete(id); nativeClearTimeout(id); };
        window.__expirePlayer = () => { for (const [id, fn] of [...pending]) { window.clearTimeout(id); fn(); } };
        if (mode !== 'api-blocked') window.YT = {
          PlayerState: { PAUSED: 2, ENDED: 0 },
          Player: class {
            constructor(element, options) {
              window.__options = options;
              if (mode !== 'stalled') nativeSetTimeout(() => options.events.onReady(), 0);
            }
            getCurrentTime() { return 125; }
            destroy() {}
          }
        };
      }, { seed, mode });
      await page.goto('http://axiom.test/#resources');
      await page.locator('[data-study-resource="imported"]').click();
      const iframe = page.locator('#ws-video-frame iframe');
      await iframe.waitFor();
      const src = new URL(await iframe.getAttribute('src'));
      assert.equal(src.origin + src.pathname, 'https://www.youtube.com/embed/M7lc1UVf-VE');
      assert.equal(src.searchParams.get('autoplay'), '0');
      assert.equal(src.searchParams.get('start'), '120');
      assert.equal(await iframe.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');
      assert.equal(await iframe.getAttribute('allowfullscreen'), '');
      assert.match(await iframe.getAttribute('allow'), /fullscreen/);
      if (mode === 'api') {
        for (const code of [101, 150, 100, 153]) {
          await page.waitForFunction(() => !!window.__options);
          await page.evaluate(code => window.__options.events.onError({ data: code }), code);
          await page.locator('#ws-video-error').waitFor({ state: 'visible' });
          assert.equal(await page.locator('#ws-video-error a').getAttribute('href'), 'https://www.youtube.com/watch?v=M7lc1UVf-VE');
          await page.locator('#ws-video-retry').click();
          await iframe.waitFor();
        }
      } else if (mode === 'stalled') {
        await page.waitForFunction(() => !!window.__options);
        await page.evaluate(() => window.__expirePlayer());
        await page.locator('#ws-video-error').waitFor({ state: 'visible' });
        assert.match(await page.locator('#ws-video-error p').innerText(), /not responding|did not load/);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('axiom_studia_database_v16')).resources[0].lastPlaybackPosition), 120);
      } else {
        await page.waitForFunction(() => !document.querySelector('script[src="https://www.youtube.com/iframe_api"]'));
        assert.equal(await iframe.isVisible(), true);
        assert.equal(await page.locator('#ws-video-error').isVisible(), false);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('YouTube regression passed: imported links, canonical iframe, no autoplay, permissions/referrer, 101/150/100/153 errors, retry, blocked API fallback, stalled player, saved progress.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
