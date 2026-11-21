/** Shared controls for the subject's application-level fullscreen viewer. */
export function mountResourceNavigation(panel, options) {
  const listeners = [];
  const listen = (element, type, handler, config) => {
    element.addEventListener(type, handler, config);
    listeners.push(() => element.removeEventListener(type, handler, config));
  };
  const list = panel.querySelector('#viewer-resource-list');
  const resourcesButton = panel.querySelector('[data-viewer-resources]');
  const previous = panel.querySelector('[data-viewer-prev]');
  const next = panel.querySelector('[data-viewer-next]');
  const index = options.resources.findIndex(resource => resource.id === options.activeId);
  let idleTimeout;
  const showControls = () => {
    panel.classList.remove('viewer-inactive');
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => {
      if (options.fullscreen() && list.hidden && !document.activeElement?.closest('.resource-navigation, .viewer-resource-list')) panel.classList.add('viewer-inactive');
    }, 3000);
  };
  const closeList = () => {
    list.hidden = true;
    resourcesButton.setAttribute('aria-expanded', 'false');
  };
  const toggleList = () => {
    list.hidden = !list.hidden;
    resourcesButton.setAttribute('aria-expanded', String(!list.hidden));
    if (!list.hidden) list.querySelector('[aria-current="true"], button')?.focus();
  };
  const open = resource => {
    if (!resource || options.locked()) return;
    closeList();
    options.open(resource);
  };
  previous.disabled = options.locked() || index <= 0;
  next.disabled = options.locked() || index < 0 || index >= options.resources.length - 1;
  listen(previous, 'click', () => open(options.resources[index - 1]));
  listen(next, 'click', () => open(options.resources[index + 1]));
  listen(resourcesButton, 'click', toggleList);
  for (const button of list.querySelectorAll('[data-viewer-resource]')) {
    button.disabled = options.locked();
    listen(button, 'click', () => open(options.resources.find(resource => resource.id === button.dataset.viewerResource)));
  }
  const fullscreen = panel.querySelector('[data-viewer-fullscreen]');
  listen(fullscreen, 'click', () => {
    options.setFullscreen(!options.fullscreen());
    showControls();
  });
  const updateLock = () => {
    previous.disabled = options.locked() || index <= 0;
    next.disabled = options.locked() || index < 0 || index >= options.resources.length - 1;
    for (const button of list.querySelectorAll('button')) button.disabled = options.locked();
  };
  listen(window, 'axiom-floating-timer-change', updateLock);
  for (const event of ['pointermove', 'pointerdown', 'focusin']) listen(panel, event, showControls);

  const image = panel.querySelector('#ws-study-image');
  const viewport = image?.parentElement;
  const state = options.imageStates.get(options.activeId) || { scale: null, x: 0, y: 0 };
  const pointers = new Map();
  let gesture;
  const draw = () => {
    if (!image?.naturalWidth) return;
    if (state.scale === null) {
      state.scale = Math.min(viewport.clientWidth / image.naturalWidth, viewport.clientHeight / image.naturalHeight);
    }
    image.style.width = image.naturalWidth + 'px';
    image.style.height = image.naturalHeight + 'px';
    image.style.transform = 'translate(-50%, -50%) translate(' + state.x + 'px,' + state.y + 'px) scale(' + state.scale + ')';
    options.imageStates.set(options.activeId, { ...state });
  };
  const zoom = factor => {
    if (!image?.naturalWidth) return;
    draw();
    state.scale = Math.max(0.05, Math.min(10, state.scale * factor));
    draw();
  };
  if (image) {
    listen(image, 'load', draw);
    listen(window, 'resize', draw);
    for (const button of panel.querySelectorAll('[data-image-zoom]')) listen(button, 'click', () => zoom(Number(button.dataset.imageZoom) > 0 ? 1.2 : 1 / 1.2));
    listen(panel.querySelector('[data-image-fit]'), 'click', () => { state.scale = null; state.x = 0; state.y = 0; draw(); });
    listen(panel.querySelector('[data-image-reset]'), 'click', () => { state.scale = 1; state.x = 0; state.y = 0; draw(); });
    listen(viewport, 'wheel', event => {
      event.preventDefault();
      zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002));
    }, { passive: false });
    listen(viewport, 'pointerdown', event => {
      if (event.button !== 0) return;
      viewport.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      gesture = null;
    });
    listen(viewport, 'pointermove', event => {
      const previousPoint = pointers.get(event.pointerId);
      if (!previousPoint) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (gesture) zoom(distance / gesture);
        gesture = distance;
      } else {
        state.x += event.clientX - previousPoint.x;
        state.y += event.clientY - previousPoint.y;
        draw();
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(viewport, type, event => { pointers.delete(event.pointerId); gesture = null; });
  }

  listen(panel, 'keydown', event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ||
        event.target.closest('input, textarea, select, [contenteditable="true"], iframe, #ws-focus-cockpit')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      const more = panel.querySelector('.resource-more');
      if (!list.hidden) { closeList(); resourcesButton.focus(); }
      else if (more.open) more.open = false;
      else if (options.fullscreen()) options.setFullscreen(false);
      return;
    }
    if (event.key.toLowerCase() === 'r') { event.preventDefault(); toggleList(); }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); options.setFullscreen(!options.fullscreen()); }
    // Arrow keys on the PDF document retain page navigation.
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.target.closest('.ws-pdf-viewport, #ws-pdf-topbar')) {
      event.preventDefault();
      open(options.resources[index + (event.key === 'ArrowLeft' ? -1 : 1)]);
    }
    if (['+', '=', '-'].includes(event.key)) {
      event.preventDefault();
      if (image) zoom(event.key === '-' ? 1 / 1.2 : 1.2);
      else options.zoomPdf(event.key === '-' ? -1 : 1);
    }
  });
  if (options.fullscreen()) panel.focus({ preventScroll: true });
  showControls();
  return () => {
    clearTimeout(idleTimeout);
    for (const remove of listeners) remove();
  };
}
