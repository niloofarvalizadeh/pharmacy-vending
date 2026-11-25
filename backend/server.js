'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { WebSocketServer, WebSocket } = require('ws');

const { db } = require('./database');
const { HardwareManager } = require('./hardware');
const { WordPressSyncManager } = require('./wordpress-sync');
const { PosBridgeManager } = require('./posBridge');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const FRONTEND_DIR = path.resolve(__dirname, '..', 'frontend');

// MIME types for pure node:http file serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Initialize Database & Hardware (Hardware untouched)
db.init();
const hardware = new HardwareManager({
  port: process.env.SERIAL_PORT || '/dev/ttyUSB0',
  baudRate: parseInt(process.env.BAUD_RATE, 10) || 9600,
  enableMock: process.env.ENABLE_MOCK === 'true' // Real hardware by default
});

// Initialize PosBridge & WordPress Sync
const wordpressSync = new WordPressSyncManager();
const posBridge = new PosBridgeManager();

// System version metadata
const SYSTEM_VERSIONS = {
  appVersion: 'v2.4.1-core',
  mcuFirmware: 'v1.8.0',
  buildDate: '2026-11-09',
  architecture: 'x86_64-linux (Intel Core i5-5200U)'
};

// Cloud MQTT Gateway Connection State (Simulated resilient connection)
const cloudState = {
  connected: true,
  brokerUrl: 'mqtts://cloud.smart-pharmacy-vending.internal:8883',
  clientId: 'KIOSK-TEH-0021-IR',
  lastSyncAt: new Date().toISOString(),
  pendingLogsCount: 0,
  tlsSecured: true
};

// Ring buffer for the most recent 100 raw hardware frames (for Admin Monitor)
const recentLogs = [];
function addHardwareLog(log) {
  recentLogs.push(log);
  if (recentLogs.length > 100) recentLogs.shift();
}

/**
 * Pure HTTP Server
 */
const server = http.createServer((req, res) => {
  // CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = url.pathname;

  // REST API Endpoints
  if (pathname === '/api/products' || pathname === '/api/medicines') {
    const category = url.searchParams.get('category') || 'all';
    const products = db.getProducts(category);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: products.length, products, medicines: products }));
    return;
  }

  if (pathname === '/api/categories') {
    const categories = db.getCategories();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, categories }));
    return;
  }

  if (pathname === '/api/transactions') {
    const status = url.searchParams.get('status') || 'ALL';
    const moduleName = url.searchParams.get('module') || 'ALL';
    const transactions = db.getTransactions({ status, module: moduleName });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: transactions.length, transactions }));
    return;
  }

  if (pathname === '/api/inventory-logs') {
    const logs = db.getInventoryAuditLogs(50);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: logs.length, logs }));
    return;
  }

  if (pathname === '/api/system-errors') {
    const errors = db.getSystemErrors();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, errors }));
    return;
  }

  if (pathname === '/api/status') {
    const status = {
      online: true,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      system: SYSTEM_VERSIONS,
      cloud: cloudState,
      posBridge: posBridge.getStatus(),
      wordpress: wordpressSync.getStatus(),
      hardware: {
        connected: hardware.isConnected,
        isMock: hardware.isMock,
        port: hardware.isMock ? 'ATMEGA_VIRTUAL_MOCK' : hardware.portPath,
        outputs: hardware.statusCache.outputs,
        lastPingLatencyMs: hardware.statusCache.lastPingLatencyMs
      }
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return;
  }

  // Helper for JSON body parsing
  const parseJsonBody = () => new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });

  // PosBridge REST API Endpoints
  if (pathname === '/api/posbridge/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, posBridge: posBridge.getStatus() }));
    return;
  }

  if (pathname === '/api/posbridge/start-transaction' && req.method === 'POST') {
    parseJsonBody().then(async (body) => {
      const result = await posBridge.displayPrice(body.amount, {
        trxCode: body.trxCode,
        productId: body.productId,
        slotId: body.slotId,
        description: body.description
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result }));
    });
    return;
  }

  if (pathname === '/api/posbridge/callback' && req.method === 'POST') {
    parseJsonBody().then((body) => {
      const result = posBridge.handleBankResponse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result }));
    });
    return;
  }

  if (pathname === '/api/posbridge/simulate-swipe' && req.method === 'POST') {
    parseJsonBody().then((body) => {
      const result = posBridge.simulateCardSwipe(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result }));
    });
    return;
  }

  // WordPress Inventory Sync REST API Endpoints
  if (pathname === '/api/wordpress/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, wordpress: wordpressSync.getStatus() }));
    return;
  }

  if (pathname === '/api/wordpress/sync' && req.method === 'POST') {
    wordpressSync.syncProducts().then((result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result }));
    });
    return;
  }

  // Static File Serving
  if (pathname === '/') {
    pathname = '/index.html';
  }

  // Prevent directory traversal attacks
  const safePath = path.normalize(path.join(FRONTEND_DIR, pathname));
  if (!safePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(safePath);
    stream.pipe(res);
  });
});

