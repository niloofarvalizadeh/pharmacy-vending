/**
 * ATmega Microcontroller Hardware Simulator (Mock Mode)
 * Emulates the embedded firmware behavior of the vending machine controller board.
 * Aligned with official C firmware specification (24 outputs, 9600 baud, 1-byte SEQ).
 */

'use strict';

const EventEmitter = require('node:events');
const { PROTOCOL, buildFrame, StreamParser } = require('./protocol');

class MockAtmega extends EventEmitter {
  constructor() {
    super();
    this.parser = new StreamParser();
    this.parser.on('frame', (frame) => this._handleIncomingFrame(frame));

    // Internal simulated hardware state (24 outputs via shift registers)
    this.outputs = new Uint8Array(PROTOCOL.OUTPUT_COUNT);
    this.sensors = {
      dropSensorActive: false,
      doorClosed: true,
      trayReady: true,
      temperatureC: 24.5,
      busVoltageV: 12.1
    };

    this.activeMotorTimer = null;
    this.waitingForAckSeq = null;

    // Simulated latency settings (ms)
    this.ackLatencyMs = 20;
    this.dispenseDurationMs = 1200; // Time for coil motor to rotate 360 deg
  }

  /**
   * Feed bytes from PC into Mock ATmega
   * @param {Buffer} chunk 
   */
  write(chunk) {
    this.parser.push(chunk);
  }

  /**
   * Send bytes back to PC
   * @param {Buffer} buffer 
   */
  _sendToHost(buffer) {
    this.emit('data', buffer);
  }

  /**
   * Process a parsed protocol frame received from the Host PC
   * @param {object} frame 
   */
  _handleIncomingFrame(frame) {
    // Only process COMMAND frames from Host PC
    if (frame.type !== PROTOCOL.TYPE.COMMAND) {
      return;
    }

    const { cmd, seq, data } = frame;
    this._executeCommand(cmd, seq, data);
  }

