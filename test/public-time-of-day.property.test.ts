import fc from 'fast-check'
import { Result } from 'effect'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { assertResultContract, finiteTree, hostileNumber, hostileValue, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 40, seed: 0x54494d45 }
const coercionTrap = fc.constant({ toString: '' })
const hostileScalar = fc.oneof(hostileValue, coercionTrap)
const stateWithExtra = fc.record({
  ticks: fc.double({ min: 0, max: 1_000_000 }),
  dayLengthTicks: fc.constant(24_000),
  extra: hostileNumber,
})
const timeState = fc.oneof(unknownValue, stateWithExtra, fc.constant(Sim.INITIAL_TIME_STATE))

const assertValidTimeState = (value: unknown): void => {
  expect(finiteTree(value)).toBe(true)
  expect(Sim.isValidTimeState(value as never)).toBe(true)
}

it('time-state normalization and readers remain total with hostile state envelopes', () => {
  fc.assert(
    fc.property(timeState, (state) => {
      const normalized = Sim.normaliseTimeState(state as never)
      assertValidTimeState(normalized)
      expect(typeof Sim.isValidTimeState(state as never)).toBe('boolean')

      const fraction = Sim.timeOfDay(state as never)
      const dayLength = Sim.dayLengthSecs(state as never)
      const phase = Sim.moonPhase(state as never)
      expect(Number.isFinite(fraction) && fraction >= 0 && fraction < 1).toBe(true)
      expect(Number.isFinite(dayLength) && dayLength >= Sim.MIN_DAY_LENGTH_SECS && dayLength <= Sim.MAX_DAY_LENGTH_SECS).toBe(true)
      expect(Number.isInteger(phase) && phase >= 0 && phase < Sim.MOON_PHASE_COUNT).toBe(true)
      expect(typeof Sim.isNight(state as never)).toBe('boolean')
    }),
    checks,
  )
})

it('time setters repair hostile states and scalar inputs into finite states', () => {
  fc.assert(
    fc.property(timeState, hostileScalar, hostileScalar, (state, seconds, fraction) => {
      assertValidTimeState(Sim.setDayLength(state as never, seconds as never))
      assertValidTimeState(Sim.setTimeOfDay(state as never, fraction as never))
      assertValidTimeState(Sim.setDayLengthThenTimeOfDay(state as never, seconds as never, fraction as never))
    }),
    checks,
  )
})

it('advance returns a valid finite time state when hostile envelopes are accepted', () => {
  fc.assert(
    fc.property(timeState, hostileScalar, (state, delta) => {
      const result = Sim.advance(state as never, delta as never)
      assertResultContract('time-of-day.advance', () => result, Sim.TimeStateSchema, Sim.BrandErrorSchema)
    }),
    checks,
  )
})

it('simulationTickToDayFraction returns an in-range value when hostile coercions are accepted', () => {
  fc.assert(
    fc.property(hostileScalar, hostileScalar, (tick, dayLengthTicks) => {
      const result = Sim.simulationTickToDayFraction(tick as never, dayLengthTicks as never)
      if (Result.isSuccess(result)) {
        expect(Number.isFinite(result.success) && result.success >= 0 && result.success <= Sim.MAX_TIME_FRACTION).toBe(true)
      }
    }),
    checks,
  )
})
