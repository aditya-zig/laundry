import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { requireTestDatabase } from './evidence.mjs';
import { recordingSampleIsUsable } from './viewports.mjs';

async function main() {
  requireTestDatabase(process.env.DATABASE_URL);
  if (!process.env.DISPLAY || !/^[^:]*:\d+(?:\.\d+)?$/.test(process.env.DISPLAY)) throw new Error('An isolated Xvfb display is required; do not record a user desktop');
  if (process.env.LAUNDRY_ISOLATED_RECORDING !== 'true') throw new Error('Run pnpm verify:recording to create an owned virtual display');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Original video evidence requires a clean source revision');
  const directory = resolve('.verification/hq');
  await mkdir(directory, { recursive: true });
  const output = resolve(directory, 'browser-original-1080p30.mp4');
  const log = await open(resolve(directory, 'recorder.log'), 'w');
  let recorder, journey, interrupted = false;
  const stop = () => { interrupted = true; try { if (journey?.pid) process.kill(-journey.pid, 'SIGTERM'); } catch {} recorder?.stdin.end('q\n'); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const run = (command, args, options) => {
    const child = spawn(command, args, options);
    child.result = new Promise((accept, reject) => { child.once('error', reject); child.once('close', (code, signal) => accept({ code, signal })); });
    return child;
  };
  try {
    // Original 1920x1080 desktop capture at 30 fps, not a transcoded/upscaled
    // Playwright preview. Only this task's virtual display can be recorded.
    recorder = run('ffmpeg', ['-y', '-f', 'x11grab', '-framerate', '30', '-video_size', '1920x1080', '-i', process.env.DISPLAY,
      '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output],
    { stdio: ['pipe', log.fd, log.fd] });
    recorder.stdin.on('error', () => {});
    journey = run('pnpm', ['verify:browser'], { detached: true, stdio: 'inherit', env: { ...process.env, WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '', XDG_SESSION_TYPE: 'x11', VERIFY_HEADED: 'true', VERIFY_SLOW_MO: '150' } });
    const timeout = setTimeout(stop, 240000);
    const result = await journey.result;
    clearTimeout(timeout);
    recorder.stdin.end('q\n');
    const capture = await recorder.result;
    if (interrupted || result.code !== 0 || capture.code !== 0) throw new Error('Recorded browser journey or capture failed; diagnostic originals retained');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,codec_name', '-show_entries', 'format=duration,size', '-of', 'json', output], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) throw new Error('Could not inspect original recording metadata');
    const metadata = JSON.parse(probe.stdout), stream = metadata.streams[0];
    if (stream.width !== 1920 || stream.height !== 1080 || stream.r_frame_rate !== '30/1' || stream.codec_name !== 'h264' || Number(metadata.format.duration) < 15) throw new Error('Original recording does not meet 1080p/30fps/H.264 requirements');
    const bytes = await readFile(output);
    const samples = [];
    for (const fraction of [0.3, 0.5, 0.7]) {
      const seconds = Number(metadata.format.duration) * fraction;
      const file = `sample-${samples.length + 1}.png`;
      const frame = spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(seconds), '-i', output, '-frames:v', '1', resolve(directory, file)], { encoding: 'utf8' });
      if (frame.error || frame.status !== 0) throw new Error('Could not extract readable-review samples');
      const visible = spawnSync('ffmpeg', ['-v', 'info', '-i', resolve(directory, file), '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
      const brightness = Number(visible.stderr?.match(/lavfi\.signalstats\.YAVG=([\d.]+)/)?.[1]);
      if (visible.status !== 0 || !Number.isFinite(brightness)) throw new Error('Could not validate visible sample content');
      const matte = spawnSync('ffmpeg', ['-v', 'info', '-i', resolve(directory, file), '-vf', 'blackframe=amount=0:threshold=24', '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
      const blackPercent = Number(matte.stderr?.match(/pblack:(\d+)/)?.[1]);
      if (matte.error || matte.status !== 0 || !Number.isFinite(blackPercent)) throw new Error('Could not validate recording framing');
      samples.push({ file, seconds, meanLuma: brightness, blackPercent });
    }
    if (samples.filter(recordingSampleIsUsable).length < 2) throw new Error('The recording is blank or mostly unused canvas; no original evidence receipt issued');
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({ testedSha: revision, checkedAt: new Date().toISOString(), dirty: false,
      scope: 'Original virtual-desktop recording of legacy demo web acceptance; not production-v2, native or physical fulfillment evidence',
      file: 'browser-original-1080p30.mp4', sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length,
      metadata, samples, productionReady: false }, null, 2));
    console.log('Original 1080p/30fps H.264 browser recording verified; sampled frames require visual inspection.');
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    try { if (journey?.exitCode === null && journey.pid) process.kill(-journey.pid, 'SIGTERM'); } catch {}
    if (recorder?.exitCode === null) { recorder.stdin.end('q\n'); await recorder.result.catch(() => {}); }
    await log.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
