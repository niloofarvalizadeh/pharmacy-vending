











'use strict';

const CRC_POLYNOMIAL = 0x1021;
const CRC_INITIAL = 0xFFFF;

// Precompute CRC-16 lookup table for maximum performance (Zero-Overhead)
const CRC_TABLE = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let curr = (i << 8) & 0xFFFF;
  for (let j = 0; j < 8; j++) {
    if ((curr & 0x8000) !== 0) {
      curr = ((curr << 1) ^ CRC_POLYNOMIAL) & 0xFFFF;
    } else {
      curr = (curr << 1) & 0xFFFF;
    }
  }
  CRC_TABLE[i] = curr;
}

/**
 * Calculates CRC-16/CCITT-FALSE over a Buffer or Uint8Array
 * @param {Buffer|Uint8Array} buffer 
 * @param {number} [offset=0]
 * @param {number} [length]
 * @returns {number} 16-bit unsigned integer (0x0000 - 0xFFFF)
 */
function computeCRC16(buffer, offset = 0, length = null) {
  const len = length !== null ? length : (buffer.length - offset);
  let crc = CRC_INITIAL;
  
  for (let i = 0; i < len; i++) {
    const byte = buffer[offset + i];
    const tableIndex = ((crc >> 8) ^ byte) & 0xFF;
    crc = ((crc << 8) ^ CRC_TABLE[tableIndex]) & 0xFFFF;
  }
  
  return crc;
}

/**
 * Verifies that the CRC16 stored at the end of a buffer matches the computed CRC16
 * @param {Buffer} buffer Complete frame including the 2-byte CRC at the end
 * @param {number} [offset=0] Offset to start computing CRC from (e.g. 1 to skip HEAD byte)
 * @returns {boolean} True if CRC is valid
 */
function verifyCRC16(buffer, offset = 0) {
  if (!buffer || buffer.length < offset + 2) return false;
  const payloadLen = buffer.length - offset - 2;
  const computed = computeCRC16(buffer, offset, payloadLen);
  const received = buffer.readUInt16BE(buffer.length - 2);
  return computed === received;
}

module.exports = {
  computeCRC16,
  verifyCRC16,
  CRC_POLYNOMIAL,
  CRC_INITIAL
};
