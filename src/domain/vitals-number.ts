/** Internal numeric guards shared by vitals domain modules. */

export const hasMagnitude = (value: number): boolean =>
  typeof value === 'number' && !Number.isNaN(value)

export const clamp = (value: number, low: number, high: number): number =>
  hasMagnitude(value) ? Math.max(low, Math.min(high, value)) : low

export const delta = (value: number): number => (hasMagnitude(value) ? value : 0)

export const settle = (value: number, period: number): number =>
  Number.isFinite(value) && value > 0 ? value % period : 0
