/**
 * socketClient.js - Robust Hardware Link via Pure WebSocket
 * Architecture Rule 9:
 * Connect to ws://127.0.0.1:8080/ws with 1s->5s auto-reconnect backoff.
 * ALL event names live in ONE exported constants object.
 */

import { store } from './store.js';

// Unified Event Names Registry (Architecture Document Standard)
export const SOCKET_EVENTS = {
  // Outbound events (Frontend -> Hardware/Backend)
  SLOT_CHECK: 'SLOT_CHECK',         // payload: { slotId }
  PAY_REQUEST: 'PAY_REQUEST',       // payload: { amount, items }
  PAY_CANCEL: 'PAY_CANCEL',         // payload: { reason }

  // Inbound events (Hardware/Backend -> Frontend)
  SLOT_STATUS: 'SLOT_STATUS',       // payload: { ok, slotId, stock }
  POS_ACK: 'POS_ACK',               // payload: { status }
  DROP_SUCCESS: 'DROP_SUCCESS',     // payload: { slotId }
  DROP_FAIL: 'DROP_FAIL',           // payload: { reason }
  RECEIPT_PRINTED: 'RECEIPT_PRINTED' // payload: {}
};

class SocketClient {
  constructor() {
    this.ws = null;
    this.url = this._resolveDefaultUrl();
    this.listeners = new Map();
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 5000;
    this.isManualClosed = false;
  }

  /**
   * Determine default WS URL with fallback to current location host
   */
  _resolveDefaultUrl() {
    if (typeof window !== 'undefined' && window.location && window.location.host) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/ws`;
    }
    return 'ws://127.0.0.1:8080/ws';
  }

  /**
   * Connect to WebSocket server
   * @param {string} [customUrl]
   */
  connect(customUrl = null) {
    if (customUrl) this.url = customUrl;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isManualClosed = false;

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.warn('[SocketClient] Connection initiation error:', err);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log(`[SocketClient] Connected to hardware bridge at ${this.url}`);
      this.reconnectDelay = 1000;
      store.hardware = {
        ...store.hardware,
        isConnected: true
      };
      this._dispatch('open', {});
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const type = msg.type || msg.event;
        const payload = msg.data || msg.payload || msg;

        // Internal hardware state mirror
        if (type === SOCKET_EVENTS.SLOT_STATUS) {
          store.hardware = {
            ...store.hardware,
            slotStatus: {
              ...store.hardware.slotStatus,
              [payload.slotId]: payload
            }
          };
        } else if (type === SOCKET_EVENTS.DROP_SUCCESS) {
          store.hardware = {
            ...store.hardware,
            lastDispensedSlot: payload.slotId,
            dropSensorConfirmed: true
          };
        }

        // Dispatch specific event and wildcard
        if (type) {
          this._dispatch(type, payload);
        }
        this._dispatch('*', { type, payload });
      } catch (err) {
        console.error('[SocketClient] Failed to parse inbound WS frame:', err);
      }
    };

    this.ws.onerror = (err) => {
      console.warn('[SocketClient] WebSocket error:', err);
    };

    this.ws.onclose = () => {
      store.hardware = {
        ...store.hardware,
        isConnected: false
      };
      this._dispatch('close', {});
      if (!this.isManualClosed) {
        this._scheduleReconnect();
      }
    };
  }

  /**
   * Reconnect with 1s -> 5s exponential backoff
   */
  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log(`[SocketClient] Reconnecting in ${this.reconnectDelay}ms...`);
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }

  /**
   * Subscribe to inbound hardware events
   * @param {string} eventName
   * @param {Function} callback
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);
    return () => this.off(eventName, callback);
  }

  /**
   * Unsubscribe from hardware events
   * @param {string} eventName
   * @param {Function} callback
   */
  off(eventName, callback) {
    if (this.listeners.has(eventName)) {
      this.listeners.get(eventName).delete(callback);
    }
  }

  /**
   * Internal dispatcher for registered callbacks
   */
  _dispatch(eventName, data) {
    if (this.listeners.has(eventName)) {
      for (const cb of this.listeners.get(eventName)) {
        try {
          cb(data);
        } catch (err) {
          console.error(`[SocketClient] Handler error for "${eventName}":`, err);
        }
      }
    }
  }

  /**
   * Send outbound command over WebSocket
   * @param {string} type - Must match one of SOCKET_EVENTS
   * @param {object} payload
   */
  send(type, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[SocketClient] Cannot send "${type}": socket not connected`);
      return false;
    }
    const message = JSON.stringify({ type, ...payload });
    this.ws.send(message);
    return true;
  }

  /**
   * Convenience helpers for outbound events
   */
  slotCheck(slotId) {
    return this.send(SOCKET_EVENTS.SLOT_CHECK, { slotId });
  }

  payRequest(amount, items = []) {
    return this.send(SOCKET_EVENTS.PAY_REQUEST, { amount, items });
  }

  payCancel(reason = 'USER_CANCELLED') {
    return this.send(SOCKET_EVENTS.PAY_CANCEL, { reason });
  }

  disconnect() {
    this.isManualClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

// Export singleton instance
export const socketClient = new SocketClient();
