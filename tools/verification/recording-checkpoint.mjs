import { appendFile } from 'node:fs/promises';

// Called only after the journey's real UI assertions. Briefly hold the actual
// active tab so a timestamp-selected frame cannot land on transient navigation.
export async function recordingCheckpoint(page, name) {
  if (process.env.VERIFY_HEADED !== 'true' || process.env.LAUNDRY_ISOLATED_RECORDING !== 'true') return;
  if (!['booking', 'return-dispatch', 'return-proof', 'delivered'].includes(name)) throw new Error('Unknown recording checkpoint');
  await page.bringToFront();
  await page.waitForTimeout(400);
  await appendFile('.verification/hq/checkpoints.jsonl', JSON.stringify({ name, at: Date.now() }) + '\n');
  await page.waitForTimeout(600);
}

export function checkpointSamples(checkpoints, startedAt, duration) {
  const expected = ['booking', 'return-dispatch', 'return-proof', 'delivered'];
  return expected.map(name => {
    const matches = checkpoints.filter(checkpoint => checkpoint.name === name);
    if (matches.length !== 1) throw new Error(`Missing or repeated recording checkpoint: ${name}`);
    const seconds = (matches[0].at - startedAt) / 1000;
    if (!Number.isFinite(seconds) || seconds < 0 || seconds >= duration) throw new Error(`Recording checkpoint outside captured timeline: ${name}`);
    return { name, seconds };
  });
}
