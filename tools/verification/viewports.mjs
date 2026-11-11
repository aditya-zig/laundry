// Keep ordinary phone acceptance distinct from full-frame desktop recordings.
export function browserViewport(recording, operations = false) {
  return recording ? { width: 1904, height: 960 } : operations ? { width: 1280, height: 800 } : { width: 390, height: 844 };
}

// A headed automated browser is allowed only inside the recording command's
// owned virtual display. Ordinary acceptance must never open a personal window.
export function browserLaunchOptions(env = process.env) {
  if (env.VERIFY_HEADED !== 'true') return { headless: true };
  if (env.LAUNDRY_ISOLATED_RECORDING !== 'true' || !/^[^:]*:\d+(?:\.\d+)?$/.test(env.DISPLAY ?? '')) throw new Error('An owned isolated recording display is required');
  const slowMo = Number(env.VERIFY_SLOW_MO ?? '150');
  if (!Number.isFinite(slowMo) || slowMo < 0 || slowMo > 1000) throw new Error('Recording slow motion must be between 0 and 1000 ms');
  return { headless: false, slowMo };
}

export function reviewViewport(normal, env = process.env) {
  return browserLaunchOptions(env).headless ? normal : browserViewport(true);
}

// Current recorded apps have light surfaces. A mostly black Xvfb matte is not
// usable footage merely because its container dimensions and mean luma pass.
// Human inspection remains required; this is not a general image-quality model.
export function recordingSampleIsUsable(sample) {
  return Number.isFinite(sample.meanLuma) && sample.meanLuma > 25 &&
    Number.isFinite(sample.blackPercent) && sample.blackPercent >= 0 && sample.blackPercent <= 20;
}
