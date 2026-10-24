// Keep ordinary phone acceptance distinct from full-frame desktop recordings.
export function browserViewport(recording, operations = false) {
  return recording ? { width: 1904, height: 960 } : operations ? { width: 1280, height: 800 } : { width: 390, height: 844 };
}

// Current recorded apps have light surfaces. A mostly black Xvfb matte is not
// usable footage merely because its container dimensions and mean luma pass.
// Human inspection remains required; this is not a general image-quality model.
export function recordingSampleIsUsable(sample) {
  return Number.isFinite(sample.meanLuma) && sample.meanLuma > 25 &&
    Number.isFinite(sample.blackPercent) && sample.blackPercent >= 0 && sample.blackPercent <= 20;
}
