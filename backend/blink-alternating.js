/**
 * Alternating Blinker Test for 24-slot ATmega Board
 * Alternates Odd (ON) / Even (OFF) <--> Odd (OFF) / Even (ON)
 */

'use strict';

const { SerialPort } = require('serialport');
const { PROTOCOL, buildFrame, parseFrame, StreamParser } = require('./protocol');

const targetPort = process.argv[2] || process.env.SERIAL_PORT || '/dev/ttyUSB0';
const baudRate = parseInt(process.argv[3], 10) || 9600;
const CYCLES = parseInt(process.argv[4], 10) || 4; // Number of alternation cycles

async function run() {
  console.log('====================================================');
  console.log('✨ ATMEGA 24-SLOT ALTERNATING BLINKER TEST');
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

  port.on('data', (chunk) => parser.push(chunk));

  port.open(async (err) => {
    if (err) {
      console.error(`Failed to open port: ${err.message}`);
      process.exit(1);
    }

    console.log(`Port ${targetPort} opened @ ${baudRate} baud.`);
    console.log('Waiting 1.5s for MCU...');
    await new Promise((r) => setTimeout(r, 1500));

    let seqCounter = 1;

    const setSlot = (slotId, state) => {
      return new Promise((resolve) => {
        const seq = seqCounter++;
        if (seqCounter > 255) seqCounter = 1;
        activeSeq = seq;

        const frame = buildFrame(PROTOCOL.TYPE.COMMAND, PROTOCOL.CMD.SET_OUTPUT, seq, [slotId, state]);

        const timeout = setTimeout(() => {
          pendingResolve = null;
          resolve(false);
        }, 150);

        pendingResolve = () => {
          clearTimeout(timeout);
          resolve(true);
        };

        port.write(frame);
      });
    };

    console.log(`Starting ${CYCLES} alternating blink cycles...\n`);

    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      const isOddOn = (cycle % 2 === 1);
      console.log(`⚡ [Cycle ${cycle}/${CYCLES}] Pattern: ${isOddOn ? 'ODD slots ON (🟢) / EVEN slots OFF (🔴)' : 'ODD slots OFF (🔴) / EVEN slots ON (🟢)'}`);

      for (let slot = 1; slot <= PROTOCOL.OUTPUT_COUNT; slot++) {
        const shouldBeOn = (slot % 2 === 1) ? isOddOn : !isOddOn;
        await setSlot(slot, shouldBeOn ? 1 : 0);
      }

      console.log(`   Cycle ${cycle} pattern applied. Holding for 700ms...`);
      await new Promise((r) => setTimeout(r, 700));
    }

    console.log('\n====================================================');
    console.log('🎉 Alternating blink test completed successfully!');
    console.log('====================================================');

    await new Promise((r) => setTimeout(r, 1000));
    port.close();
    process.exit(0);
  });
}

run().catch(console.error);
