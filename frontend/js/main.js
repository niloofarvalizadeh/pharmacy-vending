/**
 * main.js - Application Entry Point for 55-inch Touchscreen Kiosk
 * Hardware Target: Intel Core i5-5200U (2 cores), Intel HD Graphics 5500
 * Strict 60 FPS compositor layer execution, ES Modules, zero external dependencies.
 */

import { store, subscribe, t, setLanguage, addToCart } from './store.js';
import { router } from './router.js';
import { socketClient, SOCKET_EVENTS } from './socketClient.js';
import { formatPrice, formatPriceWithUnit, formatNumber } from './format.js';
import { init as initAnatomy } from './anatomyCanvas.js';
import { init as initProductSpin } from './productSpin.js';

// Kiosk Configuration
const IDLE_TIMEOUT_SECONDS = 60;
let idleCountdown = IDLE_TIMEOUT_SECONDS;

// Payment View State & Constants
const COUNTDOWN_TOTAL_SECONDS = 60;
const RING_CIRCUMFERENCE = 534.07; // 2 * Math.PI * 85
let paymentCountdownInterval = null;
let paymentSecondsRemaining = COUNTDOWN_TOTAL_SECONDS;
let paymentTimeoutRedirectTimer = null;

/**
 * 1. Initialize Header Controls (Language Dropdown & Info Modal)
 */
function initHeaderControls() {
  const btnLangToggle = document.getElementById('btnLangToggle');
  const langDropdown = document.getElementById('langDropdown');
  const btnInfoToggle = document.getElementById('btnInfoToggle');
  const infoModalBackdrop = document.getElementById('infoModalBackdrop');
  const btnInfoModalClose = document.getElementById('btnInfoModalClose');

  // Toggle Language Dropdown
  if (btnLangToggle && langDropdown) {
    btnLangToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      store.langDropdownOpen = !store.langDropdownOpen;
    });

    // Close dropdown when tapping anywhere else
    window.addEventListener('click', () => {
      if (store.langDropdownOpen) {
        store.langDropdownOpen = false;
      }
    });

    langDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      const optionBtn = e.target.closest('.lang-option-btn');
      if (optionBtn) {
        const selectedLang = optionBtn.dataset.lang;
        if (selectedLang) {
          store.setLanguage(selectedLang);
          store.langDropdownOpen = false;
        }
      }
    });

    // Reactively toggle dropdown visibility without view re-render
    subscribe('langDropdownOpen', (isOpen) => {
      langDropdown.classList.toggle('is-open', !!isOpen);
      btnLangToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  // Pharmacy Info Modal
  if (btnInfoToggle && infoModalBackdrop && btnInfoModalClose) {
    btnInfoToggle.addEventListener('click', () => {
      store.infoModalOpen = true;
    });

    btnInfoModalClose.addEventListener('click', () => {
      store.infoModalOpen = false;
    });

    infoModalBackdrop.addEventListener('click', (e) => {
      if (e.target === infoModalBackdrop) {
        store.infoModalOpen = false;
      }
    });

    // Reactively toggle modal visibility
    subscribe('infoModalOpen', (isOpen) => {
      infoModalBackdrop.classList.toggle('is-open', !!isOpen);
    });
  }
}

/**
 * 2. Initialize Video Banner & Fullscreen Video Overlay
 */
function initVideoBanner() {
  const bannerCard = document.getElementById('videoBannerCard');
  if (!bannerCard) return;

  function openFullscreenVideo() {
    if (document.getElementById('fullscreenVideoOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'fullscreenVideoOverlay';
    overlay.className = 'fullscreen-video-overlay';
    overlay.innerHTML = `
      <button type="button" class="fullscreen-video-close" id="btnCloseVideo" aria-label="${t('close')}">
        <svg viewBox="0 0 24 24" fill="none">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <video class="fullscreen-video-player" id="bannerVideoPlayer" src="assets/video/education.webm" autoplay loop playsinline></video>
    `;

    document.body.appendChild(overlay);

    // Compositor-only opacity fade-in
    requestAnimationFrame(() => {
      overlay.classList.add('is-visible');
    });

    const closeBtn = overlay.querySelector('#btnCloseVideo');
    const video = overlay.querySelector('#bannerVideoPlayer');

    function closeVideo() {
      if (video) {
        try {
          video.pause();
          video.removeAttribute('src'); // Free hardware video decoding pipeline
          video.load();
        } catch {
          // ignore video reset error on older webkit
        }
      }
      overlay.classList.remove('is-visible');
      setTimeout(() => {
        overlay.remove(); // Detach completely from DOM
      }, 250);
    }

    closeBtn.addEventListener('click', closeVideo);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeVideo();
    });
  }

  bannerCard.addEventListener('click', openFullscreenVideo);
  bannerCard.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFullscreenVideo();
    }
  });
}

