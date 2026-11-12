/** Shared easing / progress helpers for interaction animations. */

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Advances a 0..1 animation `progress` towards `target` (0 or 1) by `dtSeconds * speed`.
 */
export function stepProgress(
  progress: number,
  target: 0 | 1,
  dtSeconds: number,
  speed: number
): number {
  const step = dtSeconds * speed;
  return progress < target ? Math.min(1, progress + step) : Math.max(0, progress - step);
}
