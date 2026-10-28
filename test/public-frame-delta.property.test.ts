import fc from 'fast-check'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'

const checks = { numRuns: 60, seed: 0x4652414d }

const extremeFiniteDelta = fc.oneof(
  fc.double({ min: 0, max: Number.MAX_VALUE, noNaN: true }),
  fc.constantFrom(0, Number.MIN_VALUE, Sim.MIN_FRAME_DELTA_SECS, Sim.MAX_FRAME_DELTA_SECS, Number.MAX_VALUE),
)
const hostileDelta = fc.oneof(extremeFiniteDelta, fc.constant(Number.NaN))

it('root frame-delta clamp and between helpers stay finite and bounded for hostile scalar readings', () => {
  fc.assert(
    fc.property(
      fc.tuple(hostileDelta, fc.oneof(fc.constant(undefined), extremeFiniteDelta), extremeFiniteDelta),
      (value) => {
        const [raw, previous, now] = value
        const clamped = Sim.clampFrameDelta(raw as never)
        expect(Number.isFinite(clamped)).toBe(true)
        expect(clamped).toBeGreaterThanOrEqual(Sim.MIN_FRAME_DELTA_SECS)
        expect(clamped).toBeLessThanOrEqual(Sim.MAX_FRAME_DELTA_SECS)

        const between = Sim.frameDeltaBetween(previous as never, now as never)
        expect(Number.isFinite(between)).toBe(true)
        expect(between).toBeGreaterThanOrEqual(Sim.MIN_FRAME_DELTA_SECS)
        expect(between).toBeLessThanOrEqual(Sim.MAX_FRAME_DELTA_SECS)
        if (previous === undefined) expect(between).toBe(Sim.FIRST_FRAME_DELTA_SECS)
      },
    ),
    checks,
  )
})

it('root frame-delta loss helpers stay finite and reconstruct finite non-negative elapsed time', () => {
  fc.assert(
    fc.property(fc.tuple(hostileDelta, fc.oneof(fc.constant(undefined), extremeFiniteDelta)), ([raw, previous]) => {
      const loss = Sim.frameDeltaLossSecs(raw as never)
      expect(Number.isFinite(loss)).toBe(true)
      expect(loss).toBeGreaterThanOrEqual(0)
      expect(loss).toBe(Number.isNaN(raw) ? 0 : Math.max(0, raw - Sim.clampFrameDelta(raw as never)))

      const between = Sim.frameDeltaBetween(previous as never, raw as never)
      const lossBetween = Sim.frameDeltaLossBetween(previous as never, raw as never)
      expect(Number.isFinite(between)).toBe(true)
      expect(Number.isFinite(lossBetween)).toBe(true)
      expect(lossBetween).toBeGreaterThanOrEqual(0)
      if (previous === undefined) {
        expect(between).toBe(Sim.FIRST_FRAME_DELTA_SECS)
        expect(lossBetween).toBe(0)
      } else {
        const elapsed = raw - previous
        expect(lossBetween).toBe(Number.isNaN(elapsed) ? 0 : Math.max(0, elapsed - between))
      }
    }),
    checks,
  )
})