/**
 * 3. Initialize & Populate "پرفروش‌ترین محصولات" (Best-Sellers)
 */
function initBestSellers() {
  const container = document.getElementById('bestSellersRow');
  const btnViewAll = document.getElementById('btnViewAllBestSellers');

  if (btnViewAll) {
    btnViewAll.addEventListener('click', () => {
      router.go('catalog', { categoryId: 'all' });
    });
  }

  if (!container) return;

  // Build the 3 cards from seeded Proxy store.bestSellers
  const products = store.bestSellers || [];
  container.innerHTML = products.map((item) => `
    <div class="product-card" data-product-id="${item.id}">
      <div class="product-card-visual">
        <img class="product-card-img" src="${item.img}" alt="${t(item.nameKey)}" loading="eager">
      </div>
      <div class="product-card-title" data-name-key="${item.nameKey}">${t(item.nameKey)}</div>
      <div class="product-card-price" data-price="${item.price}">${formatPriceWithUnit(item.price, store.lang)}</div>
      <button type="button" class="btn-pill-buy" data-action="buy" data-product-id="${item.id}" aria-label="${t('buy')} ${t(item.nameKey)}">
        <svg viewBox="0 0 24 24">
          <circle cx="9" cy="21" r="1"></circle>
          <circle cx="20" cy="21" r="1"></circle>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
        </svg>
        <span class="buy-label-text">${t('buy')}</span>
      </button>
    </div>
  `).join('');

  // Delegated Buy Tap Event
  container.addEventListener('click', (e) => {
    const buyBtn = e.target.closest('[data-action="buy"]');
    if (buyBtn) {
      const prodId = buyBtn.dataset.productId;
      const product = products.find(p => p.id === prodId);
      if (product) {
        store.addToCart(product);
        router.go('payment');
      }
    }
  });
}

/**
 * 4. Initialize Categories Section
 */
function initCategories() {
  const categoriesRow = document.getElementById('categoriesRow');
  if (!categoriesRow) return;

  categoriesRow.addEventListener('click', (e) => {
    const card = e.target.closest('.category-card');
    if (card) {
      const categoryId = card.dataset.category;
      if (categoryId) {
        store.selectedCategory = categoryId;
        router.go('catalog', { categoryId });
      }
    }
  });

  categoriesRow.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('.category-card');
      if (card) {
        e.preventDefault();
        const categoryId = card.dataset.category;
        if (categoryId) {
          store.selectedCategory = categoryId;
          router.go('catalog', { categoryId });
        }
      }
    }
  });
}

/**
 * 4.1 Initialize Catalog View (Category Products & Interactions)
 */
