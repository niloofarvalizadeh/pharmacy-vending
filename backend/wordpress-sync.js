/**
 * WordPress (WooCommerce) Pharmacy Inventory Synchronization Manager
 *
 * Responsibilities:
 * 1. Periodically (every 5 minutes) fetch medicine & product inventory from WordPress/WooCommerce.
 * 2. Store and update synced products in the local lightweight SQLite database.
 * 3. Broadcast updated products to the frontend touch UI in real-time.
 * 4. Send a POST request to WordPress to update/decrement inventory whenever a product is purchased.
 * 5. Handle offline resiliency: if the WordPress site is unreachable, keep local SQLite cache intact.
 */

'use strict';

const EventEmitter = require('node:events');

class WordPressSyncManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.wpUrl = (options.wpUrl || process.env.WP_URL || 'https://pharmacy-store.internal').replace(/\/+$/, '');
    this.wpApiPath = options.wpApiPath || process.env.WP_API_PATH || '/wp-json/wc/v3';
    this.consumerKey = options.consumerKey || process.env.WP_CONSUMER_KEY || '';
    this.consumerSecret = options.consumerSecret || process.env.WP_CONSUMER_SECRET || '';
    this.syncIntervalMs = parseInt(options.syncIntervalMs || process.env.WP_SYNC_INTERVAL_MS, 10) || 5 * 60 * 1000; // 5 minutes
    this.isMock = options.isMock !== undefined ? options.isMock : (process.env.WP_MOCK === 'true');

    this.db = null;
    this.broadcast = null;
    this.timer = null;

    this.lastSyncAt = null;
    this.lastSyncStatus = 'IDLE'; // IDLE, SYNCING, SUCCESS, FAILED
    this.lastSyncCount = 0;
    this.lastSyncError = null;
  }

  /**
   * Initialize with database and WebSocket broadcast references
   */
  init({ db, broadcast }) {
    this.db = db;
    this.broadcast = broadcast;

    console.log(`[WordPressSync] Initialized. Target: ${this.wpUrl} | Cadence: every ${this.syncIntervalMs / 60000} minutes`);

    // Initial sync after brief delay for server setup
    setTimeout(() => {
      this.syncProducts().catch(err => {
        console.warn('[WordPressSync] Initial sync notice:', err.message);
      });
    }, 2000);

    // 5-minute recurring timer
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      console.log(`[WordPressSync] 5-minute trigger: starting automated inventory synchronization...`);
      this.syncProducts().catch(err => {
        console.warn('[WordPressSync] Scheduled sync notice:', err.message);
      });
    }, this.syncIntervalMs);
  }

  /**
   * Generate Basic Auth header for WooCommerce REST API
   */
  _getAuthHeader() {
    if (this.consumerKey && this.consumerSecret) {
      const token = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
      return { Authorization: `Basic ${token}` };
    }
    return {};
  }

  /**
   * Fetch all products from WordPress WooCommerce REST API and update SQLite
   */
  async syncProducts() {
    this.lastSyncStatus = 'SYNCING';
    this.emit('sync_start');

    // If mock mode is explicitly enabled or URL is placeholder in local test
    if (this.isMock) {
      return this._performMockSync();
    }

    const endpoint = `${this.wpUrl}${this.wpApiPath}/products?per_page=100&status=publish`;
    console.log(`[WordPressSync] Fetching inventory from WordPress: ${endpoint}`);

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Pharmacy-Vending-Kiosk/2.4',
          ...this._getAuthHeader()
        },
        signal: AbortSignal.timeout(10000) // 10s timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const wpProducts = await response.json();
      if (!Array.isArray(wpProducts)) {
        throw new Error('Unexpected response format: expected an array of products');
      }

      // Map WooCommerce products to Kiosk database format
      const normalized = wpProducts.map((p, idx) => {
        // Look for slot metadata if available
        let slotId = null;
        let slotCode = null;
        if (Array.isArray(p.meta_data)) {
          const slotMeta = p.meta_data.find(m => m.key === 'slot_id' || m.key === '_slot_id');
          if (slotMeta) slotId = parseInt(slotMeta.value, 10);
          const codeMeta = p.meta_data.find(m => m.key === 'slot_code' || m.key === '_slot_code');
          if (codeMeta) slotCode = String(codeMeta.value);
        }

        // Try parsing slot code from SKU (e.g. "A1", "B2")
        if (!slotCode && p.sku && /^[A-F][1-4]$/i.test(p.sku.trim())) {
          slotCode = p.sku.trim().toUpperCase();
        }

        // Parse price (convert from Rial to Toman if > 100,000, or keep raw)
        const rawPrice = parseFloat(p.price || p.regular_price || 0);
        const price = Math.round(rawPrice);

        // Stock quantity
        let stock = 0;
        if (p.stock_quantity !== null && p.stock_quantity !== undefined) {
          stock = Math.max(0, parseInt(p.stock_quantity, 10));
        } else if (p.stock_status === 'instock') {
          stock = 15;
        }

        // Category mapping
        let category = 'head';
        if (Array.isArray(p.categories) && p.categories.length > 0) {
          const catSlug = (p.categories[0].slug || '').toLowerCase();
          if (catSlug.includes('head') || catSlug.includes('pain') || catSlug.includes('سر')) category = 'head';
          else if (catSlug.includes('chest') || catSlug.includes('lung') || catSlug.includes('سینه') || catSlug.includes('سرما')) category = 'chest';
          else if (catSlug.includes('stomach') || catSlug.includes('gut') || catSlug.includes('معده')) category = 'stomach';
          else if (catSlug.includes('skin') || catSlug.includes('پوست')) category = 'skin';
        }

        return {
          wp_id: p.id,
          product_code: p.sku || `WP-${p.id}`,
          name_fa: p.name,
          name_en: p.slug || p.name,
          category,
          sub_category_fa: (p.categories && p.categories[0] && p.categories[0].name) || 'داروخانه',
          slot_id: slotId,
          slot_code: slotCode,
          indication_fa: p.short_description ? p.short_description.replace(/<[^>]*>/g, '') : '',
          price,
          stock,
          is_active: p.status === 'publish' && p.stock_status !== 'outofstock' ? 1 : 0
        };
      });

      // Upsert into SQLite
      if (this.db) {
        this.db.batchUpsertWordPressProducts(normalized);
        this.db.logWordPressSync('SCHEDULED_5MIN', 'SUCCESS', normalized.length, `Synced from ${endpoint}`);
      }

      this.lastSyncAt = new Date().toISOString();
      this.lastSyncStatus = 'SUCCESS';
      this.lastSyncCount = normalized.length;
      this.lastSyncError = null;

      console.log(`[WordPressSync] ✅ Successfully synced ${normalized.length} products from WordPress!`);

      // Send to frontend
      this._broadcastUpdates(normalized.length);

      this.emit('sync_success', { count: normalized.length, timestamp: this.lastSyncAt });
      return { success: true, count: normalized.length, timestamp: this.lastSyncAt };

    } catch (err) {
      this.lastSyncStatus = 'FAILED';
      this.lastSyncError = err.message;
      this.lastSyncAt = new Date().toISOString();

      console.warn(`[WordPressSync] ⚠️ Unable to connect to WordPress (${err.message}). Local SQLite cache preserved.`);

      if (this.db) {
        this.db.logWordPressSync('SCHEDULED_5MIN', 'FAILED', 0, err.message);
      }

      if (this.broadcast) {
        this.broadcast({
          type: 'WP_SYNC_COMPLETED',
          data: {
            status: 'FAILED',
            error: err.message,
            lastSyncAt: this.lastSyncAt,
            productsCount: this.db ? this.db.getProducts('all').length : 0
          }
        });
      }

      this.emit('sync_error', { error: err.message, timestamp: this.lastSyncAt });
      return { success: false, error: err.message, fallback: 'SQLite cache retained' };
    }
  }

  /**
   * Broadcast fresh products to all WebSocket clients (touchscreen frontend)
   */
  _broadcastUpdates(syncedCount) {
    if (!this.broadcast || !this.db) return;

    const allProducts = this.db.getProducts('all');
    this.broadcast({
      type: 'PRODUCTS_UPDATED',
      data: {
        products: allProducts,
        medicines: allProducts,
        source: 'WORDPRESS_SYNC',
        lastSyncAt: this.lastSyncAt,
        count: syncedCount
      }
    });

    this.broadcast({
      type: 'WP_SYNC_COMPLETED',
      data: {
        status: 'SUCCESS',
        lastSyncAt: this.lastSyncAt,
        productsCount: syncedCount
      }
    });
  }

  /**
   * Mock sync for offline / dev / automated tests
   */
  _performMockSync() {
    this.lastSyncAt = new Date().toISOString();
    this.lastSyncStatus = 'SUCCESS';
    const products = this.db ? this.db.getProducts('all') : [];
    this.lastSyncCount = products.length;

    if (this.db) {
      this.db.logWordPressSync('SCHEDULED_5MIN', 'SUCCESS', products.length, 'Mock sync executed cleanly');
    }

    console.log(`[WordPressSync] Mock Sync: verified ${products.length} local inventory items in SQLite.`);
    this._broadcastUpdates(products.length);

    this.emit('sync_success', { count: products.length, timestamp: this.lastSyncAt });
    return { success: true, count: products.length, mock: true, timestamp: this.lastSyncAt };
  }

  /**
   * Send a POST request to WordPress to update inventory for a purchased product
   *
   * @param {number|string} productId Product ID in kiosk database
   * @param {number} purchasedQuantity Number of units purchased (default 1)
   */
  async updateWordPressStock(productId, purchasedQuantity = 1) {
    if (!this.db) return { success: false, reason: 'Database not initialized' };

    const product = typeof productId === 'object' ? productId : (this.db.getProductById(productId) || this.db.getProductBySlot(productId));
    if (!product) {
      console.warn(`[WordPressSync] Cannot update WordPress stock: Product ${productId} not found.`);
      return { success: false, reason: 'Product not found' };
    }

    const wpId = product.wp_id || product.id;
    const remainingStock = Math.max(0, product.stock);

    console.log(`[WordPressSync] 📤 Sending POST request to WordPress for Product ${product.name_fa} (WP-ID: ${wpId}). Purchased: ${purchasedQuantity}, Remaining: ${remainingStock}`);

    // If mock mode is active
    if (this.isMock) {
      const details = `POST (Mock) to /wp-json/wc/v3/products/${wpId} -> stock_quantity: ${remainingStock}`;
      this.db.logWordPressSync('STOCK_PUSH', 'SUCCESS', 1, details);
      console.log(`[WordPressSync] ✅ (Mock) WordPress inventory updated successfully: ${details}`);
      return { success: true, mock: true, wpId, remainingStock };
    }

    const endpoint = `${this.wpUrl}${this.wpApiPath}/products/${wpId}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Pharmacy-Vending-Kiosk/2.4',
          ...this._getAuthHeader()
        },
        body: JSON.stringify({
          stock_quantity: remainingStock,
          manage_stock: true
        }),
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const resData = await response.json();
      const details = `Stock updated for WP-ID ${wpId} to ${remainingStock}`;
      this.db.logWordPressSync('STOCK_PUSH', 'SUCCESS', 1, details);

      console.log(`[WordPressSync] ✅ WordPress stock update POST acknowledged for WP-ID ${wpId}`);
      return { success: true, wpId, remainingStock, response: resData };

    } catch (err) {
      console.warn(`[WordPressSync] ⚠️ POST stock update to WordPress failed: ${err.message}. Stock kept in SQLite.`);
      this.db.logWordPressSync('STOCK_PUSH', 'FAILED', 1, `Failed WP-ID ${wpId}: ${err.message}`);
      return { success: false, error: err.message, localStock: remainingStock };
    }
  }

  /**
   * Return current sync status
   */
  getStatus() {
    return {
      wpUrl: this.wpUrl,
      lastSyncAt: this.lastSyncAt,
      lastSyncStatus: this.lastSyncStatus,
      lastSyncCount: this.lastSyncCount,
      lastSyncError: this.lastSyncError,
      syncIntervalMinutes: Math.round(this.syncIntervalMs / 60000),
      isMock: this.isMock
    };
  }
}

module.exports = {
  WordPressSyncManager
};
