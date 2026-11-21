/**
 * store.js - ES6 Proxy Reactive State & In-Memory i18n Engine
 * Hard rule: Target DOM update latency < 1ms on Intel Core i5-5200U.
 * No full-view re-renders. Only granular property subscribers.
 */

// In-Memory Dictionaries for fa, en, ar (Held in RAM from boot)
export const DICTIONARIES = {
  fa: {
    // Brand & Header
    pharmacyWordmark: 'داروخانه',
    pharmacyTitle: 'داروخانه دکتر موحد',
    pharmacySubtitle: 'داروخانه هوشمند شبانه‌روزی',
    pharmacySupportLabel: 'پشتیبانی شبانه‌روزی:',
    pharmacySupportPhone: '۰۲۱-۸۸۲۲۳۳۴۴',
    pharmacyDesc: 'کیوسک وندینگ هوشمند داروخانه با کنترل دمای پایدار و تحویل مکانیزه محصولات سلامت',
    infoModalTitle: 'اطلاعات داروخانه دکتر موحد',
    close: 'بستن',
    onlineStatus: 'آماده به کار',
    offlineStatus: 'آفلاین',

    // Home View
    bannerTitle: 'ویدیوهای آموزشی و سلامت',
    bannerCta: 'مشاهده ویدیوهای آموزشی',
    bestSellersTitle: 'پرفروش‌ترین محصولات',
    viewAll: 'مشاهده همه',
    categoriesTitle: 'دسته‌بندی‌ها',
    categorySexualHealth: 'سلامت جنسی',
    categoryWomensHealth: 'سلامت بانوان',
    categoryCompounded: 'داروهای ترکیبی',

    // Catalog View
    back: 'بازگشت',
    breadcrumbSexualHealth: 'صفحه اصلی / سلامت جنسی',
    pageIndicator: 'صفحه ۱ از ۲',
    buy: 'خرید',
    currencyUnit: 'تومان',

    // Payment View
    swipeCardTitle: 'لطفاً کارت را بکشید',
    amountLabel: 'مبلغ:',
    secondsUnit: 'ثانیه',
    cancel: 'انصراف',
    paymentPrompt: 'کارتخوان در زیر صفحه نمایش قرار دارد',
    paymentTimeout: 'زمان پرداخت به پایان رسید',
    paymentFailed: 'پرداخت ناموفق بود. لطفاً دوباره تلاش کنید.',
    retry: 'تلاش مجدد',

    // Success / Dispense View
    smartPharmacy: 'داروخانه هوشمند',
    thankYouTitle: 'از خرید شما متشکریم',
    takeProductInstruction: 'لطفاً خرید خود را از محفظه پایین بردارید',
    receiptPrinting: 'رسید شما در حال چاپ است...',

    // Products
    prod_vitaminc: 'قرص جوشان ویتامین C',
    prod_multivitamin: 'مولتی‌ویتامین',
    prod_omega3: 'کپسول امگا ۳',
    prod_kodex: 'کاندوم کلاسیک کدکس',
    prod_lube: 'ژل لوبریکانت روان‌کننده',
    prod_pregnancy_test: 'تست بارداری خودکار',
    prod_feminine_wash: 'ژل بهداشتی بانوان'
  },

  en: {
    // Brand & Header
    pharmacyWordmark: 'Pharmacy',
    pharmacyTitle: 'Dr. Movahed Pharmacy',
    pharmacySubtitle: '24/7 Smart Vending Pharmacy',
    pharmacySupportLabel: '24/7 Support Helpline:',
    pharmacySupportPhone: '+98 21 88223344',
    pharmacyDesc: 'Smart automated 24/7 pharmacy kiosk with climate control & robotic dispensing',
    infoModalTitle: 'About Dr. Movahed Pharmacy',
    close: 'Close',
    onlineStatus: 'Online',
    offlineStatus: 'Offline',

    // Home View
    bannerTitle: 'Educational & Health Videos',
    bannerCta: 'Watch Educational Videos',
    bestSellersTitle: 'Best-Selling Products',
    viewAll: 'View All',
    categoriesTitle: 'Categories',
    categorySexualHealth: 'Sexual Health',
    categoryWomensHealth: "Women's Health",
    categoryCompounded: 'Compounded Medications',

    // Catalog View
    back: 'Back',
    breadcrumbSexualHealth: 'Home / Sexual Health',
    pageIndicator: 'Page 1 of 2',
    buy: 'Buy',
    currencyUnit: 'Toman',

    // Payment View
    swipeCardTitle: 'Please Swipe Your Card',
    amountLabel: 'Amount:',
    secondsUnit: 'sec',
    cancel: 'Cancel',
    paymentPrompt: 'POS terminal is located below the screen',
    paymentTimeout: 'Payment time has expired',
    paymentFailed: 'Payment was unsuccessful. Please try again.',
    retry: 'Retry',

    // Success / Dispense View
    smartPharmacy: 'Smart Pharmacy',
    thankYouTitle: 'Thank You For Your Purchase',
    takeProductInstruction: 'Please collect your items from the lower compartment',
    receiptPrinting: 'Your receipt is being printed...',

    // Products
    prod_vitaminc: 'Vitamin C Effervescent',
    prod_multivitamin: 'Multivitamin Formula',
    prod_omega3: 'Omega-3 Capsules',
    prod_kodex: 'Kodex Classic Condoms',
    prod_lube: 'Lubricant Gel',
    prod_pregnancy_test: 'Rapid Pregnancy Test',
    prod_feminine_wash: 'Feminine Intimate Wash'
  },

  ar: {
    // Brand & Header
    pharmacyWordmark: 'صيدلية',
    pharmacyTitle: 'صيدلية دكتور موحد',
    pharmacySubtitle: 'صيدلية آلية ذكية على مدار الساعة',
    pharmacySupportLabel: 'الدعم الفني على مدار الساعة:',
    pharmacySupportPhone: '۰۲۱-۸۸۲۲۳۳۴۴',
    pharmacyDesc: 'كشك الصيدلية الآلية الذكية على مدار الساعة مع تحكم في الحرارة وتوصيل آلي',
    infoModalTitle: 'حول صيدلية دكتور موحد',
    close: 'إغلاق',
    onlineStatus: 'متصل',
    offlineStatus: 'غير متصل',

    // Home View
    bannerTitle: 'فيديوهات تعليمية وصحية',
    bannerCta: 'مشاهدة الفيديوهات التعليمية',
    bestSellersTitle: 'المنتجات الأكثر مبيعاً',
    viewAll: 'عرض الكل',
    categoriesTitle: 'التصنيفات',
    categorySexualHealth: 'الصحة الجنسية',
    categoryWomensHealth: 'صحة المرأة',
    categoryCompounded: 'الأدوية المركبة',

    // Catalog View
    back: 'رجوع',
    breadcrumbSexualHealth: 'الرئيسية / الصحة الجنسية',
    pageIndicator: 'صفحة ١ من ٢',
    buy: 'شراء',
    currencyUnit: 'تومان',

    // Payment View
    swipeCardTitle: 'يرجى تمرير البطاقة',
    amountLabel: 'المبلغ:',
    secondsUnit: 'ثانية',
    cancel: 'إلغاء',
    paymentPrompt: 'جهاز الدفع يقع أسفل الشاشة',
    paymentTimeout: 'انتهت مهلة الدفع',
    paymentFailed: 'فشلت عملية الدفع. يرجى المحاولة مرة أخرى.',
    retry: 'إعادة المحاولة',

    // Success / Dispense View
    smartPharmacy: 'صيدلية ذكية',
    thankYouTitle: 'شكراً لشرائكم',
    takeProductInstruction: 'يرجى أخذ مشترياتكم من المقصورة السفلية',
    receiptPrinting: 'جاري طباعة الإيصال...',

    // Products
    prod_vitaminc: 'فيتامين سي فوار',
    prod_multivitamin: 'ملتي فيتامين',
    prod_omega3: 'كبسولات أوميغا ٣',
    prod_kodex: 'واقي ذكري كودكس كلاسيك',
    prod_lube: 'جل مزلق طبي',
    prod_pregnancy_test: 'فحص حمل تلقائي',
    prod_feminine_wash: 'غسول نسائي حميمي'
  }
};

