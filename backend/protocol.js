/**
 * Binary Serial Protocol Definitions & Stream Parser
 * Target: ATmega Microcontroller on Kiosk Vending Controller Board
 * Aligned with official C firmware specification (9600 baud, 1-byte SEQ, 7-byte min frame, CRC excluding HEAD)
 */

'use strict';

const EventEmitter = require('node:events');
const { computeCRC16, verifyCRC16 } = require('./crc16');

// Protocol Constants
const PROTOCOL = {
  HEAD: 0xAA,

  // Frame Types
  TYPE: {
    COMMAND: 0x01,          // Host -> MCU: Request execution
    COMMAND_RECEIVED: 0x02, // MCU -> Host: ACK / Response
    COMMAND_DONE: 0x03,     // MCU -> Host: Command completed successfully
    COMMAND_ERROR: 0x04,    // MCU -> Host: Command failed / error
    DATA_RECEIVED: 0x05     // Host -> MCU: ACK completion reception (optional)
  },

  // Command Codes
  CMD: {
    PING: 0x01,             // Check heartbeat / latency
    GET_STATUS: 0x02,       // Query machine overall status
    GET_SENSORS: 0x03,      // Query infrared drop sensors, limit switches
    SET_OUTPUT: 0x04,       // Toggle relay / digital output (Outputs 1 to 24)
    GET_OUTPUTS: 0x05,      // Query status of all outputs
    DISPENSE: 0x06,         // Trigger motor for physical slot drop
    STOP: 0x07,             // Emergency stop running motor
    ALL_OFF: 0x08,          // Turn off all relays and motors
    GET_RTC: 0x09,          // Read hardware Real-Time Clock
    SET_RTC: 0x0A           // Set hardware Real-Time Clock
  },

  // Firmware Error Codes
  ERROR: {
    NONE: 0x00,             // error_none
    INVALID_COMMAND: 0x01,  // error_invalid_command
    INVALID_DATA: 0x02,     // error_invalid_data
    INVALID_OUTPUT: 0x03,   // error_invalid_output (outside 1..24)
    CRC: 0x04,              // error_crc
    BUSY: 0x05,             // error_busy
    SENSOR: 0x06,           // error_sensor
    RTC: 0x07               // error_rtc
  },

  OUTPUT_COUNT: 24,
  MAX_DATA_LEN: 100,
  DEFAULT_BAUD: 9600,

  // Minimum frame length: HEAD(1) + TYPE(1) + CMD(1) + SEQ(1) + LEN(1) + CRC16(2) = 7 bytes
  MIN_FRAME_LENGTH: 7
};

// Friendly Name Mappings for Logging & UI
const TYPE_NAMES = {
  [PROTOCOL.TYPE.COMMAND]: 'COMMAND',
  [PROTOCOL.TYPE.COMMAND_RECEIVED]: 'COMMAND_RECEIVED',
  [PROTOCOL.TYPE.COMMAND_DONE]: 'COMMAND_DONE',
  [PROTOCOL.TYPE.COMMAND_ERROR]: 'COMMAND_ERROR',
  [PROTOCOL.TYPE.DATA_RECEIVED]: 'DATA_RECEIVED'
};

const CMD_NAMES = {
  [PROTOCOL.CMD.PING]: 'PING',
  [PROTOCOL.CMD.GET_STATUS]: 'GET_STATUS',
  [PROTOCOL.CMD.GET_SENSORS]: 'GET_SENSORS',
  [PROTOCOL.CMD.SET_OUTPUT]: 'SET_OUTPUT',
  [PROTOCOL.CMD.GET_OUTPUTS]: 'GET_OUTPUTS',
  [PROTOCOL.CMD.DISPENSE]: 'DISPENSE',
  [PROTOCOL.CMD.STOP]: 'STOP',
  [PROTOCOL.CMD.ALL_OFF]: 'ALL_OFF',
  [PROTOCOL.CMD.GET_RTC]: 'GET_RTC',
  [PROTOCOL.CMD.SET_RTC]: 'SET_RTC'
};