function renderCatalogProducts(categoryId) {
  const grid = document.getElementById('catalogProductsGrid');
  const titleEl = document.getElementById('lblCatalogCategoryTitle');
  const breadcrumbEl = document.getElementById('lblCatalogBreadcrumb');

  const catId = (categoryId === 'all') ? 'sexual_health' : (categoryId || 'sexual_health');
  const cat = (store.categories || []).find(c => c.id === catId) || { id: 'sexual_health', nameKey: 'categorySexualHealth' };

  if (titleEl) {
    titleEl.textContent = t(cat.nameKey);
    titleEl.dataset.catKey = cat.nameKey;
  }

  if (breadcrumbEl) {
    let breadcrumbKey = 'breadcrumbSexualHealth';
    if (catId === 'womens_health') breadcrumbKey = 'breadcrumbWomensHealth';
    else if (catId === 'compounded') breadcrumbKey = 'breadcrumbCompounded';
    breadcrumbEl.textContent = t(breadcrumbKey);
    breadcrumbEl.dataset.breadcrumbKey = breadcrumbKey;
  }

  if (!grid) return;

  const products = (store.catalogProducts && store.catalogProducts[catId])
    ? store.catalogProducts[catId]
    : ((store.catalogProducts && store.catalogProducts.sexual_health) || []);

  grid.innerHTML = products.map((item) => `
    <div class="catalog-product-card" data-product-id="${item.id}">
      <div class="catalog-product-visual">
        <img class="catalog-product-img" src="${item.img}" alt="${t(item.nameKey)}" loading="eager">
      </div>
      <div class="catalog-product-title" data-name-key="${item.nameKey}">${t(item.nameKey)}</div>
      <div class="catalog-product-price" data-price="${item.price}">
        <span class="price-val">${formatPrice(item.price, store.lang)}</span>
        <span class="price-unit">${t('currencyUnit')}</span>
      </div>
      <button type="button" class="btn-catalog-buy" data-action="buy" data-product-id="${item.id}" aria-label="${t('buy')} ${t(item.nameKey)}">
        <span class="buy-label-text">${t('buy')}</span>
      </button>
    </div>
  `).join('');
}

function initCatalog() {
  const btnCatalogBack = document.getElementById('btnCatalogBack');
  const btnCatalogHome = document.getElementById('btnCatalogHome');
  const catalogGrid = document.getElementById('catalogProductsGrid');

  if (btnCatalogBack) {
    btnCatalogBack.addEventListener('click', () => {
      router.go('home');
    });
  }

  if (btnCatalogHome) {
    btnCatalogHome.addEventListener('click', () => {
      router.go('home');
    });
  }

  if (catalogGrid) {
    catalogGrid.addEventListener('click', (e) => {
      const buyBtn = e.target.closest('[data-action="buy"]');
      if (buyBtn) {
        const prodId = buyBtn.dataset.productId;
        const currentCategory = (store.selectedCategory === 'all') ? 'sexual_health' : (store.selectedCategory || 'sexual_health');
        const products = (store.catalogProducts && store.catalogProducts[currentCategory]) || [];
        const product = products.find(p => p.id === prodId);
        if (product) {
          store.addToCart(product);
          router.go('payment');
        }
      }
    });
  }

  // Reactive subscriber for category selection (< 1ms target)
  subscribe('selectedCategory', (newCategory) => {
    renderCatalogProducts(newCategory);
  });

  // Initial render with current selectedCategory
  renderCatalogProducts(store.selectedCategory || 'sexual_health');
}

/**
 * 5. Payment View Subsystem (Countdown, LED Strip, POS, Error & Recovery)
 */
function updateCountdownUI(seconds) {
  const numEl = document.getElementById('countdownSecondsNum');
  const progressEl = document.getElementById('countdownRingProgress');

  if (numEl) {
    numEl.textContent = formatNumber(Math.max(0, seconds), store.lang);
  }
  if (progressEl) {
    const ratio = Math.max(0, Math.min(1, seconds / COUNTDOWN_TOTAL_SECONDS));
    const offset = RING_CIRCUMFERENCE * (1 - ratio);
    progressEl.style.strokeDashoffset = String(offset);
  }
}

function stopPaymentCountdown() {
  if (paymentCountdownInterval) {
    clearInterval(paymentCountdownInterval);
    paymentCountdownInterval = null;
  }
  if (paymentTimeoutRedirectTimer) {
    clearTimeout(paymentTimeoutRedirectTimer);
    paymentTimeoutRedirectTimer = null;
  }
}

