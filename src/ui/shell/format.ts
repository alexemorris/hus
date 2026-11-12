import type { DisplayUnits } from '../../state/shell-store.ts';

/** Formats a length in metres using the chosen display units. */
export function formatLength(meters: number, units: DisplayUnits): string {
  if (units === 'ftin') {
    const totalInches = meters * 39.3700787;
    let feet = Math.floor(totalInches / 12);
    let inches = Math.round(totalInches - feet * 12);
    if (inches === 12) {
      feet += 1;
      inches = 0;
    }
    return `${feet}′ ${inches}″`;
  }
  return meters >= 10 ? `${meters.toFixed(1)} m` : `${meters.toFixed(2)} m`;
}
