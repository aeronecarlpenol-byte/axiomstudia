import { db } from './db.js';

export function parseYouTubeUrl(value) {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    let id = null;
    if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else if (/^\/(shorts|embed)\//.test(url.pathname)) id = url.pathname.split('/')[2];
    } else if (host === 'youtu.be' || host === 'www.youtu.be') {
      id = url.pathname.split('/')[1];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch (_) { return null; }
}

let apiPromise;
function getPlayerApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => reject(new Error('YouTube player could not load.'));
      document.head.append(script);
    }
    setTimeout(() => reject(new Error('YouTube player timed out.')), 15000);
  }).catch(error => { apiPromise = null; throw error; });
  return apiPromise;
}

export function mountYouTubeViewer(element, resource, onError) {
  let player = null;
  let interval = null;
  let disposed = false;
  let lastSaved = Number(resource.lastPlaybackPosition) || 0;
  const savePosition = (force = false) => {
    if (!player || typeof player.getCurrentTime !== 'function') return;
    let seconds;
    try { seconds = Math.floor(player.getCurrentTime()); } catch (_) { return; }
    if (!Number.isFinite(seconds) || seconds < 0 || (!force && Math.abs(seconds - lastSaved) < 10)) return;
    lastSaved = seconds;
    db.updateResource(resource.id, { lastPlaybackPosition: seconds, lastStudiedAt: new Date().toISOString() });
    db.recordStudyActivity({ type: 'youtube_watch', subjectId: resource.subjectId, resourceId: resource.id, playbackPosition: seconds, pdfFilename: null });
  };
  getPlayerApi().then(YT => {
    if (disposed || !element.isConnected) return;
    player = new YT.Player(element, {
      videoId: resource.videoId,
      playerVars: { start: Math.floor(Number(resource.lastPlaybackPosition) || 0), playsinline: 1, origin: window.location.origin },
      events: {
        onReady: () => { if (!disposed) interval = setInterval(() => savePosition(), 5000); },
        onStateChange: event => { if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) savePosition(true); },
        onError: () => onError('This YouTube video cannot be played inside Axiom Studia.')
      }
    });
  }).catch(() => { if (!disposed) onError('The YouTube player could not load. Check your connection and try again.'); });
  return () => {
    disposed = true;
    clearInterval(interval);
    savePosition(true);
    try { player?.destroy(); } catch (_) {}
  };
}
