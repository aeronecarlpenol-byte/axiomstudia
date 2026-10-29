import { db } from './db.js';

export function parseYouTubeResource(value) {
  try {
    let input = value.trim();
    if (/^(?:(?:www|m)\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(input)) input = `https://${input}`;
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) return null;
    const videoId = parseYouTubeUrl(input);
    if (url.searchParams.has('list')) {
      if (!['/playlist', '/watch', '/embed', '/embed/videoseries'].includes(url.pathname) && !videoId) return null;
      const playlistId = url.searchParams.get('list');
      if (!/^[A-Za-z0-9_-]{10,100}$/.test(playlistId || '')) return null;
      const index = Number(url.searchParams.get('index'));
      return { type: 'youtube', playlistId, videoId, playlistIndex: Number.isInteger(index) && index > 0 ? index - 1 : 0,
        url: `https://www.youtube.com/playlist?list=${playlistId}` };
    }
    return videoId ? { type: 'youtube', videoId, url: `https://www.youtube.com/watch?v=${videoId}` } : null;
  } catch (_) { return null; }
}

export function parseYouTubeUrl(value) {
  try {
    let input = value.trim();
    if (/^(?:(?:www|m)\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(input)) input = `https://${input}`;
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let id = null;
    if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else if (/^\/(shorts|live|embed)\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) id = url.pathname.split('/')[2];
    } else if (host === 'youtu.be' || host === 'www.youtu.be') {
      if (/^\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) id = url.pathname.split('/')[1];
    } else if (host === 'youtube-nocookie.com' || host === 'www.youtube-nocookie.com') {
      if (/^\/embed\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) id = url.pathname.split('/')[2];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch (_) { return null; }
}

let apiPromise;
function getPlayerApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]') || document.createElement('script');
    const finish = error => {
      clearTimeout(timeout);
      script.removeEventListener('error', failed);
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous;
      if (error) { script.remove(); reject(error); }
      else resolve(window.YT);
    };
    const ready = () => {
      finish();
      if (typeof previous === 'function') previous();
    };
    const failed = () => finish(new Error('YouTube player could not load.'));
    const timeout = setTimeout(() => finish(new Error('YouTube player timed out.')), 15000);
    window.onYouTubeIframeAPIReady = ready;
    script.addEventListener('error', failed);
    if (!script.isConnected) {
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.append(script);
    }
  }).catch(error => { apiPromise = null; throw error; });
  return apiPromise;
}

