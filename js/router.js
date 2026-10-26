/**
 * FOCUS//ECE — Single Page Application Hash Router
 */

export class Router {
  constructor(routes, contentContainer) {
    this.routes = routes;
    this.contentContainer = contentContainer;
    this.currentRoute = null;

    window.addEventListener('hashchange', () => this.handleRoute());
  }

  init() {
    if (!window.location.hash) {
      window.location.hash = '#dashboard';
    } else {
      this.handleRoute();
    }
  }

  handleRoute() {
    const requested = window.location.hash.slice(1) || 'dashboard';
    const hash = this.routes[requested] ? requested : 'dashboard';
    if (hash !== requested) {
      window.location.replace('#dashboard');
      return;
    }
    const routeHandler = this.routes[hash];
    this.currentRoute = hash;
    this.sectionObserver?.disconnect();

    // Clean up previous route resources/listeners if provided
    if (this.currentCleanup && typeof this.currentCleanup === 'function') {
      try {
        this.currentCleanup();
      } catch (e) {
        console.error('Route cleanup error:', e);
      }
      this.currentCleanup = null;
    }

    // Update active nav items
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el => {
      const target = el.getAttribute('href')?.replace('#', '');
      if (target === hash) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    if (routeHandler) {
      this.contentContainer.setAttribute('data-route', hash);
      this.contentContainer.innerHTML = '';
      const cleanup = routeHandler(this.contentContainer);
      if (typeof cleanup === 'function') {
        this.currentCleanup = cleanup;
      }
      this.activateSections();
      this.contentContainer.scrollTop = 0;
      requestAnimationFrame(() => {
        const pageHeading = this.contentContainer.querySelector('h1, h2');
        if (pageHeading) {
          pageHeading.setAttribute('tabindex', '-1');
          pageHeading.focus({ preventScroll: true });
        }
      });
    }
  }

  activateSections() {
    const sections = this.contentContainer.querySelectorAll(
      '.dash-continue-card, .dash-panel-priorities, .dash-panel-deadlines, .dash-panel-quote, .ws-header, .resource-card, .task-card'
    );
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sections.forEach(section => section.classList.add('aib-in-view'));
      return;
    }
    this.sectionObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('aib-in-view');
        observer.unobserve(entry.target);
      });
    }, { root: this.contentContainer, threshold: 0.12 });
    sections.forEach(section => this.sectionObserver.observe(section));
  }
}
