/**
 * Mind & Stoic section has been integrated into the Dashboard.
 * Redirects to dashboard if accessed.
 */

export function renderMind(container) {
  window.location.hash = '#dashboard';
}
