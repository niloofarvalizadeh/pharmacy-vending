/**
 * Turn OFF alternating slots (Slots 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24)
 * Uses persistent serial connection to prevent board reboot.
 */

'use strict';

const { SerialPort } = require('serialport');
const { PROTOCOL, buildFrame, parseFrame, StreamParser } = require('./protocol');

const targetPort = process.argv[2] || process.env.SERIAL_PORT || '/dev/ttyUSB0';
const baudRate = parseInt(process.argv[3], 10) || 9600;

async function run() {
  console.log('====================================================');
  console.log('🔌 ALTERNATING SLOTS (EVEN SLOTS) TURN OFF');
  console.log('====================================================');

  const port = new SerialPort({
    path: targetPort,
    baudRate: baudRate,
    hupcl: false,
    autoOpen: false
  });

  const parser = new StreamParser();
  let pendingResolve = null;
  let activeSeq = 0;

  parser.on('frame', (frame) => {
    if (frame.seq === activeSeq && pendingResolve) {
      pendingResolve(frame);
      pendingResolve = null;
    }
  });

  parser.on('crc_error', (err) => {
    console.error('CRC Error:', err);
  });

  port.on('data', (chunk) => {
    parser.push(chunk);
  });

  port.open(async (err) => {
    if (err) {
      console.error(`Failed to open ${targetPort}: ${err.message}`);
      process.exit(1);
    }

    console.log(`✅ Port ${targetPort} opened @ ${baudRate} baud.`);
    console.log('Waiting 1.5s for MCU...');
    await new Promise((r) => setTimeout(r, 1500));

    // Slots to turn OFF: 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24
    const slotsToTurnOff = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
    console.log(`Target Slots to turn OFF (${slotsToTurnOff.length} slots): ${slotsToTurnOff.join(', ')}\n`);

    const turnOffSlot = (slotId, seq) => {
      return new Promise((resolve) => {
        activeSeq = seq;
        const frame = buildFrame(PROTOCOL.TYPE.COMMAND, PROTOCOL.CMD.SET_OUTPUT, seq, [slotId, 0]);

        const timeout = setTimeout(() => {
          pendingResolve = null;
          resolve({ ok: false, reason: 'TIMEOUT' });
        }, 1200);

        pendingResolve = (rxFrame) => {
          clearTimeout(timeout);
          const errCode = rxFrame.data && rxFrame.data.length > 0 ? rxFrame.data[0] : 0;
          resolve({ ok: rxFrame.type === PROTOCOL.TYPE.COMMAND_DONE && errCode === 0, rxFrame });
        };

        port.write(frame);
      });
    };

    let okCount = 0;
    for (let i = 0; i < slotsToTurnOff.length; i++) {
      const slot = slotsToTurnOff[i];
      const seq = i + 1;

      process.stdout.write(`⚡ Turning OFF Slot #${slot.toString().padStart(2, ' ')} (SEQ ${seq}) ... `);
      const res = await turnOffSlot(slot, seq);

      if (res.ok) {
        okCount++;
        console.log(`✅ OFF confirmed [ACK 0x00]`);
      } else {
        console.log(`⚠️ ${res.reason || 'ERROR'}`);
      }

      await new Promise((r) => setTimeout(r, 200));
    }

    console.log('\n====================================================');
    console.log(`Summary: Successfully turned OFF ${okCount} of ${slotsToTurnOff.length} alternating slots.`);
    console.log('Slots 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24 ➔ 🔴 OFF');
    console.log('Slots 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23  ➔ 🟢 UNCHANGED / ON');
    console.log('====================================================');

    await new Promise((r) => setTimeout(r, 1000));
    port.close();
    process.exit(0);
  });
}

run().catch(console.error);