/**
 * WebSocket Server
 */
const wss = new WebSocketServer({ server });

/**
 * Broadcast message to all active WebSocket clients
 * @param {object} message 
 */
function broadcast(message) {
  const json = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

// Initialize PosBridge & WordPress 5-Minute Inventory Sync
wordpressSync.init({ db, broadcast });
posBridge.init({ db, broadcast });

/**
 * Shared Safe Hardware Dispense Flow (Two-Phase Verification + WordPress Inventory Update)
 */
async function executeDispenseFlow({ trxCode, medicineId, slotId, simulateFailure, ws = null }) {
  const prod = db.getProductById(medicineId) || db.getProductBySlot(slotId);

  if (!prod || prod.stock <= 0) {
    if (trxCode) {
      db.updateTransactionStatus(trxCode, 'FAILED', { errorCode: 'E005', module: 'DSP' });
    }
    const failMsg = {
      type: 'DISPENSE_FAILED',
      data: {
        trxCode,
        medicineId,
        slotId,
        reason: 'OUT_OF_STOCK',
        errorCode: 'E005',
        message_fa: 'متاسفانه موجودی این دارو به اتمام رسیده است.'
      }
    };
    if (ws) ws.send(JSON.stringify(failMsg));
    broadcast(failMsg);
    return;
  }

  // Phase 1: Motor Rotation
  broadcast({
    type: 'DISPENSE_STAGE',
    data: {
      trxCode,
      stage: 1,
      phase: 'MOTOR_ROTATION',
      message_fa: 'در حال آماده‌سازی و چرخش موتور اسپیرال...'
    }
  });

  // Forced simulated failure if requested (for testing auto-refund E001/E002/E003)
  if (simulateFailure) {
    setTimeout(() => {
      const errCode = simulateFailure === 'TIMEOUT' ? 'E003' : 'E002';
      db.triggerSystemError(errCode);
      if (trxCode) {
        db.updateTransactionStatus(trxCode, 'REFUND_PENDING', {
          errorCode: errCode,
          module: 'DSP'
        });
      }
      broadcast({
        type: 'DISPENSE_FAILED',
        data: {
          trxCode,
          medicineId,
          slotId,
          reason: errCode === 'E003' ? 'MOTOR_TIMEOUT' : 'DROP_SENSOR_FAILED',
          errorCode: errCode,
          refundPending: true,
          message_fa: 'متاسفانه کالا تحویل نشد؛ مبلغ پرداختی شما به صورت خودکار مسترد می‌گردد (Refund Pending)',
          supportPhone: '۰۲۱-۸۸۸۸۴۴۴۴'
        }
      });
      broadcast({
        type: 'SYSTEM_ERRORS_UPDATED',
        data: { errors: db.getSystemErrors() }
      });
      broadcast({
        type: 'TRANSACTIONS_UPDATED',
        data: { transactions: db.getTransactions() }
      });
    }, 2500);
    return;
  }

  try {
    // Delay briefly to allow UI to show Phase 1
    await new Promise(r => setTimeout(r, 1200));

    // Phase 2: Drop Sensor Verification
    broadcast({
      type: 'DISPENSE_STAGE',
      data: {
        trxCode,
        stage: 2,
        phase: 'DROP_SENSOR_CHECK',
        message_fa: 'بررسی سنسور سقوط کالا (Drop Sensor)...'
      }
    });

    // Run hardware motor command via ATmega protocol (HARDWARE UNTOUCHED)
    const result = await hardware.dispense(slotId, 1);

    // Decrement stock in database atomically & log SHA-256 audit
    const remainingStock = db.decrementStock(slotId, 1);

    // Send POST request to WordPress to update inventory for purchased medicine
    wordpressSync.updateWordPressStock(prod.id, 1).catch(err => {
      console.warn('[WordPressSync] Stock push notice:', err.message);
    });

    // Update transaction to DISPENSED
    if (trxCode) {
      db.updateTransactionStatus(trxCode, 'DISPENSED', { module: 'DSP' });
    }

    broadcast({
      type: 'DISPENSE_COMPLETE',
      data: {
        trxCode,
        medicineId: prod.id,
        slotId,
        remainingStock,
        seq: result.seq,
        durationMs: result.durationMs,
        product_name_fa: prod.name_fa
      }
    });

    broadcast({
      type: 'STOCK_UPDATED',
      data: {
        slotId,
        productId: prod.id,
        newStock: remainingStock,
        products: db.getProducts('all')
      }
    });

    broadcast({
      type: 'AUDIT_LOG_ADDED',
      data: { logs: db.getInventoryAuditLogs(20) }
    });

    broadcast({
      type: 'TRANSACTIONS_UPDATED',
      data: { transactions: db.getTransactions() }
    });

  } catch (err) {
    // Hardware error -> Transition to REFUND_PENDING
    const errCode = err.message.includes('TIMEOUT') ? 'E003' : 'E001';
    db.triggerSystemError(errCode);

    if (trxCode) {
      db.updateTransactionStatus(trxCode, 'REFUND_PENDING', {
        errorCode: errCode,
        module: 'DSP'
      });
    }

    broadcast({
      type: 'DISPENSE_FAILED',
      data: {
        trxCode,
        medicineId: prod.id,
        slotId,
        reason: err.message,
        errorCode: errCode,
        refundPending: true,
        message_fa: 'متاسفانه کالا تحویل نشد؛ مبلغ پرداختی شما به صورت خودکار مسترد می‌گردد (Refund Pending)',
        supportPhone: '۰۲۱-۸۸۸۸۴۴۴۴'
      }
    });

    broadcast({
      type: 'SYSTEM_ERRORS_UPDATED',
      data: { errors: db.getSystemErrors() }
    });

    broadcast({
      type: 'TRANSACTIONS_UPDATED',
      data: { transactions: db.getTransactions() }
    });
  }
}

// Automatically trigger dispense when PosBridge reports bank payment SUCCESS
posBridge.on('payment_success', async (trxData) => {
  const { trxCode, productId, slotId } = trxData;
  console.log(`[PosBridge] Bank transaction APPROVED for ${trxCode}. Starting dispense flow...`);

  db.updateTransactionStatus(trxCode, 'WAITING_PAYMENT', {
    paymentMethod: 'کارتخوان (PosBridge)',
    module: 'PAY'
  });

  broadcast({
    type: 'TRX_UPDATED',
    data: db.getTransaction(trxCode)
  });
  broadcast({
    type: 'TRANSACTIONS_UPDATED',
    data: { transactions: db.getTransactions() }
  });

  await executeDispenseFlow({
    trxCode,
    medicineId: productId,
    slotId
  });
});

// Update transaction when PosBridge reports bank payment FAILED
posBridge.on('payment_failed', (trxData) => {
  const { trxCode, errorCode, message_fa } = trxData;
  console.warn(`[PosBridge] Bank transaction REJECTED for ${trxCode}: ${errorCode} (${message_fa})`);

  db.updateTransactionStatus(trxCode, 'FAILED', {
    paymentMethod: 'کارتخوان (PosBridge)',
    errorCode: errorCode || 'E005',
    module: 'PAY'
  });

  broadcast({
    type: 'TRX_UPDATED',
    data: db.getTransaction(trxCode)
  });
  broadcast({
    type: 'TRANSACTIONS_UPDATED',
    data: { transactions: db.getTransactions() }
  });
});

// Hardware Event Listeners -> Bridge to WebSocket clients
hardware.on('connection', (conn) => {
  broadcast({
    type: 'HARDWARE_STATUS',
    data: {
      connected: conn.connected,
      isMock: conn.isMock,
      port: conn.port,
      outputs: hardware.statusCache.outputs
    }
  });
});

hardware.on('tx_stage', (stageInfo) => {
  broadcast({
    type: 'HARDWARE_STAGE',
    data: stageInfo
  });
});

hardware.on('raw_tx', (txData) => {
  const log = {
    timestamp: txData.timestamp,
    direction: 'TX',
    hex: txData.rawHex,
    length: txData.length
  };
  addHardwareLog(log);
  broadcast({ type: 'HARDWARE_LOG', data: log });
});

hardware.on('raw_rx', (rxData) => {
  const log = {
    timestamp: rxData.timestamp,
    direction: 'RX',
    hex: rxData.rawHex,
    typeName: rxData.typeName,
    cmdName: rxData.cmdName,
    seq: rxData.seq,
    len: rxData.len,
    data: rxData.data,
    crc: rxData.crc
  };
  addHardwareLog(log);
  broadcast({ type: 'HARDWARE_LOG', data: log });
});

hardware.on('hardware_log', (logEntry) => {
  broadcast({
    type: 'HARDWARE_INTERNAL_LOG',
    data: logEntry
  });
});

// Periodic Cloud Sync Simulator (updates timestamp every 60 seconds)
setInterval(() => {
  cloudState.lastSyncAt = new Date().toISOString();
  broadcast({
    type: 'CLOUD_STATUS',
    data: cloudState
  });
}, 60000);

function clearMockPaymentTimers(ws) {
  if (ws._payTimer) {
    clearTimeout(ws._payTimer);
    ws._payTimer = null;
  }
  if (ws._dropTimer) {
    clearTimeout(ws._dropTimer);
    ws._dropTimer = null;
  }
  if (ws._receiptTimer) {
    clearTimeout(ws._receiptTimer);
    ws._receiptTimer = null;
  }
}

function sendWsJson(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// WebSocket Client Connection Handler
wss.on('connection', (ws) => {
  ws.on('close', () => {
    clearMockPaymentTimers(ws);
  });

  // Send Initial Snapshot
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    data: {
      categories: db.getCategories(),
      products: db.getProducts('all'),
      medicines: db.getProducts('all'),
      systemErrors: db.getSystemErrors(),
      transactions: db.getTransactions(),
      auditLogs: db.getInventoryAuditLogs(20),
      system: SYSTEM_VERSIONS,
      cloud: cloudState,
      posBridge: posBridge.getStatus(),
      wordpress: wordpressSync.getStatus(),
      hardware: {
        connected: hardware.isConnected,
        isMock: hardware.isMock,
        port: hardware.isMock ? 'ATMEGA_VIRTUAL_MOCK' : hardware.portPath,
        outputs: hardware.statusCache.outputs,
        lastPingLatencyMs: hardware.statusCache.lastPingLatencyMs
      },
      recentLogs
    }
  }));

  // Handle Incoming Client Messages
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return ws.send(JSON.stringify({ type: 'ERROR', message: 'Malformed JSON' }));
    }

    switch (msg.type) {
      // ---------------------------------------------------------
      // PROMPT 0 & PROMPT 5 ARCHITECTURE STANDARD HARDWARE EVENTS
      // ---------------------------------------------------------
      case 'SLOT_CHECK': {
        const slotId = msg.slotId || (msg.data && msg.data.slotId) || 'A1';
        const prod = db.getProductBySlot ? db.getProductBySlot(slotId) : null;
        const inStock = prod ? prod.stock > 0 : true;
        sendWsJson(ws, {
          type: 'SLOT_STATUS',
          status: 'ok',
          data: {
            ok: inStock,
            slotId,
            stock: prod ? prod.stock : 10
          }
        });
        break;
      }

      case 'PAY_REQUEST': {
        const amount = msg.amount || (msg.data && msg.data.amount) || 0;
        console.log(`[WS Mock] PAY_REQUEST received for amount: ${amount}`);
        clearMockPaymentTimers(ws);

        // 1. Simulate POS approval after short realistic delay (2.5s)
        ws._payTimer = setTimeout(() => {
          ws._payTimer = null;
          sendWsJson(ws, {
            type: 'POS_ACK',
            status: 'success',
            data: { status: 'success', amount }
          });

          // 2. Simulate mechanical DROP_SUCCESS 1.5s after POS approval
          ws._dropTimer = setTimeout(() => {
            ws._dropTimer = null;
            sendWsJson(ws, {
              type: 'DROP_SUCCESS',
              data: { slotId: 'A1' }
            });
          }, 1500);

          // 3. Simulate RECEIPT_PRINTED 3.5s after POS approval
          ws._receiptTimer = setTimeout(() => {
            ws._receiptTimer = null;
            sendWsJson(ws, {
              type: 'RECEIPT_PRINTED',
              data: {}
            });
          }, 3500);
        }, 2500);
        break;
      }

      case 'PAY_CANCEL': {
        const reason = msg.reason || (msg.data && msg.data.reason) || 'user';
        console.log(`[WS Mock] PAY_CANCEL received. Reason: ${reason}`);
        clearMockPaymentTimers(ws);
        sendWsJson(ws, {
          type: 'POS_ACK',
          status: 'cancelled',
          data: { status: 'cancelled', reason }
        });
        break;
      }

      // ---------------------------------------------------------
      // CUSTOMER FLOW: TRANSACTIONS & DISPENSE
      // ---------------------------------------------------------

      // Screen 3: Register transaction in SELECTED state
      case 'CREATE_TRX':
      case 'CREATE_TRANSACTION': {
        const { productId, slotId, amount } = msg;
        const trx = db.createTransaction(productId, slotId, amount);
        ws.send(JSON.stringify({
          type: 'TRX_CREATED',
          data: trx
        }));
        broadcast({
          type: 'TRANSACTIONS_UPDATED',
          data: { transactions: db.getTransactions() }
        });
        break;
      }

      // Screen 4 & 5: Transition state (e.g. WAITING_PAYMENT, REFUND_PENDING, etc.)
      case 'UPDATE_TRX_STATUS': {
        const { trxCode, status, paymentMethod, errorCode, module: mod } = msg;
        const updated = db.updateTransactionStatus(trxCode, status, {
          paymentMethod,
          errorCode,
          module: mod
        });
        broadcast({
          type: 'TRX_UPDATED',
          data: updated
        });
        broadcast({
          type: 'TRANSACTIONS_UPDATED',
          data: { transactions: db.getTransactions() }
        });
        break;
      }

      // Screen 5: Hardware Dispense Request with Two-Phase Execution
      case 'DISPENSE_REQUEST': {
        const { trxCode, medicineId, slotId, simulateFailure } = msg;
        await executeDispenseFlow({ trxCode, medicineId, slotId, simulateFailure, ws });
        break;
      }

      // ---------------------------------------------------------
      // POSBRIDGE INTEGRATION
      // ---------------------------------------------------------

      // Display price on POS Terminal via PosBridge when customer selects product
      case 'POS_START_TRANSACTION':
      case 'START_POS_PAYMENT': {
        const { productId, slotId, amount, trxCode } = msg;
        let trx = trxCode ? db.getTransaction(trxCode) : null;
        if (!trx) {
          trx = db.createTransaction(productId, slotId, amount, 'کارتخوان (PosBridge)');
        }
        const prod = db.getProductById(productId) || db.getProductBySlot(slotId);
        const description = prod ? `خرید ${prod.name_fa}` : 'خرید از کیوسک داروخانه';

        await posBridge.displayPrice(amount, {
          trxCode: trx.trx_code,
          productId,
          slotId,
          description
        });
        break;
      }

      // Simulate customer card swipe & bank authorization
      case 'POS_SIMULATE_SWIPE': {
        const { success, errorCode, message_fa } = msg;
        posBridge.simulateCardSwipe({
          success: success !== false,
          errorCode,
          message_fa
        });
        break;
      }

      // Cancel active POS transaction
      case 'POS_CANCEL': {
        const { trxCode } = msg;
        posBridge.cancelTransaction('USER_CANCEL');
        if (trxCode) {
          db.updateTransactionStatus(trxCode, 'FAILED', {
            paymentMethod: 'کارتخوان (PosBridge)',
            errorCode: 'USER_CANCEL',
            module: 'PAY'
          });
        }
        broadcast({
          type: 'TRANSACTIONS_UPDATED',
          data: { transactions: db.getTransactions() }
        });
        break;
      }

      // ---------------------------------------------------------
      // WORDPRESS INVENTORY INTEGRATION
      // ---------------------------------------------------------

      // Manual sync trigger from frontend / admin
      case 'WP_SYNC_NOW': {
        const res = await wordpressSync.syncProducts();
        ws.send(JSON.stringify({
          type: 'WP_SYNC_RESULT',
          data: res
        }));
        break;
      }

      // ---------------------------------------------------------
      // ADMIN & OPERATOR ACTIONS
      // ---------------------------------------------------------

      // Tab 1: Adjust Inventory Stock (+ / -) with SHA-256 Audit Trail
      case 'ADMIN_ADJUST_STOCK': {
        const { slotId, delta, user } = msg;
        const res = db.adjustStock(slotId, delta, user || 'operator');
        if (res) {
          broadcast({
            type: 'STOCK_UPDATED',
            data: {
              slotId: res.slot_id,
              productId: res.product_id,
              newStock: res.new_stock,
              delta: res.delta,
              hash: res.hash,
              products: db.getProducts('all')
            }
          });
          broadcast({
            type: 'AUDIT_LOG_ADDED',
            data: { logs: db.getInventoryAuditLogs(20) }
          });
        }
        break;
      }

      // Tab 1: Toggle Slot Enabled / Disabled
      case 'ADMIN_TOGGLE_SLOT': {
        const { slotId, isActive } = msg;
        const updated = db.toggleSlotActive(slotId, isActive);
        broadcast({
          type: 'SLOT_UPDATED',
          data: {
            slotId,
            isActive: updated ? updated.is_active : (isActive ? 1 : 0),
            products: db.getProducts('all')
          }
        });
        break;
      }

      // Tab 2: Trigger System Error (E001 - E010)
      case 'ADMIN_TRIGGER_ERROR': {
        const { code } = msg;
        const errors = db.triggerSystemError(code);
        broadcast({
          type: 'SYSTEM_ERRORS_UPDATED',
          data: { errors }
        });
        break;
      }

      // Tab 2: Resolve / Acknowledge System Error
      case 'ADMIN_RESOLVE_ERROR': {
        const { code } = msg;
        const errors = db.resolveSystemError(code);
        broadcast({
          type: 'SYSTEM_ERRORS_UPDATED',
          data: { errors }
        });
        break;
      }

      // Tab 4: Simulate OTA Firmware / Software Check
      case 'ADMIN_CHECK_OTA': {
        // Return OTA status simulation
        ws.send(JSON.stringify({
          type: 'ADMIN_OTA_STATUS',
          data: {
            currentVersion: SYSTEM_VERSIONS.appVersion,
            mcuFirmware: SYSTEM_VERSIONS.mcuFirmware,
            latestVersion: SYSTEM_VERSIONS.appVersion,
            updateAvailable: false,
            channel: 'production-stable',
            lastCheck: new Date().toISOString(),
            status: 'UP_TO_DATE'
          }
        }));
        break;
      }

      // Tab 4: Test Speaker & Audio Prompt
      case 'ADMIN_TEST_AUDIO': {
        broadcast({
          type: 'AUDIO_PLAY_REQUEST',
          data: {
            sound: 'test_chime',
            text_fa: 'تست سیستم صوتی کیوسک داروخانه، بلندگوها فعال و شفاف هستند.'
          }
        });
        break;
      }

      // Admin Modal: PING ATmega
      case 'ADMIN_PING': {
        try {
          const res = await hardware.ping();
          ws.send(JSON.stringify({
            type: 'ADMIN_PING_RESULT',
            data: { success: true, latency: res.latency, seq: res.seq }
          }));
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'ADMIN_PING_RESULT',
            data: { success: false, error: err.message }
          }));
        }
        break;
      }

      // Admin Modal: SET_OUTPUT (Relay Toggle)
      case 'ADMIN_SET_OUTPUT': {
        const { outputId, state } = msg;
        try {
          await hardware.setOutput(outputId, state);
          broadcast({
            type: 'ADMIN_OUTPUT_CHANGED',
            data: { outputId, state, outputs: hardware.statusCache.outputs }
          });
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'ERROR',
            message: `SET_OUTPUT failed: ${err.message}`
          }));
        }
        break;
      }

      // Admin Modal: Test Dispense Slot (Mechanical diagnostic without decrementing stock)
      case 'ADMIN_TEST_DISPENSE': {
        const { slotId } = msg;
        try {
          const res = await hardware.dispense(slotId, 1);
          ws.send(JSON.stringify({
            type: 'ADMIN_TEST_DISPENSE_RESULT',
            data: { success: true, slotId, seq: res.seq, durationMs: res.durationMs }
          }));
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'ADMIN_TEST_DISPENSE_RESULT',
            data: { success: false, slotId, error: err.message }
          }));
        }
        break;
      }

      // Admin Modal: Emergency Stop
      case 'ADMIN_STOP': {
        try {
          await hardware.stop();
          broadcast({ type: 'ADMIN_STOPPED' });
        } catch (err) {
          ws.send(JSON.stringify({ type: 'ERROR', message: err.message }));
        }
        break;
      }

      // Admin Modal: Restock All Slots
      case 'ADMIN_RESET_STOCK': {
        const prods = db.restockAll(20);
        broadcast({
          type: 'STOCK_RESTOCKED',
          data: {
            products: prods,
            medicines: prods
          }
        });
        broadcast({
          type: 'AUDIT_LOG_ADDED',
          data: { logs: db.getInventoryAuditLogs(20) }
        });
        break;
      }

      // Admin Refresh Data
      case 'ADMIN_GET_DATA': {
        ws.send(JSON.stringify({
          type: 'ADMIN_DATA_REFRESH',
          data: {
            products: db.getProducts('all'),
            systemErrors: db.getSystemErrors(),
            transactions: db.getTransactions(),
            auditLogs: db.getInventoryAuditLogs(50),
            system: SYSTEM_VERSIONS,
            cloud: cloudState,
            hardware: {
              connected: hardware.isConnected,
              isMock: hardware.isMock,
              port: hardware.isMock ? 'ATMEGA_VIRTUAL_MOCK' : hardware.portPath,
              outputs: hardware.statusCache.outputs,
              lastPingLatencyMs: hardware.statusCache.lastPingLatencyMs
            }
          }
        }));
        break;
      }

      default:
        ws.send(JSON.stringify({ type: 'UNKNOWN_COMMAND' }));
        break;
    }
  });
});

// Start Server & Hardware
async function start(port = PORT, host = HOST) {
  await hardware.init();

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      console.log(`====================================================`);
      console.log(`🚀 PHARMACY VENDING KIOSK BACKEND RUNNING`);
      console.log(`📡 URL: http://${host}:${port}`);
      console.log(`⚡ WebSocket: ws://${host}:${port}`);
      console.log(`🔌 Hardware Mode: ${hardware.isMock ? 'VIRTUAL ATMEGA SIMULATOR (Mock)' : (hardware.isConnected ? `CONNECTED (${hardware.portPath} @ ${hardware.baudRate} baud)` : `SEARCHING REAL HARDWARE (${hardware.portPath} @ ${hardware.baudRate} baud)`)}`);
      console.log(`🖥️  Display Target: 21.5-inch Vertical (1080 x 1920 portrait)`);
      console.log(`🏎️  Target Engine: 60 FPS Zero-Overhead`);
      console.log(`====================================================`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Fatal initialization error:', err);
    process.exit(1);
  });
}

module.exports = { server, hardware, db, posBridge, wordpressSync, start };
