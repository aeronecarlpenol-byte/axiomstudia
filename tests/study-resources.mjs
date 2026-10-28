import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const storage = new Map([['axiom_studia_database_v16', JSON.stringify({
  subjects: [{ id: 'math', code: 'MATH' }], tasks: [],
  resources: [{ id: 'legacy-pdf', type: 'pdf', title: 'Saved module', subjectId: 'math', pdfDataUrl: 'data:application/pdf;base64,JVBERg==' }]
})]]);
const context = vm.createContext({
  console, URL, Date,
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
    key: index => [...storage.keys()][index],
    get length() { return storage.size; }
  }
});
const dbSource = fs.readFileSync(new URL('../js/db.js', import.meta.url), 'utf8')
  .replace('export const db = new Database();', 'globalThis.db = new Database();');
vm.runInContext(dbSource, context);
assert.equal(context.db.getResources()[0].pdfDataUrl, 'data:application/pdf;base64,JVBERg==');

const youtubeSource = fs.readFileSync(new URL('../js/youtube.js', import.meta.url), 'utf8')
  .replace("import { db } from './db.js';", 'const db = globalThis.db;')
  .replace('export function parseYouTubeUrl', 'globalThis.parseYouTubeUrl = function parseYouTubeUrl')
  .replace('export function mountYouTubeViewer', 'globalThis.mountYouTubeViewer = function mountYouTubeViewer');
vm.runInContext(youtubeSource, context);
const id = 'dQw4w9WgXcQ';
for (const url of [
  `https://www.youtube.com/watch?v=${id}&t=42`,
  `https://youtu.be/${id}`,
  `https://youtube.com/shorts/${id}`,
  `https://youtube.com/live/${id}?si=share`,
  `https://www.youtube.com/embed/${id}`,
  `https://www.youtube-nocookie.com/embed/${id}`,
  `youtube.com/watch?v=${id}`,
  `youtu.be/${id}`,
  `www.youtube.com/live/${id}`
]) assert.equal(context.parseYouTubeUrl(url), id);
for (const url of [
  'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
  'https://evil.test/youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtube.com@evil.test/watch?v=dQw4w9WgXcQ',
  'https://user:password@youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtube.com:8080/watch?v=dQw4w9WgXcQ',
  'https://youtu.be/bad', 'javascript:alert(1)', '', '<iframe src="https://youtube.com"></iframe>',
  'https://youtube.com/live/dQw4w9WgXcQ/extra', 'https://youtu.be/dQw4w9WgXcQ/extra'
]) {
  assert.equal(context.parseYouTubeUrl(url), null);
}
const video = context.db.addResource({ title: 'Lecture', type: 'youtube', subjectId: 'math', videoId: id, lastPlaybackPosition: 1122 });
context.db.recordStudyActivity({ type: 'youtube_watch', subjectId: 'math', resourceId: video.id });
const destination = context.db.getContinueStudyingDestination();
assert.equal(destination.resource.id, video.id);
assert.equal(destination.playbackPosition, 1122);
assert.equal(destination.pdfFilename, null);
assert.equal(JSON.parse(storage.get('axiom_studia_database_v16')).resources.length, 2);
console.log('Study resource parsing, persistence, and legacy PDF compatibility passed.');