function startPaymentSession() {
  stopPaymentCountdown();

  // 1. Amount display
  const amountNumEl = document.getElementById('lblPaymentAmountNumber');
  if (amountNumEl) {
    amountNumEl.textContent = formatPrice(store.cartTotal, store.lang);
  }

  // 2. Reset H1 title & instruction block
  const h1El = document.getElementById('lblSwipeCardH1');
  if (h1El) {
    h1El.textContent = t('swipeCardTitle');
  }
  const amountSub = document.getElementById('lblPaymentAmountSub');
  if (amountSub) {
    amountSub.style.opacity = '1';
  }

  // 3. Activate LED Guide Strip on right edge
  const ledStrip = document.getElementById('ledGuideStrip');
  if (ledStrip) {
    ledStrip.classList.add('is-active');
  }

  // 4. Hide error overlay
  const errorOverlay = document.getElementById('paymentErrorOverlay');
  if (errorOverlay) {
    errorOverlay.classList.remove('is-visible');
    errorOverlay.setAttribute('aria-hidden', 'true');
  }

  // 5. Send PAY_REQUEST via socketClient
  const items = (store.payment && store.payment.items) ? store.payment.items : [];
  socketClient.payRequest(store.cartTotal, items);

  // 6. Reset & Start Countdown Ring
  paymentSecondsRemaining = COUNTDOWN_TOTAL_SECONDS;
  updateCountdownUI(paymentSecondsRemaining);

  paymentCountdownInterval = setInterval(() => {
    paymentSecondsRemaining--;
    updateCountdownUI(paymentSecondsRemaining);

    if (paymentSecondsRemaining <= 0) {
      stopPaymentCountdown();

      // Architecture prompt requirement: swap instruction block to timeout message
      if (h1El) {
        h1El.textContent = t('paymentTimeout');
      }
      if (amountSub) {
        amountSub.style.opacity = '0';
      }

      // Turn off physical/faked LED strip
      if (ledStrip) {
        ledStrip.classList.remove('is-active');
      }

      // Send PAY_CANCEL timeout
      socketClient.payCancel('timeout');

      // After 3s router.go('catalog')
      paymentTimeoutRedirectTimer = setTimeout(() => {
        if (store.currentView === 'payment') {
          router.go('catalog');
        }
      }, 3000);
    }
  }, 1000);
}

function endPaymentSession() {
  stopPaymentCountdown();

  const ledStrip = document.getElementById('ledGuideStrip');
  if (ledStrip) {
    ledStrip.classList.remove('is-active');
  }

  const amountSub = document.getElementById('lblPaymentAmountSub');
  if (amountSub) {
    amountSub.style.opacity = '1';
  }

  const errorOverlay = document.getElementById('paymentErrorOverlay');
  if (errorOverlay) {
    errorOverlay.classList.remove('is-visible');
    errorOverlay.setAttribute('aria-hidden', 'true');
  }
}