const ERROR_NAMES = {
  [PROTOCOL.ERROR.NONE]: 'NO_ERROR',
  [PROTOCOL.ERROR.INVALID_COMMAND]: 'INVALID_COMMAND',
  [PROTOCOL.ERROR.INVALID_DATA]: 'INVALID_DATA',
  [PROTOCOL.ERROR.INVALID_OUTPUT]: 'INVALID_OUTPUT',
  [PROTOCOL.ERROR.CRC]: 'CRC_ERROR',
  [PROTOCOL.ERROR.BUSY]: 'DEVICE_BUSY',
  [PROTOCOL.ERROR.SENSOR]: 'SENSOR_ERROR',
  [PROTOCOL.ERROR.RTC]: 'RTC_ERROR'
};

/**
 * Builds a binary protocol frame Buffer matching firmware specification:
 * [HEAD (1B: 0xAA)] [TYPE (1B)] [CMD (1B)] [SEQ (1B)] [LEN (1B)] [DATA (0..100B)] [CRC_H (1B)] [CRC_L (1B)]
 * Note: CRC16 is computed over TYPE, CMD, SEQ, LEN and DATA (HEAD 0xAA is excluded).
 *
 * @param {number} type 1-byte Frame Type (PROTOCOL.TYPE.*)
 * @param {number} cmd 1-byte Command Code (PROTOCOL.CMD.*)
 * @param {number} seq 1-byte Sequence Number (0 - 255)
 * @param {Buffer|Uint8Array|Array<number>} [data] Optional payload bytes (0 to 100 bytes)
 * @returns {Buffer} Complete binary frame ready to transmit
 */
function buildFrame(type, cmd, seq, data = null) {
  let dataBuf;
  if (!data) {
    dataBuf = Buffer.alloc(0);
  } else if (Buffer.isBuffer(data)) {
    dataBuf = data;
  } else if (Array.isArray(data) || data instanceof Uint8Array) {
    dataBuf = Buffer.from(data);
  } else {
    throw new TypeError('Data payload must be a Buffer, Uint8Array or Array of byte numbers');
  }

  const dataLen = dataBuf.length;
  if (dataLen > PROTOCOL.MAX_DATA_LEN) {
    throw new RangeError(`Data payload exceeds maximum of ${PROTOCOL.MAX_DATA_LEN} bytes (got ${dataLen})`);
  }

  // Frame: HEAD(1) + TYPE(1) + CMD(1) + SEQ(1) + LEN(1) + DATA(N) + CRC16(2)
  const totalLength = 5 + dataLen + 2;
  const frame = Buffer.alloc(totalLength);

  frame[0] = PROTOCOL.HEAD;
  frame[1] = type & 0xFF;
  frame[2] = cmd & 0xFF;
  frame[3] = seq & 0xFF; // 1-byte sequence number
  frame[4] = dataLen & 0xFF;

  if (dataLen > 0) {
    dataBuf.copy(frame, 5);
  }

  // CRC16 calculated over TYPE, CMD, SEQ, LEN, and DATA (excluding HEAD at index 0)
  const crc = computeCRC16(frame, 1, 4 + dataLen);
  frame.writeUInt16BE(crc, 5 + dataLen);

  return frame;
}

/**
 * Parses an individual complete binary frame Buffer
 * @param {Buffer} buffer Complete frame
 * @returns {object|null} Parsed frame or null if invalid
 */
function parseFrame(buffer) {
  if (!buffer || buffer.length < PROTOCOL.MIN_FRAME_LENGTH) {
    return null;
  }

  if (buffer[0] !== PROTOCOL.HEAD) {
    return null;
  }

  const type = buffer[1];
  const cmd = buffer[2];
  const seq = buffer[3]; // 1-byte seq
  const len = buffer[4]; // 1-byte len

  const expectedTotalLen = 5 + len + 2;
  if (buffer.length !== expectedTotalLen) {
    return null;
  }

  // Verify CRC starting from offset 1 (excluding HEAD)
  if (!verifyCRC16(buffer, 1)) {
    return null;
  }

  const data = buffer.subarray(5, 5 + len);
  const crc = buffer.readUInt16BE(5 + len);

  return {
    head: PROTOCOL.HEAD,
    type,
    typeName: TYPE_NAMES[type] || `UNKNOWN_TYPE(0x${type.toString(16).padStart(2, '0')})`,
    cmd,
    cmdName: CMD_NAMES[cmd] || `UNKNOWN_CMD(0x${cmd.toString(16).padStart(2, '0')})`,
    seq,
    len,
    data: Buffer.from(data),
    crc,
    rawHex: buffer.toString('hex').toUpperCase(),
    timestamp: Date.now()
  };
}