// Subscribers registry: property -> Set of callbacks
const subscribers = new Map();
const globalSubscribers = new Set();

// Raw initial reactive state
const rawState = {
  // Navigation & View
  currentView: 'home',
  previousView: null,

  // Language & Direction
  lang: 'fa',
  dir: 'rtl',

  // Active Category & Product
  selectedCategory: 'sexual_health',
  selectedProduct: null,
  cart: [],

  // Seeded Best Sellers for Home Screen
  bestSellers: [
    {
      id: 'prod-vitaminc',
      nameKey: 'prod_vitaminc',
      price: 75000,
      slotId: 'A1',
      img: 'assets/products-webp/vitaminc.svg'
    },
    {
      id: 'prod-multivitamin',
      nameKey: 'prod_multivitamin',
      price: 140000,
      slotId: 'A2',
      img: 'assets/products-webp/multivitamin.svg'
    },
    {
      id: 'prod-omega3',
      nameKey: 'prod_omega3',
      price: 195000,
      slotId: 'A3',
      img: 'assets/products-webp/omega3.svg'
    }
  ],

  // Seeded Categories for Home Screen
  categories: [
    { id: 'sexual_health', nameKey: 'categorySexualHealth' },
    { id: 'womens_health', nameKey: 'categoryWomensHealth' },
    { id: 'compounded', nameKey: 'categoryCompounded' }
  ],

  // UI Interactive States
  langDropdownOpen: false,
  infoModalOpen: false,
  videoOverlayOpen: false,
  paymentError: false,

  // Payment Transaction Data
  payment: {
    amount: 125000,
    items: [],
    countdown: 59,
    status: 'idle',
    orderId: null
  },

  // Hardware State from socketClient
  hardware: {
    isConnected: false,
    slotStatus: {},
    lastDispensedSlot: null,
    dropSensorConfirmed: false
  },

  // Idle Timer
  idleCountdown: 60
};

