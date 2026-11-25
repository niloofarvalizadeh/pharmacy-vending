/**
 * Hardware Diagnostic & Serial Port Test CLI
 * Turns ON all 24 slots sequentially and leaves them ON.
 * Usage:
 *   node backend/test-hardware.js [port] [baudRate]
 */

'use strict';

const { SerialPort } = require('serialport');
const { PROTOCOL, buildFrame, parseFrame, StreamParser } = require('./protocol');

const targetPort = process.argv[2] || process.env.SERIAL_PORT || '/dev/ttyUSB0';
const baudRate = parseInt(process.argv[3], 10) || parseInt(process.env.BAUD_RATE, 10) || PROTOCOL.DEFAULT_BAUD;

async function run() {
  console.log('====================================================');
  console.log('💡 ATMEGA 24-SLOT ALL-ON DIAGNOSTIC TEST');
  console.log('====================================================');

  console.log(`Target Port: ${targetPort} @ ${baudRate} baud`);
  console.log('Opening connection...');

  const port = new SerialPort({
    path: targetPort,
    baudRate: baudRate,
    autoOpen: false
  });

  const parser = new StreamParser();
  let pendingResolve = null;
  let activeSeq = 0;

  parser.on('frame', (frame) => {
    if (frame.seq === activeSeq) {
      if (pendingResolve) {
        pendingResolve(frame);
        pendingResolve = null;
      }
    } else {
      console.log(`   [UNEXPECTED RX] SEQ=${frame.seq} TYPE=${frame.typeName}`);
    }
  });

  parser.on('crc_error', (err) => {
    console.error(`\n❌ [CRC ERROR DETECTED]`, err);
  });

  port.on('data', (chunk) => {
    parser.push(chunk);
  });

  port.on('error', (err) => {
    console.error(`\n❌ SerialPort Error: ${err.message}`);
  });

  port.open(async (err) => {
    if (err) {
      console.error(`\n❌ Failed to open port ${targetPort}: ${err.message}`);
      process.exit(1);
    }

    console.log(`\n✅ Serial port ${targetPort} opened successfully!`);
    console.log('   Waiting 1.5s for MCU stabilization...');
    await new Promise((r) => setTimeout(r, 1500));
    console.log('----------------------------------------------------');
    console.log(`🚀 Starting sequential activation of all ${PROTOCOL.OUTPUT_COUNT} slots (Leaving all ON)...`);
    console.log('----------------------------------------------------');

    const setOutputOn = (slotId, seq) => {
      return new Promise((resolve, reject) => {
        activeSeq = seq;
        const frame = buildFrame(PROTOCOL.TYPE.COMMAND, PROTOCOL.CMD.SET_OUTPUT, seq, [slotId, 1]);

        const timeout = setTimeout(() => {
          pendingResolve = null;
          reject(new Error(`Timeout waiting for Slot #${slotId} ACK`));
        }, 1200);

        pendingResolve = (rxFrame) => {
          clearTimeout(timeout);
          resolve(rxFrame);
        };

        port.write(frame, (writeErr) => {
          if (writeErr) {
            clearTimeout(timeout);
            pendingResolve = null;
            return reject(writeErr);
          }
          port.drain();
        });
      });
    };

    let successCount = 0;

    try {
      for (let slot = 1; slot <= PROTOCOL.OUTPUT_COUNT; slot++) {
        const seq = slot; // 1 to 24
        process.stdout.write(`⚡ Turning ON Slot #${slot.toString().padStart(2, ' ')} / 24 ... `);

        try {
          const res = await setOutputOn(slot, seq);
          const errCode = res.data && res.data.length > 0 ? res.data[0] : 0;
          if (res.type === PROTOCOL.TYPE.COMMAND_DONE && errCode === PROTOCOL.ERROR.NONE) {
            console.log(`✅ ON [ACK OK - CRC: 0x${res.crc.toString(16).padStart(4, '0').toUpperCase()}]`);
            successCount++;
          } else {
            console.log(`⚠️ MCU ERROR CODE: 0x${errCode.toString(16)}`);
          }
        } catch (e) {
          console.log(`❌ FAILED: ${e.message}`);
        }

        // Brief delay between slots for smooth visual activation
        await new Promise((r) => setTimeout(r, 150));
      }

      console.log('----------------------------------------------------');
      console.log(`✨ DONE! Successfully turned ON ${successCount} of ${PROTOCOL.OUTPUT_COUNT} slots.`);
      console.log('🔒 All outputs remain ON (No OFF command sent).');
      console.log('----------------------------------------------------');
    } catch (e) {
      console.error('Test execution error:', e);
    } finally {
      // Keep port open for 1 second before clean exit
      await new Promise((r) => setTimeout(r, 1000));
      port.close();
      process.exit(0);
    }
  });
}

run().catch(console.error);