/**
 * Streaming Frame Parser (State Machine)
 * Handles byte chunking, packet fragmentation, synchronization on 0xAA, and CRC validation.
 */
class StreamParser extends EventEmitter {
  constructor() {
    super();
    this.buffer = Buffer.alloc(0);
    this.maxBufferSize = 4096; // Guard against unbounded buffer memory
  }

  /**
   * Push incoming raw serial chunk into stream parser
   * @param {Buffer} chunk 
   */
  push(chunk) {
    if (!chunk || chunk.length === 0) return;

    // Concatenate new bytes
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // Safety check to prevent memory leak if continuous junk stream arrives
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.subarray(this.buffer.length - 1024);
      this.emit('error', new Error('Serial buffer overflow, truncated old bytes'));
    }

    this._processBuffer();
  }

  /**
   * Internal parser loop
   */
  _processBuffer() {
    while (this.buffer.length >= PROTOCOL.MIN_FRAME_LENGTH) {
      // 1. Scan for HEAD byte (0xAA)
      const headIndex = this.buffer.indexOf(PROTOCOL.HEAD);

      if (headIndex === -1) {
        // No HEAD found at all in buffer, clear it completely
        this.buffer = Buffer.alloc(0);
        break;
      }

      if (headIndex > 0) {
        // Discard junk bytes before HEAD
        const junk = this.buffer.subarray(0, headIndex);
        this.emit('junk', junk);
        this.buffer = this.buffer.subarray(headIndex);
      }

      // Check if we have at least header bytes (5 bytes: HEAD, TYPE, CMD, SEQ, LEN) to inspect LEN
      if (this.buffer.length < 5) {
        // Wait for more bytes
        break;
      }

      const len = this.buffer[4];
      if (len > PROTOCOL.MAX_DATA_LEN) {
        // Corrupted length byte encountered, discard current HEAD and continue search
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      const fullFrameLength = 5 + len + 2; // HEAD(1)+TYPE(1)+CMD(1)+SEQ(1)+LEN(1) + DATA(len) + CRC(2)

      if (this.buffer.length < fullFrameLength) {
        // Full frame not yet received in buffer; wait for next chunk
        break;
      }

      // We have candidate frame
      const candidate = this.buffer.subarray(0, fullFrameLength);

      // Verify CRC16 starting from offset 1 (excluding HEAD)
      if (verifyCRC16(candidate, 1)) {
        // Frame is valid!
        const parsed = parseFrame(candidate);
        this.buffer = this.buffer.subarray(fullFrameLength);
        this.emit('frame', parsed);
      } else {
        // CRC mismatch! Log and slide forward by 1 byte to find next HEAD
        this.emit('crc_error', {
          candidateHex: candidate.toString('hex').toUpperCase(),
          expectedCRC: computeCRC16(candidate, 1, candidate.length - 3).toString(16).padStart(4, '0').toUpperCase(),
          receivedCRC: candidate.readUInt16BE(candidate.length - 2).toString(16).padStart(4, '0').toUpperCase()
        });
        // Discard the corrupted 0xAA and resume searching
        this.buffer = this.buffer.subarray(1);
      }
    }
  }

  /**
   * Reset parser internal buffer
   */
  reset() {
    this.buffer = Buffer.alloc(0);
  }
}

module.exports = {
  PROTOCOL,
  TYPE_NAMES,
  CMD_NAMES,
  ERROR_NAMES,
  buildFrame,
  parseFrame,
  StreamParser
};
