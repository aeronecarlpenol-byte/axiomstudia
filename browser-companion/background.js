const pairKey = 'axiomPairedTabId';

chrome.action.onClicked.addListener(tab => {
  // Opening must happen directly from the toolbar click's user gesture.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  if (!tab.id || !/^https?:\/\//.test(tab.url || '')) return;
  chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () =>
    !!document.querySelector('script[type="module"][src="js/app.js"]')
  }).then(async results => {
    if (!results[0]?.result) return;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.storage.session.set({ [pairKey]: tab.id });
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return;
  (async () => {
    const paired = await chrome.storage.session.get(pairKey);
    const tabId = paired[pairKey];
    if (!tabId) throw new Error('Open Axiom Studia, then click the extension icon in that tab.');
    if (message.action === 'open-url') {
      const url = new URL(message.url);
      if (url.protocol !== 'https:') throw new Error('Only HTTPS resources can open in the browser.');
      await chrome.tabs.create({ url: url.href });
      return { ok: true };
    }
    if (message.action === 'show-axiom') {
      await chrome.tabs.update(tabId, { active: true });
      return { ok: true };
    }
    return chrome.tabs.sendMessage(tabId, { action: 'bridge', payload: message });
  })().then(respond, error => respond({ error: error.message || 'Axiom tab is unavailable. Pair it again.' }));
  return true;
});
