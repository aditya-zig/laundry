/**
 * Bounded exponential backoff with jitter. `attempt` is the attempt that just
 * failed, so the first retry waits half to all of the base delay. The clock is
 * injected by the caller; this function only returns a duration.
 */
export function retryDelayMs(
  attempt: number,
  random: () => number = Math.random,
  options: { baseMs?: number; maxMs?: number } = {},
): number {
  const base = options.baseMs ?? 500;
  const max = options.maxMs ?? 5 * 60_000;
  if (!Number.isFinite(base) || base < 1) throw new Error('Backoff base must be a positive duration');
  if (!Number.isFinite(max) || max < base) throw new Error('Backoff ceiling must be at least the base');
  const exponent = Math.min(Math.max(Math.trunc(attempt), 1) - 1, 20);
  const ceiling = Math.min(max, base * 2 ** exponent);
  // Full jitter between 50 and 100 percent of the ceiling, so a burst of
  // failures does not retry in lockstep but never exceeds the ceiling.
  const sample = random();
  const factor = 0.5 + Math.min(Math.max(sample, 0), 1) * 0.5;
  return Math.max(1, Math.round(ceiling * factor));
}
