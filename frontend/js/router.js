/**
 * router.js - Ultra-lightweight View Router for Kiosk Touchscreen
 * Architecture Rule 2:
 * Single-page app, single file. Every screen is a <section class="view" data-view="home|catalog|payment|success">.
 * Screen switching = toggling an `is-active` class, instant, zero reload.
 * Transitions strictly via Compositor layers (opacity, transform).
 */

import { store, subscribe } from './store.js';

class KioskRouter {
  constructor() {
    this.historyStack = [];
    this.views = new Map();
    this.isInitialized = false;
    this.allowedViews = new Set(['home', 'catalog', 'payment', 'success']);
  }

  /**
   * Initialize router, index DOM views, bind store reactive listener
   */
  init() {
    if (this.isInitialized) return;

    const viewElements = document.querySelectorAll('.view[data-view]');
    viewElements.forEach((el) => {
      const viewName = el.getAttribute('data-view');
      this.views.set(viewName, el);
    });

    // Reactively switch view whenever store.currentView changes
    subscribe('currentView', (newView, oldView) => {
      this._applyViewTransition(newView, oldView);
    });

    // Initial render
    this._applyViewTransition(store.currentView || 'home', null);
    this.isInitialized = true;
    console.log('[Router] Initialized with views:', Array.from(this.views.keys()));
  }

  /**
   * Navigate to a target view
   * @param {'home'|'catalog'|'payment'|'success'} viewName
   * @param {object} [params]
   */
  go(viewName, params = {}) {
    if (!this.allowedViews.has(viewName)) {
      console.warn(`[Router] Unknown view "${viewName}". Ignoring navigation.`);
      return;
    }

    if (store.currentView === viewName) return;

    // Push to back stack (except when resetting to home)
    if (viewName === 'home') {
      this.historyStack = [];
    } else if (store.currentView) {
      this.historyStack.push(store.currentView);
    }

    store.previousView = store.currentView;
    store.currentView = viewName;
  }

  /**
   * Navigate back to the previous screen
   */
  back() {
    const prev = this.historyStack.pop() || 'home';
    store.previousView = store.currentView;
    store.currentView = prev;
  }

  /**
   * Switch the .is-active class on DOM sections
   */
  _applyViewTransition(newView, oldView) {
    if (!this.views.has(newView)) {
      console.warn(`[Router] View element for "${newView}" not found in DOM.`);
      return;
    }

    this.views.forEach((element, name) => {
      if (name === newView) {
        element.classList.add('is-active');
        element.setAttribute('aria-hidden', 'false');
      } else {
        element.classList.remove('is-active');
        element.setAttribute('aria-hidden', 'true');
      }
    });

    // Set data-active-view on kiosk root
    const rootEl = document.getElementById('kioskRoot');
    if (rootEl) {
      rootEl.setAttribute('data-active-view', newView);
    }

    // Reset view-specific scroll position if any
    const activeEl = this.views.get(newView);
    if (activeEl) {
      activeEl.scrollTop = 0;
    }
  }

  getCurrentView() {
    return store.currentView;
  }

  canGoBack() {
    return this.historyStack.length > 0;
  }
}

export const router = new KioskRouter();