function initPaymentView() {
  const btnPaymentBack = document.getElementById('btnPaymentBack');
  const btnCancelPayment = document.getElementById('btnCancelPayment');
  const btnPaymentRetry = document.getElementById('btnPaymentRetry');
  const btnPaymentErrorCancel = document.getElementById('btnPaymentErrorCancel');
  const errorOverlay = document.getElementById('paymentErrorOverlay');

  function handleCancel() {
    socketClient.payCancel('user');
    endPaymentSession();
    router.back();
  }

  if (btnPaymentBack) {
    btnPaymentBack.addEventListener('click', handleCancel);
  }

  if (btnCancelPayment) {
    btnCancelPayment.addEventListener('click', handleCancel);
  }

  if (btnPaymentErrorCancel) {
    btnPaymentErrorCancel.addEventListener('click', handleCancel);
  }

  if (btnPaymentRetry) {
    btnPaymentRetry.addEventListener('click', () => {
      startPaymentSession();
    });
  }

  // Interactive Card Swipe Simulation on POS Illustration Tap
  const posIllustrationWrap = document.getElementById('posIllustrationWrap');
  if (posIllustrationWrap) {
    posIllustrationWrap.style.cursor = 'pointer';
    posIllustrationWrap.setAttribute('title', 'برای شبیه‌سازی کشیدن کارت کلیک کنید');
    posIllustrationWrap.addEventListener('click', () => {
      if (store.currentView === 'payment') {
        console.log('[Kiosk Simulation] POS card swipe simulated by user tap.');
        socketClient.send('SIMULATE_POS_APPROVED', { amount: store.cartTotal });
        socketClient._dispatch(SOCKET_EVENTS.POS_ACK, { status: 'approved' });
      }
    });
  }

  // View change subscriber
  subscribe('currentView', (newView, oldView) => {
    if (newView === 'payment') {
      startPaymentSession();
    } else if (oldView === 'payment') {
      endPaymentSession();
    }
  });

  // WebSocket Hardware Listeners
  socketClient.on(SOCKET_EVENTS.POS_ACK, (payload) => {
    if (store.currentView !== 'payment') return;
    const status = (payload && payload.status) ? String(payload.status).toLowerCase() : '';
    if (status === 'approved' || status === 'success') {
      endPaymentSession();
      router.go('success');
    } else if (status === 'cancelled') {
      // Ignored: already handled by user cancel or timeout
      return;
    } else {
      stopPaymentCountdown();
      const ledStrip = document.getElementById('ledGuideStrip');
      if (ledStrip) ledStrip.classList.remove('is-active');
      if (errorOverlay) {
        errorOverlay.classList.add('is-visible');
        errorOverlay.setAttribute('aria-hidden', 'false');
      }
    }
  });

  socketClient.on(SOCKET_EVENTS.DROP_FAIL, () => {
    if (store.currentView !== 'payment') return;
    stopPaymentCountdown();
    const ledStrip = document.getElementById('ledGuideStrip');
    if (ledStrip) ledStrip.classList.remove('is-active');
    if (errorOverlay) {
      errorOverlay.classList.add('is-visible');
      errorOverlay.setAttribute('aria-hidden', 'false');
    }
  });

  socketClient.on(SOCKET_EVENTS.DROP_SUCCESS, () => {
    if (store.currentView === 'payment') {
      endPaymentSession();
      router.go('success');
    }
  });
}

/**
 * 6. Success View Subsystem (Live Persian Clock, Entrance Anim, Pickup Guide, Receipt, Auto-Return)
 */
let successClockInterval = null;
let successReceiptFallbackTimer = null;
let successAutoReturnTimer = null;
let successReceiptPrintedOrHidden = false;

function updateSuccessClock() {
  const clockEl = document.getElementById('successLiveClock');
  if (!clockEl) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const timeStr = `${hh}:${mm}`;
  clockEl.textContent = formatNumber(timeStr, store.lang);
}

function hideReceiptLine() {
  successReceiptPrintedOrHidden = true;
  if (successReceiptFallbackTimer) {
    clearTimeout(successReceiptFallbackTimer);
    successReceiptFallbackTimer = null;
  }
  const receiptEl = document.getElementById('receiptStatusLine');
  if (receiptEl) {
    receiptEl.classList.add('is-hidden');
  }
}

function handleSuccessAutoReturn() {
  endSuccessSession();
  store.clearCart();
  router.go('home');
}

function startSuccessSession() {
  endSuccessSession(); // Clean up any stale timers

  successReceiptPrintedOrHidden = false;

  // 1. Reset check animation & entrance
  const checkPath = document.getElementById('successCheckPath');
  if (checkPath) {
    checkPath.style.animation = 'none';
    void checkPath.offsetWidth; // Force reflow
    checkPath.style.animation = '';
  }

  // 2. Reset receipt status line visibility & text
  const receiptEl = document.getElementById('receiptStatusLine');
  const receiptTextEl = document.getElementById('lblReceiptStatus');
  if (receiptEl) {
    receiptEl.classList.remove('is-hidden');
  }
  if (receiptTextEl) {
    receiptTextEl.textContent = t('receiptPrinting');
  }

  // 3. Start live clock in Persian digits updating every 30s
  updateSuccessClock();
  successClockInterval = setInterval(updateSuccessClock, 30000);

  // 4. Receipt fallback timer (8s fallback to hiding it if no RECEIPT_PRINTED arrives)
  successReceiptFallbackTimer = setTimeout(() => {
    hideReceiptLine();
  }, 8000);

  // 5. Auto-return timer: 12 seconds after view entry
  successAutoReturnTimer = setTimeout(() => {
    handleSuccessAutoReturn();
  }, 12000);
}

