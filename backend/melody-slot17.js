/**
 * Rhythmic Melody Player on Output #17
 * Target: Slot 17 (Buzzer / Relay / Solenoid Clicker)
 * Plays 3 famous rhythmic tunes:
 *  1. Shave and a Haircut (تق - تق تق تق - تق ... تق تق!)
 *  2. Star Wars Imperial March (رژه حماسی)
 *  3. Mission Impossible (مأموریت غیرممکن)
 *  4. Tavalodet Mobarak (ریتم تولدت مبارک)
 */

'use strict';

const { SerialPort } = require('serialport');
const { PROTOCOL, buildFrame, StreamParser } = require('./protocol');

const targetPort = process.argv[2] || process.env.SERIAL_PORT || '/dev/ttyUSB0';
const baudRate = parseInt(process.argv[3], 10) || 9600;
const SLOT_ID = 17; // Output 17

async function run() {
  console.log('====================================================');
  console.log(`🎵 RHYTHMIC MELODY PLAYER ON OUTPUT #${SLOT_ID} 🎵`);
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
      console.error(`Port error: ${err.message}`);
      process.exit(1);
    }

    console.log(`Port ${targetPort} opened @ ${baudRate} baud.`);
    console.log('Waiting 1.5s for MCU...');
    await new Promise((r) => setTimeout(r, 1500));

    let seqCounter = 1;

    const setSlot = (state) => {
      const seq = seqCounter++;
      if (seqCounter > 255) seqCounter = 1;
      const frame = buildFrame(PROTOCOL.TYPE.COMMAND, PROTOCOL.CMD.SET_OUTPUT, seq, [SLOT_ID, state ? 1 : 0]);
      port.write(frame);
    };

    // Play a rhythmic note (ON for onMs, then OFF for pauseMs)
    const playNote = async (onMs, pauseMs, noteSymbol = '🔔') => {
      process.stdout.write(noteSymbol);
      setSlot(1);
      await new Promise((r) => setTimeout(r, onMs));
      setSlot(0);
      await new Promise((r) => setTimeout(r, pauseMs));
    };

    try {
      // -------------------------------------------------------------
      // Melody 1: "Shave and a Haircut ... Two Bits!" (تق - تق تق تق - تق ... تق تق!)
      // -------------------------------------------------------------
      console.log('\n🎶 [1/4] Melody 1: "Shave and a Haircut... Two Bits!"');
      process.stdout.write('   Playing: ');
      await playNote(90, 110, '🔊 ');
      await playNote(60, 70, '🔉 ');
      await playNote(60, 70, '🔉 ');
      await playNote(90, 110, '🔊 ');
      await playNote(90, 320, '🔊 ... ');
      await playNote(80, 120, '🎵 ');
      await playNote(120, 600, '🎶\n');
      await new Promise((r) => setTimeout(r, 800));

      // -------------------------------------------------------------
      // Melody 2: Star Wars Imperial March
      // -------------------------------------------------------------
      console.log('🎶 [2/4] Melody 2: Star Wars Imperial March');
      process.stdout.write('   Playing: ');
      // Dun, dun, dun
      await playNote(160, 130, '🥁 ');
      await playNote(160, 130, '🥁 ');
      await playNote(160, 130, '🥁 ');
      // Da-da dun
      await playNote(110, 80, '🎵 ');
      await playNote(50, 60, '🎶 ');
      await playNote(160, 130, '🥁 ');
      // Da-da dun
      await playNote(110, 80, '🎵 ');
      await playNote(50, 60, '🎶 ');
      await playNote(220, 600, '💥\n');
      await new Promise((r) => setTimeout(r, 800));

      // -------------------------------------------------------------
      // Melody 3: Mission Impossible
      // -------------------------------------------------------------
      console.log('🎶 [3/4] Melody 3: Mission Impossible Theme');
      process.stdout.write('   Playing: ');
      for (let m = 0; m < 2; m++) {
        await playNote(180, 120, '🕶️ ');
        await playNote(180, 120, '🕶️ ');
        await playNote(70, 80, '⚡ ');
        await playNote(70, 80, '⚡ ');
      }
      await playNote(220, 600, '🎯\n');
      await new Promise((r) => setTimeout(r, 800));

      // -------------------------------------------------------------
      // Melody 4: "Tavalodet Mobarak" (تولدت مبارک)
      // -------------------------------------------------------------
      console.log('🎶 [4/4] Melody 4: Tavalodet Mobarak (ریتم شاد تولدت مبارک)');
      process.stdout.write('   Playing: ');
      // تـَ تـَ تام (Happy Birthday to you)
      await playNote(70, 70, '🎂 ');
      await playNote(70, 90, '🎂 ');
      await playNote(180, 160, '🎉 ');

      await playNote(70, 70, '🎂 ');
      await playNote(70, 90, '🎂 ');
      await playNote(180, 160, '🎉 ');

      await playNote(70, 70, '🎂 ');
      await playNote(70, 90, '🎂 ');
      await playNote(160, 120, '🎈 ');
      await playNote(160, 120, '🎈 ');
      await playNote(240, 400, '🎁\n');

      console.log('\n====================================================');
      console.log('✨ All melodies finished cleanly on Output #17.');
      console.log('🔒 Output #17 is safely turned OFF.');
      console.log('====================================================');
    } catch (e) {
      console.error('Error during melody execution:', e);
    } finally {
      setSlot(0); // Ensure OFF
      await new Promise((r) => setTimeout(r, 600));
      port.close();
      process.exit(0);
    }
  });
}

run().catch(console.error);
