/**
 * format.js - High Performance Number & Currency Formatting for Kiosk Touchscreen
 * Zero-dependency ES Module. Pure in-memory string conversions.
 */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/**
 * Convert any string or number to Persian digits
 * @param {number|string} val 
 * @returns {string}
 */
export function toPersianDigits(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/[0-9]/g, (d) => FA_DIGITS[d]);
}

/**
 * Convert any string or number to Arabic-Indic digits
 * @param {number|string} val 
 * @returns {string}
 */
export function toArabicDigits(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/[0-9]/g, (d) => AR_DIGITS[d]);
}

/**
 * Format price with thousands comma separators and localized digits
 * @param {number|string} amount e.g. 195000 -> "۱۹۵,۰۰۰"
 * @param {'fa'|'en'|'ar'} [lang='fa']
 * @returns {string}
 */
export function formatPrice(amount, lang = 'fa') {
  if (amount === null || amount === undefined || isNaN(Number(amount))) {
    return lang === 'en' ? '0' : (lang === 'ar' ? '٠' : '۰');
  }
  
  const num = Math.round(Number(amount));
  // Format with standard thousands separator
  const separated = num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  if (lang === 'fa') {
    return toPersianDigits(separated);
  } else if (lang === 'ar') {
    return toArabicDigits(separated);
  }
  return separated;
}

/**
 * Format price with currency unit
 * @param {number|string} amount
 * @param {'fa'|'en'|'ar'} [lang='fa']
 * @param {string} [customUnit]
 * @returns {string} e.g. "۱۹۵,۰۰۰ تومان"
 */
export function formatPriceWithUnit(amount, lang = 'fa', customUnit = null) {
  const formatted = formatPrice(amount, lang);
  let unit = customUnit;
  if (!unit) {
    if (lang === 'en') unit = 'Toman';
    else if (lang === 'ar') unit = 'تومان';
    else unit = 'تومان';
  }
  return `${formatted} ${unit}`;
}

/**
 * Format any integer/float into localized digits
 * @param {number|string} val
 * @param {'fa'|'en'|'ar'} [lang='fa']
 * @returns {string}
 */
export function formatNumber(val, lang = 'fa') {
  if (val === null || val === undefined) return '';
  if (lang === 'fa') return toPersianDigits(val);
  if (lang === 'ar') return toArabicDigits(val);
  return String(val);
}