function endSuccessSession() {
  if (successClockInterval) {
    clearInterval(successClockInterval);
    successClockInterval = null;
  }
  if (successReceiptFallbackTimer) {
    clearTimeout(successReceiptFallbackTimer);
    successReceiptFallbackTimer = null;
  }
  if (successAutoReturnTimer) {
    clearTimeout(successAutoReturnTimer);
    successAutoReturnTimer = null;
  }
}

function initSuccessView() {
  const viewSuccessEl = document.getElementById('view-success');

  if (viewSuccessEl) {
    // Immediate return on touch AFTER receipt line has disappeared
    viewSuccessEl.addEventListener('pointerdown', () => {
      if (store.currentView === 'success' && successReceiptPrintedOrHidden) {
        handleSuccessAutoReturn();
      }
    });
  }

  // View transition subscriber
  subscribe('currentView', (newView, oldView) => {
    if (newView === 'success') {
      startSuccessSession();
    } else if (oldView === 'success') {
      endSuccessSession();
    }
  });

  // WebSocket Inbound RECEIPT_PRINTED listener
  socketClient.on(SOCKET_EVENTS.RECEIPT_PRINTED, () => {
    if (store.currentView === 'success') {
      hideReceiptLine();
    }
  });

  // Also handle DROP_SUCCESS confirming hardware dispense
  socketClient.on(SOCKET_EVENTS.DROP_SUCCESS, () => {
    // If not already in success, navigate to success
    if (store.currentView === 'payment') {
      endPaymentSession();
      router.go('success');
    }
  });
}

/**
 * 7. Instant In-Memory i18n Subscriber (< 1ms targeted DOM mutation)
 */