  /**
   * Execute simulated hardware action matching firmware uart_execute_command
   */
  _executeCommand(cmd, seq, data) {
    switch (cmd) {
      case PROTOCOL.CMD.PING: {
        setTimeout(() => {
          this._finishCommand(PROTOCOL.TYPE.COMMAND_DONE, cmd, seq, Buffer.from([PROTOCOL.ERROR.NONE]));
        }, 15);
        break;
      }

      case PROTOCOL.CMD.GET_STATUS: {
        setTimeout(() => {
          const statusBuf = Buffer.from([
            PROTOCOL.ERROR.NONE,
            Math.round(this.sensors.temperatureC),
            Math.round(this.sensors.busVoltageV * 10)
          ]);
          this._finishCommand(PROTOCOL.TYPE.COMMAND_DONE, cmd, seq, statusBuf);
        }, 20);
        break;
      }

      case PROTOCOL.CMD.GET_SENSORS: {
        setTimeout(() => {
          const sBuf = Buffer.from([
            PROTOCOL.ERROR.NONE,
            this.sensors.dropSensorActive ? 0x01 : 0x00,
            this.sensors.doorClosed ? 0x01 : 0x00,
            this.sensors.trayReady ? 0x01 : 0x00
          ]);
          this._finishCommand(PROTOCOL.TYPE.COMMAND_DONE, cmd, seq, sBuf);
        }, 20);
        break;
      }

      case PROTOCOL.CMD.SET_OUTPUT: {
        setTimeout(() => {
          // Payload length must be exactly 2 bytes
          if (!data || data.length !== 2) {
            this._finishCommand(PROTOCOL.TYPE.COMMAND_ERROR, cmd, seq, Buffer.from([PROTOCOL.ERROR.INVALID_DATA]));
            return;
          }

          const outputId = data[0]; // 1 to 24
          if (outputId < 1 || outputId > PROTOCOL.OUTPUT_COUNT) {
            this._finishCommand(PROTOCOL.TYPE.COMMAND_ERROR, cmd, seq, Buffer.from([PROTOCOL.ERROR.INVALID_OUTPUT]));
            return;
          }

          const state = data[1];
          if (state > 1) {
            this._finishCommand(PROTOCOL.TYPE.COMMAND_ERROR, cmd, seq, Buffer.from([PROTOCOL.ERROR.INVALID_DATA]));
            return;
          }

          // Update internal simulated output state
          this.outputs[outputId - 1] = state;
          this.emit('log', {
            role: 'MCU',
            text: `[MCU] Output #${outputId} set to ${state ? 'ON' : 'OFF'}`
          });

          // Return DONE with error_none
          this._finishCommand(PROTOCOL.TYPE.COMMAND_DONE, cmd, seq, Buffer.from([PROTOCOL.ERROR.NONE]));
        }, 20);
        break;
      }

      case PROTOCOL.CMD.GET_OUTPUTS: {
        setTimeout(() => {
          this._finishCommand(PROTOCOL.TYPE.COMMAND_DONE, cmd, seq, Buffer.from(this.outputs));
        }, 20);
        break;
      }

      case PROTOCOL.CMD.DISPENSE: {
        const slotId = data && data.length > 0 ? data[0] : 1;
        const count = data && data.length > 1 ? data[1] : 1;

        if (slotId < 1 || slotId > PROTOCOL.OUTPUT_COUNT) {
          this._finishCommand(PROTOCOL.TYPE.COMMAND_ERROR, cmd, seq, Buffer.from([PROTOCOL.ERROR.INVALID_OUTPUT]));
          return;
        }

        this.emit('log', {
          role: 'MCU',
          text: `[MCU] Motor starting for Slot #${slotId} (Count: ${count}). Rotating spiral coil...`
        });

        // Test error injection: Slot 99 simulates spiral jam
        if (slotId === 99) {
          setTimeout(() => {
            this.emit('log', {
              role: 'MCU',
              text: `[MCU] Motor stall/jam detected on Slot #${slotId}! Dispense failed.`
            });
            this._finishCommand(PROTOCOL.TYPE.COMMAND_ERROR, cmd, seq, Buffer.from([PROTOCOL.ERROR.SENSOR]));
          }, 800);
          return;
        }

        // Simulate mechanical rotation duration
        this.activeMotorTimer = setTimeout(() => {
          this.sensors.dropSensorActive = true;
          this.emit('log', {
            role: 'MCU',
            text: `[MCU] IR Drop Sensor tripped! Medication fell into delivery tray from Slot #${slotId}.`
          });

          setTimeout(() => {
            this.sensors.dropSensorActive = false;
          }, 200);

          // Send COMMAND_DONE (0x03) with error_none
          this._finishCommand(PROTOCOL.TYPE.COMMAND_DONE, cmd, seq, Buffer.from([PROTOCOL.ERROR.NONE]));
        }, this.dispenseDurationMs);
        break;
      }

      case PROTOCOL.CMD.STOP: {
        if (this.activeMotorTimer) {
          clearTimeout(this.activeMotorTimer);
          this.activeMotorTimer = null;
        }
        this.emit('log', { role: 'MCU', text: '[MCU] Emergency STOP executed. Motors halted.' });
        this._finishCommand(PROTOCOL.TYPE.COMMAND_DONE, cmd, seq, Buffer.from([PROTOCOL.ERROR.NONE]));
        break;
      }

      case PROTOCOL.CMD.ALL_OFF: {
        this.outputs.fill(0);
        if (this.activeMotorTimer) {
          clearTimeout(this.activeMotorTimer);
          this.activeMotorTimer = null;
        }
        this.emit('log', { role: 'MCU', text: '[MCU] ALL_OFF executed. All outputs and motors powered down.' });
        this._finishCommand(PROTOCOL.TYPE.COMMAND_DONE, cmd, seq, Buffer.from([PROTOCOL.ERROR.NONE]));
        break;
      }

      case PROTOCOL.CMD.GET_RTC: {
        const nowSec = Math.floor(Date.now() / 1000);
        const rtcBuf = Buffer.alloc(4);
        rtcBuf.writeUInt32BE(nowSec, 0);
        this._finishCommand(PROTOCOL.TYPE.COMMAND_DONE, cmd, seq, rtcBuf);
        break;
      }

      default: {
        this._finishCommand(PROTOCOL.TYPE.COMMAND_ERROR, cmd, seq, Buffer.from([PROTOCOL.ERROR.INVALID_COMMAND]));
        break;
      }
    }
  }

  /**
   * Finalize command execution with DONE or ERROR frame
   */
  _finishCommand(type, cmd, seq, payload) {
    const frame = buildFrame(type, cmd, seq, payload);
    this._sendToHost(frame);
    this.emit('log', {
      role: 'MCU',
      text: `[MCU] Sent ${type === PROTOCOL.TYPE.COMMAND_DONE ? 'COMMAND_DONE (0x03)' : 'COMMAND_ERROR (0x04)'} for CMD=0x${cmd.toString(16).padStart(2, '0')} SEQ=${seq}`
    });
  }
}

module.exports = {
  MockAtmega
};
