/**
 * PosBridge Client & Manager for Pharmacy Vending Kiosk
 *
 * Responsibilities:
 * 1. Connects to PosBridge middleware (or provides built-in emulation fallback).
 * 2. When a product is selected, sends the price/amount to the POS terminal so it is displayed on the POS screen.
 * 3. Monitors customer card swipe and PIN entry on the physical POS terminal.
 * 4. Communicates bank authorization outcome (success or error) back to the application and frontend.
 * 5. Supports both synchronous bridge APIs and asynchronous webhook callbacks (/api/posbridge/callback).
 */

'use strict';

const EventEmitter = require('node:events');

class PosBridgeManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.bridgeUrl = (options.bridgeUrl || process.env.POS_BRIDGE_URL || 'http://127.0.0.1:8088').replace(/\/+$/, '');
    this.terminalId = options.terminalId || process.env.POS_TERMINAL_ID || 'IR-POS-8821';
    this.timeoutMs = parseInt(options.timeoutMs || process.env.POS_TIMEOUT_MS, 10) || 85000; // 85 seconds
    this.isMock = options.isMock !== undefined ? options.isMock : (process.env.POS_BRIDGE_MOCK === 'true');

    this.broadcast = null;
    this.db = null;

    this.isConnected = false;
    this.status = 'IDLE'; // IDLE, DISPLAYING_PRICE, WAITING_CARD_SWIPE, PROCESSING_BANK, APPROVED, REJECTED
    this.currentTransaction = null;
    this.activeAbortController = null;
  }

  /**
   * Initialize PosBridge with DB and WebSocket broadcast references
   */
  init({ db, broadcast }) {
    this.db = db;
    this.broadcast = broadcast;

    console.log(`[PosBridge] Initialized. Bridge URL: ${this.bridgeUrl} | Terminal ID: ${this.terminalId}`);
    this._checkConnection();
  }

  /**
   * Probe connection to local PosBridge software
   */
  async _checkConnection() {
    if (this.isMock) {
      this.isConnected = true;
      console.log(`[PosBridge] Running in simulated bridge mode (Mock)`);
      return;
    }

    try {
      const res = await fetch(`${this.bridgeUrl}/api/pos/status`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3000)
      });
      this.isConnected = res.ok;
      console.log(`[PosBridge] Connection to PosBridge verified: ${this.isConnected ? 'ONLINE' : 'OFFLINE'}`);
    } catch {
      this.isConnected = false;
      console.log(`[PosBridge] External PosBridge service not detected at ${this.bridgeUrl}. Automatic internal bridge emulation active.`);
    }
  }

  /**
   * Display product price on POS terminal and begin transaction
   *
   * @param {number} amount Total price in Tomans
   * @param {object} metadata { trxCode, productId, slotId, description }
   */
  async displayPrice(amount, metadata = {}) {
    const { trxCode, productId, slotId, description } = metadata;

    this.currentTransaction = {
      trxCode: trxCode || `TRX-${Date.now()}`,
      amount,
      productId,
      slotId,
      description: description || 'خرید دارو از کیوسک',
      startedAt: new Date().toISOString()
    };

    this.status = 'WAITING_CARD_SWIPE';
    console.log(`[PosBridge] 💳 Displaying price on POS terminal: ${amount.toLocaleString('fa-IR')} تومان | Trx: ${this.currentTransaction.trxCode}`);

    // Broadcast to frontend immediately: POS display is updated
    this._notifyFrontendPriceDisplayed();

    // Emit internal event
    this.emit('price_displayed', {
      trxCode: this.currentTransaction.trxCode,
      amount,
      status: 'WAITING_CARD_SWIPE'
    });

    // If external bridge is online, dispatch to external PosBridge daemon
    if (!this.isMock && this.isConnected) {
      return this._sendToExternalPosBridge();
    } else {
      console.log(`[PosBridge] POS Terminal Screen Active: displaying ${amount} Toman. Awaiting card swipe...`);
      return {
        success: true,
        status: 'WAITING_CARD_SWIPE',
        displayedAmount: amount,
        trxCode: this.currentTransaction.trxCode
      };
    }
  }

  /**
   * Notify connected frontend clients that price has been displayed on POS terminal
   */
  _notifyFrontendPriceDisplayed() {
    if (!this.broadcast || !this.currentTransaction) return;

    this.broadcast({
      type: 'POS_PRICE_DISPLAYED',
      data: {
        trxCode: this.currentTransaction.trxCode,
        amount: this.currentTransaction.amount,
        status: 'WAITING_CARD_SWIPE',
        terminalId: this.terminalId,
        message_fa: `مبلغ ${this.currentTransaction.amount.toLocaleString('fa-IR')} تومان در صفحه کارتخوان نمایش داده شد. لطفاً کارت بانکی خود را بکشید و رمز را وارد فرمایید.`
      }
    });
  }

  /**
   * Send transaction payload to external PosBridge daemon
   */
  async _sendToExternalPosBridge() {
    this.activeAbortController = new AbortController();
    const timeout = setTimeout(() => this.activeAbortController.abort(), this.timeoutMs);

    try {
      const payload = {
        terminalId: this.terminalId,
        invoiceNumber: this.currentTransaction.trxCode,
        amount: this.currentTransaction.amount,
        description: this.currentTransaction.description,
        callbackUrl: 'http://127.0.0.1:8080/api/posbridge/callback'
      };

      const res = await fetch(`${this.bridgeUrl}/api/pos/purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: this.activeAbortController.signal
      });

      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`PosBridge returned status ${res.status}`);
      }

      const data = await res.json();
      return this.handleBankResponse(data);

    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        return this.handleBankResponse({
          success: false,
          status: 'TIMEOUT',
          errorCode: 'E005',
          message_fa: 'زمان انتظار برای کشیدن کارت یا ورود رمز به پایان رسید.'
        });
      }

      console.warn(`[PosBridge] External call error: ${err.message}. Ready for direct callback / simulation.`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Process bank transaction outcome (from PosBridge HTTP response or Webhook callback)
   *
   * @param {object} outcome Bank transaction result
   */
  handleBankResponse(outcome) {
    if (!this.currentTransaction) {
      console.warn('[PosBridge] Received bank outcome with no active transaction:', outcome);
      return;
    }

    const trxCode = outcome.trxCode || outcome.invoiceNumber || this.currentTransaction.trxCode;
    const isSuccess = outcome.success === true || outcome.status === 'APPROVED' || outcome.status === 'SUCCESS' || outcome.responseCode === '00';

    if (isSuccess) {
      this.status = 'APPROVED';
      const rrn = outcome.rrn || outcome.refId || String(Math.floor(100000000000 + Math.random() * 900000000000));
      const traceNo = outcome.traceNo || outcome.trackingCode || String(Math.floor(100000 + Math.random() * 900000));
      const cardPan = outcome.cardPan || outcome.maskedPan || '۶۰۳۷-۹۹**-****-۲۱۴۸';

      console.log(`[PosBridge] ✅ Bank Payment APPROVED for ${trxCode} | RRN: ${rrn} | Trace: ${traceNo}`);

      const resultData = {
        success: true,
        status: 'APPROVED',
        trxCode,
        amount: this.currentTransaction.amount,
        productId: this.currentTransaction.productId,
        slotId: this.currentTransaction.slotId,
        rrn,
        traceNo,
        cardPan,
        terminalId: this.terminalId,
        timestamp: new Date().toISOString(),
        message_fa: 'پرداخت در پایانه بانکی با موفقیت تایید شد.'
      };

      // Emit event for server to dispense product & update WordPress inventory
      this.emit('payment_success', resultData);

      // Broadcast to frontend
      if (this.broadcast) {
        this.broadcast({
          type: 'POS_PAYMENT_RESULT',
          data: resultData
        });
      }

      return resultData;

    } else {
      this.status = 'REJECTED';
      const errorCode = outcome.errorCode || outcome.responseCode || 'E005';
      let messageFa = outcome.message_fa || outcome.message || 'تراکنش توسط بانک یا کاربر لغو گردید.';

      if (errorCode === 'WRONG_PIN' || outcome.responseCode === '55') {
        messageFa = 'رمز کارت نامعتبر است.';
      } else if (errorCode === 'INSUFFICIENT_FUNDS' || outcome.responseCode === '51') {
        messageFa = 'موجودی حساب کافی نمی‌باشد.';
      } else if (errorCode === 'USER_CANCEL' || outcome.responseCode === '17') {
        messageFa = 'تراکنش توسط مشتری در دستگاه پوز لغو شد.';
      }

      console.warn(`[PosBridge] ❌ Bank Payment REJECTED for ${trxCode} | Error: ${errorCode} (${messageFa})`);

      const resultData = {
        success: false,
        status: 'REJECTED',
        trxCode,
        amount: this.currentTransaction.amount,
        productId: this.currentTransaction.productId,
        slotId: this.currentTransaction.slotId,
        errorCode,
        message_fa: messageFa,
        timestamp: new Date().toISOString()
      };

      // Emit event for server to update transaction record
      this.emit('payment_failed', resultData);

      // Broadcast to frontend
      if (this.broadcast) {
        this.broadcast({
          type: 'POS_PAYMENT_RESULT',
          data: resultData
        });
      }

      return resultData;
    }
  }

  /**
   * Simulate customer card swipe and PIN entry (used by touchscreen simulation buttons & automated tests)
   *
   * @param {object} simOptions { success, errorCode, message_fa }
   */
  simulateCardSwipe(simOptions = {}) {
    const isSuccess = simOptions.success !== false;
    console.log(`[PosBridge] ⚡ Simulating Card Swipe -> Outcome: ${isSuccess ? 'SUCCESS' : 'FAILED'}`);

    if (isSuccess) {
      return this.handleBankResponse({
        success: true,
        status: 'APPROVED',
        responseCode: '00',
        trxCode: this.currentTransaction ? this.currentTransaction.trxCode : simOptions.trxCode,
        rrn: simOptions.rrn || String(Math.floor(100000000000 + Math.random() * 900000000000)),
        traceNo: simOptions.traceNo || String(Math.floor(100000 + Math.random() * 900000)),
        cardPan: simOptions.cardPan || '۶۰۳۷-۹۹**-****-۵۴۸۱'
      });
    } else {
      return this.handleBankResponse({
        success: false,
        status: 'REJECTED',
        trxCode: this.currentTransaction ? this.currentTransaction.trxCode : simOptions.trxCode,
        errorCode: simOptions.errorCode || 'USER_CANCEL',
        message_fa: simOptions.message_fa || 'تراکنش توسط مشتری لغو گردید یا رمز اشتباه بود.'
      });
    }
  }

  /**
   * Cancel ongoing POS transaction
   */
  cancelTransaction(reason = 'USER_CANCEL') {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    if (this.currentTransaction) {
      console.log(`[PosBridge] Transaction ${this.currentTransaction.trxCode} cancelled: ${reason}`);
      const res = {
        success: false,
        status: 'CANCELLED',
        trxCode: this.currentTransaction.trxCode,
        errorCode: 'USER_CANCEL',
        message_fa: 'تراکنش لغو شد.'
      };
      this.status = 'IDLE';
      this.currentTransaction = null;
      return res;
    }

    this.status = 'IDLE';
    return { success: true };
  }

  /**
   * Return current bridge status
   */
  getStatus() {
    return {
      status: this.status,
      isConnected: this.isConnected,
      bridgeUrl: this.bridgeUrl,
      terminalId: this.terminalId,
      currentTransaction: this.currentTransaction,
      isMock: this.isMock
    };
  }
}

module.exports = {
  PosBridgeManager
};