function bindI18nSubscriber() {
  subscribe('lang', (newLang) => {
    // Header
    const wordmarkEl = document.getElementById('lblPharmacyWordmark');
    if (wordmarkEl) wordmarkEl.textContent = t('pharmacyWordmark');

    const titleEl = document.getElementById('lblPharmacyTitle');
    if (titleEl) titleEl.textContent = t('pharmacyTitle');

    // Language Dropdown Active Marker
    document.querySelectorAll('.lang-option-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.lang === newLang);
    });

    // Pharmacy Info Modal
    const modalTitleEl = document.getElementById('lblInfoModalTitle');
    if (modalTitleEl) modalTitleEl.textContent = t('pharmacyTitle');

    const modalDescEl = document.getElementById('lblInfoModalDesc');
    if (modalDescEl) modalDescEl.textContent = t('pharmacyDesc');

    const supportLabelEl = document.getElementById('lblSupportLabel');
    if (supportLabelEl) supportLabelEl.textContent = t('pharmacySupportLabel');

    const supportPhoneEl = document.getElementById('lblSupportPhone');
    if (supportPhoneEl) supportPhoneEl.textContent = t('pharmacySupportPhone');

    const modalCloseBtn = document.getElementById('btnInfoModalClose');
    if (modalCloseBtn) modalCloseBtn.textContent = t('close');

    // Banner Text
    const bannerTitleEl = document.getElementById('lblBannerTitle');
    if (bannerTitleEl) bannerTitleEl.textContent = t('bannerTitle');

    const bannerCtaEl = document.getElementById('lblBannerCta');
    if (bannerCtaEl) bannerCtaEl.textContent = t('bannerCta');

    // Section Titles
    const bestSellersTitleEl = document.getElementById('lblBestSellersTitle');
    if (bestSellersTitleEl) bestSellersTitleEl.textContent = t('bestSellersTitle');

    const viewAllEl = document.getElementById('lblViewAll');
    if (viewAllEl) viewAllEl.textContent = t('viewAll');

    const categoriesTitleEl = document.getElementById('lblCategoriesTitle');
    if (categoriesTitleEl) categoriesTitleEl.textContent = t('categoriesTitle');

    // Categories
    const catSexEl = document.getElementById('lblCatSexualHealth');
    if (catSexEl) catSexEl.textContent = t('categorySexualHealth');

    const catWomenEl = document.getElementById('lblCatWomensHealth');
    if (catWomenEl) catWomenEl.textContent = t('categoryWomensHealth');

    const catCompEl = document.getElementById('lblCatCompounded');
    if (catCompEl) catCompEl.textContent = t('categoryCompounded');

    // Product Cards Titles & Prices
    document.querySelectorAll('.product-card').forEach(card => {
      const titleNode = card.querySelector('.product-card-title');
      if (titleNode && titleNode.dataset.nameKey) {
        titleNode.textContent = t(titleNode.dataset.nameKey);
      }
      const priceNode = card.querySelector('.product-card-price');
      if (priceNode && priceNode.dataset.price) {
        priceNode.textContent = formatPriceWithUnit(Number(priceNode.dataset.price), newLang);
      }
      const buyLabel = card.querySelector('.buy-label-text');
      if (buyLabel) {
        buyLabel.textContent = t('buy');
      }
    });

    // Payment View Localized Elements
    const paymentHeaderTitle = document.getElementById('lblPaymentHeaderTitle');
    if (paymentHeaderTitle) paymentHeaderTitle.textContent = t('pharmacyWordmark');

    const swipeH1 = document.getElementById('lblSwipeCardH1');
    const amountSub = document.getElementById('lblPaymentAmountSub');
    if (swipeH1) {
      if (paymentSecondsRemaining <= 0) {
        swipeH1.textContent = t('paymentTimeout');
        if (amountSub) amountSub.style.opacity = '0';
      } else {
        swipeH1.textContent = t('swipeCardTitle');
        if (amountSub) amountSub.style.opacity = '1';
      }
    }

    const amountLabel = document.getElementById('lblAmountLabel');
    if (amountLabel) amountLabel.textContent = t('amountLabel');

    const currencyUnit = document.getElementById('lblPaymentCurrencyUnit');
    if (currencyUnit) currencyUnit.textContent = t('currencyUnit');

    const amountNumber = document.getElementById('lblPaymentAmountNumber');
    if (amountNumber) amountNumber.textContent = formatPrice(store.cartTotal, newLang);

    const countdownUnit = document.getElementById('lblCountdownUnit');
    if (countdownUnit) countdownUnit.textContent = t('secondsUnit');

    const countdownNum = document.getElementById('countdownSecondsNum');
    if (countdownNum) countdownNum.textContent = formatNumber(Math.max(0, paymentSecondsRemaining), newLang);

    const cancelBtn = document.getElementById('lblCancelBtn');
    if (cancelBtn) cancelBtn.textContent = t('cancel');

    const errorMsg = document.getElementById('lblPaymentErrorMsg');
    if (errorMsg) errorMsg.textContent = t('paymentFailed');

    const retryBtn = document.getElementById('btnPaymentRetry');
    if (retryBtn) retryBtn.textContent = t('retry');

    const errorCancelBtn = document.getElementById('btnPaymentErrorCancel');
    if (errorCancelBtn) errorCancelBtn.textContent = t('cancel');

    // Success View Localized Elements
    const successBrandTitle = document.getElementById('lblSuccessSmartPharmacy');
    if (successBrandTitle) successBrandTitle.textContent = t('smartPharmacy');

    const successThankYou = document.getElementById('lblSuccessThankYou');
    if (successThankYou) successThankYou.textContent = t('thankYouTitle');

    const successInstruction = document.getElementById('lblSuccessInstruction');
    if (successInstruction) successInstruction.textContent = t('takeProductInstruction');

    const receiptStatus = document.getElementById('lblReceiptStatus');
    if (receiptStatus) receiptStatus.textContent = t('receiptPrinting');

    // Catalog View Localized Elements
    const catalogBackLabel = document.getElementById('lblCatalogBack');
    if (catalogBackLabel) catalogBackLabel.textContent = t('back');

    const catalogPageIndicator = document.getElementById('lblCatalogPageIndicator');
    if (catalogPageIndicator) catalogPageIndicator.textContent = t('pageIndicator');

    const catTitle = document.getElementById('lblCatalogCategoryTitle');
    if (catTitle && catTitle.dataset.catKey) {
      catTitle.textContent = t(catTitle.dataset.catKey);
    }

    const catBreadcrumb = document.getElementById('lblCatalogBreadcrumb');
    if (catBreadcrumb && catBreadcrumb.dataset.breadcrumbKey) {
      catBreadcrumb.textContent = t(catBreadcrumb.dataset.breadcrumbKey);
    }

    document.querySelectorAll('.catalog-product-card').forEach(card => {
      const titleNode = card.querySelector('.catalog-product-title');
      if (titleNode && titleNode.dataset.nameKey) {
        titleNode.textContent = t(titleNode.dataset.nameKey);
      }
      const priceNode = card.querySelector('.catalog-product-price');
      if (priceNode && priceNode.dataset.price) {
        const valEl = priceNode.querySelector('.price-val');
        const unitEl = priceNode.querySelector('.price-unit');
        if (valEl) valEl.textContent = formatPrice(Number(priceNode.dataset.price), newLang);
        if (unitEl) unitEl.textContent = t('currencyUnit');
      }
      const buyLabel = card.querySelector('.buy-label-text');
      if (buyLabel) {
        buyLabel.textContent = t('buy');
      }
    });

    updateSuccessClock();
  });
}

