/**
 * 60-Second Multi-Pattern Relay Light Show for 24-slot Kiosk Board
 * Duration: 60 seconds
 * Patterns:
 *  1. Waterfall / Cascade (آبشار مستقیم)
 *  2. Knight Rider Ping-Pong (رفت و برگشت جارویی)
 *  3. In-Out Mirror (همگرایی از طرفین به مرکز و بازگشت)
 *  4. Alternating Strobe (چشمک‌زن پروانه‌ای متناوب)
 *  5. Register Bank Dance (رقص دسته‌های ۸ تایی شیفت‌رجیستر)
 */

'use strict';

const { SerialPort } = require('serialport');
const { PROTOCOL, buildFrame, StreamParser } = require('./protocol');

const targetPort = process.argv[2] || process.env.SERIAL_PORT || '/dev/ttyUSB0';
const baudRate = parseInt(process.argv[3], 10) || 9600;
const TOTAL_DURATION_MS = 60000; // 60 seconds

async function run() {
  console.log('====================================================');
  console.log('🎆 60-SECOND ATMEGA 24-SLOT LIGHT SHOW STARTED 🎆');
  console.log('====================================================');

  const port = new SerialPort({
    path: targetPort,
    baudRate: baudRate,
    hupcl: false,
    autoOpen: false
  });

  const parser = new StreamParser();
  port.on('data', (chunk) => parser.push(chunk));

  port.open(async (err) => {
    if (err) {
      console.error(`Port open error: ${err.message}`);
      process.exit(1);
    }

    console.log(`Port ${targetPort} opened @ ${baudRate} baud.`);
    console.log('Waiting 1.5s for MCU stabilization...');
    await new Promise((r) => setTimeout(r, 1500));

    let seqCounter = 1;

    // Fast command sender
    const setSlot = (slotId, state) => {
      const seq = seqCounter++;
      if (seqCounter > 255) seqCounter = 1;
      const frame = buildFrame(PROTOCOL.TYPE.COMMAND, PROTOCOL.CMD.SET_OUTPUT, seq, [slotId, state ? 1 : 0]);
      port.write(frame);
    };

    const startTime = Date.now();
    let currentPattern = 0;

    console.log('🎵 Starting dynamic light patterns for 60 seconds...\n');

    while (Date.now() - startTime < TOTAL_DURATION_MS) {
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      currentPattern = (currentPattern % 5) + 1;

      // -------------------------------------------------------------
      // Pattern 1: Knight Rider / Ping-Pong (رفت و برگشت متوالی)
      // -------------------------------------------------------------
      if (currentPattern === 1) {
        console.log(`[${elapsedSec}s] 🌊 Pattern 1: Knight Rider Ping-Pong (1 -> 24 -> 1)`);
        // Forward
        for (let s = 1; s <= 24; s++) {
          setSlot(s, 1);
          if (s > 1) setSlot(s - 1, 0);
          await new Promise((r) => setTimeout(r, 40));
        }
        setSlot(24, 0);
        // Backward
        for (let s = 24; s >= 1; s--) {
          setSlot(s, 1);
          if (s < 24) setSlot(s + 1, 0);
          await new Promise((r) => setTimeout(r, 40));
        }
        setSlot(1, 0);
      }

      // -------------------------------------------------------------
      // Pattern 2: Center Mirror Expand & Collapse (واگرایی و همگرایی)
      // -------------------------------------------------------------
      else if (currentPattern === 2) {
        console.log(`[${elapsedSec}s] 💠 Pattern 2: Center In-Out Mirror`);
        // From center (12, 13) outwards to (1, 24)
        for (let i = 0; i < 12; i++) {
          const left = 12 - i;
          const right = 13 + i;
          setSlot(left, 1);
          setSlot(right, 1);
          await new Promise((r) => setTimeout(r, 60));
          setSlot(left, 0);
          setSlot(right, 0);
        }
        // From outside (1, 24) inward to center
        for (let i = 11; i >= 0; i--) {
          const left = 12 - i;
          const right = 13 + i;
          setSlot(left, 1);
          setSlot(right, 1);
          await new Promise((r) => setTimeout(r, 60));
          setSlot(left, 0);
          setSlot(right, 0);
        }
      }

      // -------------------------------------------------------------
      // Pattern 3: Alternating Strobe Flasher (چشمک‌زن یکی‌درمیان سریع)
      // -------------------------------------------------------------
      else if (currentPattern === 3) {
        console.log(`[${elapsedSec}s] ⚡ Pattern 3: Rapid Alternating Strobe`);
        for (let burst = 0; burst < 4; burst++) {
          // Odd ON, Even OFF
          for (let s = 1; s <= 24; s += 2) setSlot(s, 1);
          for (let s = 2; s <= 24; s += 2) setSlot(s, 0);
          await new Promise((r) => setTimeout(r, 220));

          // Odd OFF, Even ON
          for (let s = 1; s <= 24; s += 2) setSlot(s, 0);
          for (let s = 2; s <= 24; s += 2) setSlot(s, 1);
          await new Promise((r) => setTimeout(r, 220));
        }
        // Turn all off
        for (let s = 1; s <= 24; s++) setSlot(s, 0);
        await new Promise((r) => setTimeout(r, 100));
      }

      // -------------------------------------------------------------
      // Pattern 4: Register Bank Trio Dance (رقص ۳ دسته ۸ تایی)
      // -------------------------------------------------------------
      else if (currentPattern === 4) {
        console.log(`[${elapsedSec}s] 🎛️ Pattern 4: Triple Register Bank Waves (1..8, 9..16, 17..24)`);
        const banks = [
          [1, 8],
          [9, 16],
          [17, 24]
        ];
        for (let round = 0; round < 3; round++) {
          for (const [start, end] of banks) {
            for (let s = start; s <= end; s++) setSlot(s, 1);
            await new Promise((r) => setTimeout(r, 160));
            for (let s = start; s <= end; s++) setSlot(s, 0);
          }
        }
      }

      // -------------------------------------------------------------
      // Pattern 5: Waterfall Cascade Fill & Drain (آبشار پر شونده و خالی شونده)
      // -------------------------------------------------------------
      else if (currentPattern === 5) {
        console.log(`[${elapsedSec}s] 🌈 Pattern 5: Cascade Fill & Drain`);
        // Fill 1 to 24
        for (let s = 1; s <= 24; s++) {
          setSlot(s, 1);
          await new Promise((r) => setTimeout(r, 35));
        }
        await new Promise((r) => setTimeout(r, 200));
        // Drain 1 to 24
        for (let s = 1; s <= 24; s++) {
          setSlot(s, 0);
          await new Promise((r) => setTimeout(r, 35));
        }
      }
    }

    // Safe conclusion: turn off all 24 slots
    console.log('\n----------------------------------------------------');
    console.log('🏁 60 Seconds elapsed! Turning off all 24 outputs safely...');
    for (let s = 1; s <= 24; s++) {
      setSlot(s, 0);
    }

    await new Promise((r) => setTimeout(r, 1200));
    port.close();
    console.log('✨ Light show finished cleanly.');
    process.exit(0);
  });
}

run().catch(console.error);