/**
 * Reactive Store via ES6 Proxy
 */
export const store = new Proxy(rawState, {
  get(target, prop) {
    if (prop === 'setLanguage') return setLanguage;
    if (prop === 'addToCart') return addToCart;
    if (prop === 'clearCart') return clearCart;
    if (prop === 'cartTotal') {
      if (target.payment && target.payment.amount) {
        return target.payment.amount;
      }
      if (target.cart && target.cart.length > 0) {
        return target.cart.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0);
      }
      return 125000;
    }
    return target[prop];
  },

  set(target, prop, value) {
    const oldValue = target[prop];
    if (oldValue === value && typeof value !== 'object') {
      return true;
    }

    target[prop] = value;

    // Side-effects for core UI state
    if (prop === 'lang') {
      target.dir = (value === 'en') ? 'ltr' : 'rtl';
      if (typeof document !== 'undefined') {
        document.documentElement.lang = value;
        document.documentElement.dir = target.dir;
      }
    }

    // Micro-update: dispatch to subscribers for this specific key only (< 1ms target)
    if (subscribers.has(prop)) {
      const callbacks = subscribers.get(prop);
      for (const cb of callbacks) {
        try {
          cb(value, oldValue);
        } catch (err) {
          console.error(`[Store] Subscriber error for property "${String(prop)}":`, err);
        }
      }
    }

    // Global listeners
    for (const gcb of globalSubscribers) {
      try {
        gcb(prop, value, oldValue);
      } catch (err) {
        console.error('[Store] Global subscriber error:', err);
      }
    }

    return true;
  }
});

/**
 * Subscribe to changes on a specific store key
 * @param {string} prop - The state property name
 * @param {(newVal: any, oldVal: any) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export function subscribe(prop, callback) {
  if (!subscribers.has(prop)) {
    subscribers.set(prop, new Set());
  }
  subscribers.get(prop).add(callback);
  return () => {
    const list = subscribers.get(prop);
    if (list) list.delete(callback);
  };
}

/**
 * Subscribe to all state mutations
 * @param {(prop: string, newVal: any, oldVal: any) => void} callback
 * @returns {() => void}
 */
export function subscribeAll(callback) {
  globalSubscribers.add(callback);
  return () => globalSubscribers.delete(callback);
}

/**
 * Translate a key into the active language dictionary
 * @param {string} key
 * @param {string} [overrideLang]
 * @returns {string}
 */
export function t(key, overrideLang = null) {
  const lang = overrideLang || store.lang || 'fa';
  const dict = DICTIONARIES[lang] || DICTIONARIES.fa;
  return dict[key] || DICTIONARIES.fa[key] || key;
}

/**
 * Instant in-memory language switch
 * @param {'fa'|'en'|'ar'} lang
 */
export function setLanguage(lang) {
  if (DICTIONARIES[lang]) {
    store.lang = lang;
  }
}

/**
 * Add product to cart & configure payment parameters for single-item checkout
 * @param {object} product
 */
export function addToCart(product) {
  if (!product) return;
  const existingIndex = store.cart.findIndex(i => i.id === product.id);
  const updatedCart = [...store.cart];
  if (existingIndex > -1) {
    updatedCart[existingIndex] = {
      ...updatedCart[existingIndex],
      quantity: (updatedCart[existingIndex].quantity || 1) + 1
    };
  } else {
    updatedCart.push({ ...product, quantity: 1 });
  }
  store.cart = updatedCart;

  // Single-item purchase flow configuration
  store.payment = {
    amount: product.price,
    items: [{
      id: product.id,
      nameKey: product.nameKey,
      price: product.price,
      slotId: product.slotId
    }],
    countdown: 59,
    status: 'waiting_card',
    orderId: 'ORD-' + Math.floor(1000 + Math.random() * 9000)
  };
}

/**
 * Reset cart and payment parameters back to idle
 */
export function clearCart() {
  store.cart = [];
  store.payment = {
    amount: 0,
    items: [],
    countdown: 60,
    status: 'idle',
    orderId: null
  };
}