export function mountYouTubeViewer(element, resource, onError, controls = {}) {
  const parsed = parseYouTubeResource(resource.url || resource.youtubeUrl || '');
  const playlistId = parsed?.playlistId || (/^[A-Za-z0-9_-]{10,100}$/.test(resource.playlistId || '') ? resource.playlistId : null);
  const videoId = (playlistId ? resource.lastVideoId : null) || parseYouTubeUrl(resource.url || resource.youtubeUrl || '') ||
    (/^[A-Za-z0-9_-]{11}$/.test(resource.videoId || '') ? resource.videoId : null);
  if (!videoId && !playlistId) {
    onError('This YouTube link is invalid. Choose another YouTube video link.');
    return () => {};
  }
  let player = null;
  let interval = null;
  let disposed = false;
  let ready = false;
  let failed = false;
  let readyTimeout = null;
  const start = Math.max(0, Math.floor(Number(resource.lastPlaybackPosition) || 0));
  const iframe = document.createElement('iframe');
  iframe.id = element.id;
  iframe.className = element.className;
  iframe.title = resource.title ? `YouTube: ${resource.title}` : 'YouTube video player';
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  const url = new URL(`https://www.youtube.com/embed/${videoId || 'videoseries'}`);
  url.search = new URLSearchParams({ enablejsapi: '1', autoplay: '0', controls: '1', fs: '1', playsinline: '1', start: String(start) });
  if (playlistId) {
    url.searchParams.set('listType', 'playlist');
    url.searchParams.set('list', playlistId);
    url.searchParams.set('index', String(resource.lastPlaylistIndex ?? resource.playlistIndex ?? parsed?.playlistIndex ?? 0));
  }
  if (['http:', 'https:'].includes(window.location.protocol)) url.searchParams.set('origin', window.location.origin);
  const fail = message => {
    if (disposed || failed) return;
    failed = true;
    clearTimeout(loadTimeout);
    clearTimeout(readyTimeout);
    clearInterval(interval);
    onError(message);
  };
  const loadTimeout = setTimeout(() => fail('YouTube did not load. Check your connection or content blocker, try again, or open this video on YouTube.'), 25000);
  const loaded = () => clearTimeout(loadTimeout);
  const frameError = () => fail('The YouTube player was blocked or could not load. Try again or open this video on YouTube.');
  const policyBlocked = event => {
    if (event.effectiveDirective === 'frame-src' && event.blockedURI?.startsWith('https://www.youtube.com')) frameError();
  };
  iframe.addEventListener('load', loaded);
  iframe.addEventListener('error', frameError);
  document.addEventListener('securitypolicyviolation', policyBlocked);
  // Load the native player immediately; the API adds progress tracking and error events.
  iframe.src = url.href;
  element.replaceWith(iframe);
  let lastSaved = Number(resource.lastPlaybackPosition) || 0;
  let lastVideoId = resource.lastVideoId || videoId;
  const updateControls = () => {
    if (!ready || !player) return;
    const data = player.getVideoData?.();
    if (data?.title && controls.title) controls.title.textContent = data.title;
    for (const button of [controls.previous, controls.next]) if (button) button.disabled = !player.getPlaylist?.()?.length;
  };
  const navigate = method => { if (ready && !failed) { savePosition(true); player?.[method]?.(); } };
  const previous = () => navigate('previousVideo');
  const next = () => navigate('nextVideo');
  controls.previous?.addEventListener('click', previous);
  controls.next?.addEventListener('click', next);
  const savePosition = (force = false) => {
    if (!ready || failed || !player || typeof player.getCurrentTime !== 'function') return;
    let seconds;
    try { seconds = Math.floor(player.getCurrentTime()); } catch (_) { return; }
    updateControls();
    const data = player.getVideoData?.();
    const currentId = data?.video_id || lastVideoId;
    if (!Number.isFinite(seconds) || seconds < 0 || (!force && currentId === lastVideoId && Math.abs(seconds - lastSaved) < 10)) return;
    lastSaved = seconds;
    lastVideoId = currentId;
    const index = player.getPlaylistIndex?.();
    db.updateResource(resource.id, { lastPlaybackPosition: seconds, lastStudiedAt: new Date().toISOString(),
      ...(playlistId ? { lastVideoId: currentId, ...(Number.isInteger(index) && index >= 0 ? { lastPlaylistIndex: index } : {}) } : {}),
      ...(data?.title ? { currentVideoTitle: data.title } : {}) });
    db.recordStudyActivity({ type: 'youtube_watch', subjectId: resource.subjectId, resourceId: resource.id, playbackPosition: seconds, pdfFilename: null });
  };
  getPlayerApi().then(YT => {
    if (disposed || failed || !iframe.isConnected) return;
    readyTimeout = setTimeout(() => fail('YouTube is not responding. Check your connection or content blocker, try again, or open this video on YouTube.'), 25000);
    player = new YT.Player(iframe, {
      videoId,
      playerVars: { start, autoplay: 0, playsinline: 1, controls: 1, fs: 1, origin: window.location.origin,
        ...(playlistId ? { listType: 'playlist', list: playlistId, index: Number(url.searchParams.get('index')) } : {}) },
      events: {
        onReady: () => {
          if (disposed || failed) return;
          ready = true;
          clearTimeout(loadTimeout);
          clearTimeout(readyTimeout);
          updateControls();
          interval = setInterval(() => savePosition(), 5000);
        },
        onStateChange: event => { updateControls(); if ([YT.PlayerState.PAUSED, YT.PlayerState.ENDED, YT.PlayerState.PLAYING].includes(event.data)) savePosition(true); },
        onError: event => {
          if (disposed) return;
          const messages = {
            2: 'This video link is invalid. Choose another YouTube link.',
            100: 'This video or playlist is unavailable, private, or deleted. Choose another resource or open it on YouTube.',
            101: 'The video owner does not allow embedding. Use Open on YouTube or choose another video.',
            150: 'The video owner does not allow embedding. Use Open on YouTube or choose another video.',
            153: 'YouTube could not verify this embedded player. Check your privacy or content-blocking settings, or use Open on YouTube.'
          };
          fail(messages[event.data] || 'This YouTube video cannot be played here. Try another video or use Open on YouTube.');
        }
      }
    });
  }).catch(() => {
    // If the optional API is blocked, the iframe still provides native playback controls.
    // A failed iframe load has its own bounded timeout and helpful error above.
  });
  return () => {
    disposed = true;
    clearInterval(interval);
    clearTimeout(loadTimeout);
    clearTimeout(readyTimeout);
    iframe.removeEventListener('load', loaded);
    iframe.removeEventListener('error', frameError);
    document.removeEventListener('securitypolicyviolation', policyBlocked);
    controls.previous?.removeEventListener('click', previous);
    controls.next?.removeEventListener('click', next);
    savePosition(true);
    try { player?.destroy(); } catch (_) {}
  };
}
