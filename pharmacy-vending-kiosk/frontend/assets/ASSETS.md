# Kiosk Assets Documentation & Replacements

## Design System & Mockups Reference
Extracted from UI mockups in `design/`:
1. `Home.jpg` (1080 × 1920) - Home Screen (داروخانه دکتر موحد)
2. `list.jpg` (1080 × 1920) - Catalog View (سلامت جنسی)
3. `theEnd.jpg` (1080 × 1920) - Payment View (لطفاً کارت را بکشید)
4. `thanku.jpg` (1080 × 1920) - Success & Dispense View (از خرید شما متشکریم)

---

## 1. Fonts (`assets/fonts/`)
Local Vazirmatn woff2 files required for offline zero-CDN kiosk operation:
- `Vazirmatn-Regular.woff2` (Weight 400 - Body & descriptions)
- `Vazirmatn-Medium.woff2` (Weight 500 - Subheadings, labels)
- `Vazirmatn-Bold.woff2` (Weight 700 - Titles, buttons, prices)
- `Vazirmatn-Black.woff2` (Weight 900 - Hero headlines)

*Status*: Initialized and declared via `@font-face` in `css/kiosk.css`.

---

## 2. Product Images (`assets/products-webp/`)
Target format: WebP / SVG (quality ≥ 80, sRGB, transparent background or crisp cards)
- `vitaminc.svg` / `vitaminc.webp` - قرص جوشان ویتامین C (۷۵,۰۰۰ تومان)
- `multivitamin.svg` / `multivitamin.webp` - مولتی‌ویتامین (۱۴۰,۰۰۰ تومان)
- `omega3.svg` / `omega3.webp` - کپسول امگا ۳ (۱۹۵,۰۰۰ تومان)
- `kodex_classic.webp` - کاندوم کلاسیک کدکس (۹۵,۰۰۰ تومان)
- `durex_lube.webp` - ژل لوبریکانت روان‌کننده دورکس (۸۵,۰۰۰ تومان)
- `feminine_wash.webp` - ژل بهداشتی بانوان (۱۳۵,۰۰۰ تومان)
- `pregnancy_test.webp` - تست بارداری خودکار (۴۵,۰۰۰ تومان)

*Status*: High-fidelity, zero-rasterization SVG vector graphics created for best sellers and currently active.

---

## 3. Illustrations & Banners
- `banner.svg` / `banner.webp` - Banner in Home view ("ویدیوهای آموزشی و سلامت")
- `assets/img/pos-illustration.svg` - Pixel-faithful isometric POS payment terminal with purple-blue gradient card and pulse glow slot
- Layered checkmark badge (`.success-badge-container`) with disc entrance and SVG checkmark draw
- Static SVG background décor (wavy lines, pill capsules, soft crosses)
- Bottom pickup guide glowing chevron mark (`.pickup-guide-container`)

*Status*: Isometric POS illustration active at `assets/img/pos-illustration.svg`; Success view vector badge & decor active in `index.html` & `css/kiosk.css`.

---

## 4. Video Loops (`assets/video/`)
- `education.webm` - Educational VP9 WebM video loop for hardware VP9 acceleration
