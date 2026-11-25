/**
 * Hardware Controller for ATmega Vending Board
 * Implements serial protocol communication, auto-reconnect, 24-output management,
 * and real-time transaction event emission.
 * Aligned with official firmware (9600 baud, 1-byte SEQ, 24 outputs).
 */

'use strict';

const EventEmitter = require('node:events');
const fs = require('node:fs');
const { PROTOCOL, TYPE_NAMES, CMD_NAMES, ERROR_NAMES, buildFrame, StreamParser } = require('./protocol');
const { MockAtmega } = require('./mock-atmega');

let SerialPort = null;
try {
  SerialPort = require('serialport').SerialPort;
} catch {
  // Graceful fallback if native serialport is not present
}

class HardwareManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.portPath = options.port || process.env.SERIAL_PORT || '/dev/ttyUSB0';
    this.baudRate = options.baudRate || parseInt(process.env.BAUD_RATE, 10) || PROTOCOL.DEFAULT_BAUD; // 9600 baud
    this.ackTimeoutMs = options.ackTimeoutMs || 1000; // Timeout waiting for response
    this.maxRetries = options.maxRetries || 3;        // Max 3 retries
    this.executionTimeoutMs = options.executionTimeoutMs || 8000; // Timeout waiting for execution

    // Mock setting: By default, mock is disabled to allow direct physical hardware communication
    this.enableMock = options.enableMock !== undefined 
      ? Boolean(options.enableMock) 
      : (process.env.ENABLE_MOCK === 'true');

    this.port = null;
    this.mock = null;
    this.isMock = false;
    this.isConnected = false;
    this._portWatcherTimer = null;

    this.parser = new StreamParser();
    this.parser.on('frame', (frame) => this._onFrameReceived(frame));
    this.parser.on('crc_error', (err) => {
      this.emit('log', { level: 'error', text: `CRC Error detected!`, detail: err });
    });

    // Sequence Number Generator (1 to 255 - 1 byte)
    this._currentSeq = 0;

    // Transaction Queue & Active Transaction
    this.queue = [];
    this.activeTx = null;

    // Last known hardware state cache (24 outputs)
    this.statusCache = {
      isMock: false,
      portName: this.portPath,
      connected: false,
      outputs: new Array(PROTOCOL.OUTPUT_COUNT).fill(0),
      lastPingLatencyMs: null,
      temperatureC: 24.0,
      busVoltageV: 12.0
    };
  }

  /**
   * Allocate next sequence number (1 to 255)
   */
  _nextSeq() {
    this._currentSeq = (this._currentSeq + 1) & 0xFF;
    if (this._currentSeq === 0) this._currentSeq = 1;
    return this._currentSeq;
  }

  /**
   * Initialize Serial Connection with auto-detection
   */
  async init() {
    this.emit('log', { 
      level: 'info', 
      text: `Initializing Hardware Controller on ${this.portPath} @ ${this.baudRate} baud (Mock: ${this.enableMock ? 'ENABLED' : 'DISABLED'})...` 
    });

    if (SerialPort) {
      try {
        const opened = await this._tryOpenSerial(this.portPath);
        if (opened) {
          this.isConnected = true;
          this.isMock = false;
          this.statusCache.connected = true;
          this.statusCache.isMock = false;
          this.statusCache.portName = this.portPath;
          this.emit('connection', { connected: true, isMock: false, port: this.portPath });
          this.emit('log', { level: 'success', text: `Physical serial port connected: ${this.portPath} @ ${this.baudRate} baud` });
          return;
        }
      } catch (err) {
        this.emit('log', { level: 'warn', text: `Could not open physical port ${this.portPath}: ${err.message}` });
      }
    }

    if (this.enableMock) {
      // Explicit Mock Mode requested
      this._startMock();
    } else {
      // Real Hardware Mode: keep scanning for connected hardware without starting mock
      this.emit('log', { 
        level: 'warn', 
        text: `Physical serial device not detected on ${this.portPath}. Real Hardware Mode active; watching for device...` 
      });
      this._startPortWatcher();
    }
  }

  /**
   * Periodically check for available serial ports and auto-connect
   */
  _startPortWatcher() {
    if (this._portWatcherTimer) return;

    this._portWatcherTimer = setInterval(async () => {
      if (this.isConnected) {
        clearInterval(this._portWatcherTimer);
        this._portWatcherTimer = null;
        return;
      }

      if (!SerialPort) return;

      try {
        const ports = await SerialPort.list();
        // Look for common USB-UART chips or configured port
        const candidate = ports.find(p => 
          p.path === this.portPath || 
          p.path.startsWith('/dev/ttyUSB') || 
          p.path.startsWith('/dev/ttyACM')
        );

        if (candidate) {
          this.emit('log', { level: 'info', text: `Discovered candidate serial device: ${candidate.path}. Attempting connection...` });
          const opened = await this._tryOpenSerial(candidate.path);
          if (opened) {
            this.portPath = candidate.path;
            this.isConnected = true;
            this.isMock = false;
            this.statusCache.connected = true;
            this.statusCache.isMock = false;
            this.statusCache.portName = candidate.path;
            this.emit('connection', { connected: true, isMock: false, port: candidate.path });
            this.emit('log', { level: 'success', text: `Successfully connected to physical device: ${candidate.path} @ ${this.baudRate} baud` });
            
            clearInterval(this._portWatcherTimer);
            this._portWatcherTimer = null;
          }
        }
      } catch (err) {
        // Silent catch for watcher
      }
    }, 2000);
  }

  /**
   * Attempt to open physical serial port
   */
  _tryOpenSerial(targetPath) {
    return new Promise((resolve) => {
      const port = new SerialPort({
        path: targetPath,
        baudRate: this.baudRate,
        autoOpen: false
      });

      port.open((err) => {
        if (err) {
          return resolve(false);
        }

        this.port = port;
        port.on('data', (chunk) => {
          this.parser.push(chunk);
          this.emit('raw_rx_chunk', chunk);
        });

        port.on('error', (portErr) => {
          this.emit('log', { level: 'error', text: `SerialPort error: ${portErr.message}` });
        });

        port.on('close', () => {
          this.emit('log', { level: 'warn', text: `Serial port ${targetPath} closed/disconnected.` });
          this.isConnected = false;
          this.statusCache.connected = false;
          this.port = null;
          this.emit('connection', { connected: false, isMock: this.isMock, port: targetPath });

          if (!this.enableMock) {
            this._startPortWatcher();
          }
        });

        resolve(true);
      });
    });
  }

  /**
   * Start built-in ATmega Simulator (only if explicitly enabled)
   */
  _startMock() {
    this.isMock = true;
    this.isConnected = true;
    this.statusCache.connected = true;
    this.statusCache.isMock = true;

    this.mock = new MockAtmega();
    this.mock.on('data', (chunk) => {
      this.parser.push(chunk);
      this.emit('raw_rx_chunk', chunk);
    });

    this.mock.on('log', (entry) => {
      this.emit('hardware_log', entry);
    });

    this.emit('connection', { connected: true, isMock: true, port: 'VIRTUAL_ATMEGA_MOCK' });
    this.emit('log', { level: 'info', text: 'Hardware Mock Simulator started successfully.' });
  }

  /**
   * Send raw byte buffer to either physical serial port or mock MCU
   * @param {Buffer} buffer 
   */
  _writeRaw(buffer) {
    if (this.isMock && this.mock) {
      this.mock.write(buffer);
    } else if (this.port && this.port.isOpen) {
      this.port.write(buffer);
    } else {
      throw new Error('Hardware connection unavailable (Physical serial port is not connected)');
    }

    this.emit('raw_tx', {
      timestamp: Date.now(),
      rawHex: buffer.toString('hex').toUpperCase(),
      length: buffer.length
    });
  }

  /**
   * Frame parser callback
   * @param {object} frame Parsed incoming frame
   */
  _onFrameReceived(frame) {
    this.emit('raw_rx', {
      timestamp: Date.now(),
      rawHex: frame.rawHex,
      type: frame.type,
      typeName: frame.typeName,
      cmd: frame.cmd,
      cmdName: frame.cmdName,
      seq: frame.seq,
      len: frame.len,
      data: Array.from(frame.data),
      crc: frame.crc
    });

    // Route to active transaction if SEQ matches
    if (this.activeTx && this.activeTx.seq === frame.seq) {
      this._handleActiveTxFrame(frame);
    } else {
      this.emit('log', {
        level: 'warn',
        text: `Received unhandled frame: ${frame.typeName} CMD=${frame.cmdName} SEQ=${frame.seq}`
      });
    }
  }

  /**
   * Core Transaction Executor
   * Executes a command through serial communication with timeout and retries
   *
   * @param {number} cmd Protocol CMD code
   * @param {Buffer|Array<number>} [data] Payload bytes
   * @returns {Promise<object>} Resolves with final response on COMMAND_DONE
   */
  execute(cmd, data = null) {
    return new Promise((resolve, reject) => {
      const seq = this._nextSeq();
      const tx = {
        seq,
        cmd,
        cmdName: CMD_NAMES[cmd] || `CMD_0x${cmd.toString(16)}`,
        data: data ? (Buffer.isBuffer(data) ? data : Buffer.from(data)) : Buffer.alloc(0),
        retries: 0,
        startTime: Date.now(),
        stage: 1, // 1: SENDING_COMMAND
        timer: null,
        resolve,
        reject
      };

      this.queue.push(tx);
      this._processQueue();
    });
  }

  /**
   * Process pending transaction queue sequentially
   */
  _processQueue() {
    if (this.activeTx || this.queue.length === 0) {
      return;
    }

    this.activeTx = this.queue.shift();
    this._beginStage1(this.activeTx);
  }

  /**
   * Stage 1: Send COMMAND (0x01) with unique 1-byte SEQ
   */
  _beginStage1(tx) {
    tx.stage = 1;
    this.emit('tx_stage', {
      stage: 1,
      stageName: 'SENDING_COMMAND',
      seq: tx.seq,
      cmd: tx.cmd,
      cmdName: tx.cmdName,
      attempt: tx.retries + 1
    });

    const frame = buildFrame(PROTOCOL.TYPE.COMMAND, tx.cmd, tx.seq, tx.data);
    try {
      this._writeRaw(frame);
    } catch (err) {
      return this._finishTx(new Error(`Failed to transmit frame: ${err.message}`));
    }

    // Set timeout waiting for MCU response
    tx.timer = setTimeout(() => {
      this._handleResponseTimeout(tx);
    }, this.ackTimeoutMs);
  }

  /**
   * Handle response timeout (Retry logic, up to 3 retries)
   */
  _handleResponseTimeout(tx) {
    if (tx.retries < this.maxRetries) {
      tx.retries++;
      this.emit('log', {
        level: 'warn',
        text: `[Hardware] Response timeout for SEQ=${tx.seq} CMD=${tx.cmdName}. Retrying (${tx.retries}/${this.maxRetries})...`
      });
      this._beginStage1(tx);
    } else {
      this.emit('log', {
        level: 'error',
        text: `[Hardware] Transaction failed: No response after ${this.maxRetries} retries (SEQ=${tx.seq}).`
      });
      this._finishTx(new Error(`ATmega response timeout after ${this.maxRetries} retries for SEQ=${tx.seq}`));
    }
  }

  /**
   * Process frame received for active transaction
   */
  _handleActiveTxFrame(frame) {
    const tx = this.activeTx;
    if (!tx) return;

    // Intermediate ACK received (if firmware sends 0x02)
    if (frame.type === PROTOCOL.TYPE.COMMAND_RECEIVED && tx.stage === 1) {
      if (tx.timer) clearTimeout(tx.timer);

      tx.stage = 3; // WAITING_FOR_EXECUTION
      this.emit('tx_stage', {
        stage: 2,
        stageName: 'COMMAND_RECEIVED',
        seq: tx.seq,
        cmd: tx.cmd,
        cmdName: tx.cmdName,
        latencyMs: Date.now() - tx.startTime
      });

      tx.timer = setTimeout(() => {
        this._finishTx(new Error(`Execution timeout: ATmega did not return DONE/ERROR within ${this.executionTimeoutMs}ms for SEQ=${tx.seq}`));
      }, this.executionTimeoutMs);

      return;
    }

    // Command Finished: COMMAND_DONE (0x03) or COMMAND_ERROR (0x04)
    if (frame.type === PROTOCOL.TYPE.COMMAND_DONE || frame.type === PROTOCOL.TYPE.COMMAND_ERROR) {
      if (tx.timer) clearTimeout(tx.timer);

      const isSuccess = frame.type === PROTOCOL.TYPE.COMMAND_DONE;
      tx.stage = 4;

      this.emit('tx_stage', {
        stage: 4,
        stageName: isSuccess ? 'COMMAND_DONE' : 'COMMAND_ERROR',
        seq: tx.seq,
        cmd: tx.cmd,
        cmdName: tx.cmdName,
        success: isSuccess,
        data: Array.from(frame.data),
        durationMs: Date.now() - tx.startTime
      });

      // Conclude transaction
      if (isSuccess) {
        this._finishTx(null, {
          seq: tx.seq,
          cmd: tx.cmd,
          cmdName: tx.cmdName,
          data: frame.data,
          durationMs: Date.now() - tx.startTime
        });
      } else {
        const errorCode = frame.data && frame.data.length > 0 ? frame.data[0] : 0xFF;
        const errorDesc = ERROR_NAMES[errorCode] || `UNKNOWN_ERROR_0x${errorCode.toString(16)}`;
        this._finishTx(new Error(`ATmega returned ${errorDesc} (0x${errorCode.toString(16).padStart(2, '0')}) for SEQ=${tx.seq}`));
      }
    }
  }

  /**
   * Finalize active transaction, resolve/reject promise, process next queued item
   */
  _finishTx(error, result = null) {
    const tx = this.activeTx;
    if (!tx) return;

    if (tx.timer) {
      clearTimeout(tx.timer);
      tx.timer = null;
    }

    this.activeTx = null;

    if (error) {
      tx.reject(error);
    } else {
      tx.resolve(result);
    }

    // Process next queued command
    setImmediate(() => this._processQueue());
  }

  // --- High-Level Convenience API Methods ---

  /**
   * Ping the microcontroller
   * @returns {Promise<object>} Round-trip latency and seq
   */
  async ping() {
    const t0 = Date.now();
    const res = await this.execute(PROTOCOL.CMD.PING);
    const latency = Date.now() - t0;
    this.statusCache.lastPingLatencyMs = latency;
    return { latency, seq: res.seq };
  }

  /**
   * Query status
   */
  async getStatus() {
    return await this.execute(PROTOCOL.CMD.GET_STATUS);
  }

  /**
   * Query sensor states
   */
  async getSensors() {
    return await this.execute(PROTOCOL.CMD.GET_SENSORS);
  }

  /**
   * Set hardware output (Relay 1 to 24)
   * Matches firmware format: CMD 0x04 with Payload [output (1-24), state (0 or 1)]
   * @param {number} outputId 1 to 24
   * @param {boolean|number} state true/1 = ON, false/0 = OFF
   */
  async setOutput(outputId, state) {
    const id = Number(outputId);
    if (id < 1 || id > PROTOCOL.OUTPUT_COUNT) {
      throw new RangeError(`Output ID must be between 1 and ${PROTOCOL.OUTPUT_COUNT} (got ${id})`);
    }
    const val = state ? 1 : 0;
    const res = await this.execute(PROTOCOL.CMD.SET_OUTPUT, [id, val]);
    this.statusCache.outputs[id - 1] = val;
    return res;
  }

  /**
   * Dispense medication from physical slot (1 to 24)
   * @param {number} slotId Physical slot number (1 - 24)
   * @param {number} [count=1] Number of items to drop
   */
  async dispense(slotId, count = 1) {
    const id = Number(slotId);
    if (id < 1 || id > PROTOCOL.OUTPUT_COUNT) {
      throw new RangeError(`Slot ID must be between 1 and ${PROTOCOL.OUTPUT_COUNT} (got ${id})`);
    }
    return await this.execute(PROTOCOL.CMD.DISPENSE, [id, count]);
  }

  /**
   * Emergency Stop
   */
  async stop() {
    return await this.execute(PROTOCOL.CMD.STOP);
  }

  /**
   * Turn all outputs and motors OFF
   */
  async allOff() {
    const res = await this.execute(PROTOCOL.CMD.ALL_OFF);
    this.statusCache.outputs.fill(0);
    return res;
  }
}

module.exports = {
  HardwareManager
};
