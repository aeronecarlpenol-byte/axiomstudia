if (!window.__axiomCompanionInstalled) {
  window.__axiomCompanionInstalled = true;
  const channel = 'axiom-studia-companion-v1';
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.action !== 'bridge') return;
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onResponse);
      respond({ error: 'Axiom did not respond. Reload its tab and pair again.' });
    }, 3000);
    function onResponse(event) {
      const data = event.data;
      if (event.source !== window || event.origin !== location.origin || data?.channel !== channel ||
          data.kind !== 'response' || data.requestId !== requestId) return;
      clearTimeout(timeout);
      window.removeEventListener('message', onResponse);
      respond(data.error ? { error: data.error } : data.data);
    }
    window.addEventListener('message', onResponse);
    window.postMessage({ channel, kind: 'request', requestId, ...message.payload }, location.origin);
    return true;
  });
}