/**
 * 8. Idle Timeout Manager (Attract Screen Recovery)
 */
function initIdleTimeout() {
  function resetIdle() {
    idleCountdown = IDLE_TIMEOUT_SECONDS;
    store.idleCountdown = idleCountdown;
  }

  const events = ['pointerdown', 'touchstart', 'click', 'keydown'];
  events.forEach(evt => {
    window.addEventListener(evt, resetIdle, { passive: true });
  });

  setInterval(() => {
    idleCountdown--;
    store.idleCountdown = idleCountdown;

    if (idleCountdown <= 0) {
      if (store.currentView !== 'home') {
        // Do not interrupt active payment or success screen with idle reset
        if (store.currentView === 'payment' || store.currentView === 'success') {
          resetIdle();
          return;
        }
        console.log('[Idle Safety] Returning to home screen.');
        router.go('home');
      }
      resetIdle();
    }
  }, 1000);
}

/**
 * Main Application Boot
 */
function boot() {
  console.log('--------------------------------------------------');
  console.log('داروخانه دکتر موحد - Kiosk Frontend Initializing');
  console.log('Intel Core i5-5200U / HD 5500 Zero-Overhead Mode');
  console.log('--------------------------------------------------');

  initHeaderControls();
  initVideoBanner();
  initBestSellers();
  initCategories();
  initCatalog();
  initPaymentView();
  initSuccessView();
  bindI18nSubscriber();
  initIdleTimeout();

  router.init();
  socketClient.connect();

  // Phase 2 placeholders
  initAnatomy();
  initProductSpin();

  // Debug harness exposed to window for automated testing and simulator
  window.kiosk = {
    store,
    router,
    socketClient,
    SOCKET_EVENTS,
    setLanguage,
    addToCart,
    // Simulator helpers
    simulatePaymentSuccess: () => socketClient._dispatch(SOCKET_EVENTS.POS_ACK, { status: 'approved' }),
    simulatePaymentDecline: () => socketClient._dispatch(SOCKET_EVENTS.POS_ACK, { status: 'declined' }),
    simulateDropSuccess: (slotId = 'A1') => socketClient._dispatch(SOCKET_EVENTS.DROP_SUCCESS, { slotId }),
    simulateDropFail: (reason = 'JAM') => socketClient._dispatch(SOCKET_EVENTS.DROP_FAIL, { reason }),
    simulateReceiptPrinted: () => socketClient._dispatch(SOCKET_EVENTS.RECEIPT_PRINTED, {})
  };

  console.log('[Kiosk Boot] Frontend loaded and ready @ 60 FPS.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}