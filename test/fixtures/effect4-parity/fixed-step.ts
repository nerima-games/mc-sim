export const fixedStepParityCases = [
  { delta: 0.05, ticks: 1, tick: 1, remainder: 0, fraction: 0, overloaded: false },
  { delta: 0.1, ticks: 2, tick: 2, remainder: 0, fraction: 0, overloaded: false },
  { delta: 0.12, ticks: 2, tick: 2, remainder: 0.02, fraction: 0.4, overloaded: false },
  { delta: 0.01, ticks: 0, tick: 0, remainder: 0.01, fraction: 0.2, overloaded: false },
  { delta: 0.3, ticks: 5, tick: 5, remainder: 0, fraction: 0, overloaded: true },
] as const

export const fixedStepMainParityInput: {
  readonly initialTick: number
  readonly deltas: ReadonlyArray<number>
  readonly pausedDelta: number
  readonly resumedDelta: number
  readonly overflowTick: number
  readonly overflowDelta: number
} = {
  initialTick: 100,
  deltas: [0.0125, 0.0375, 0.125, 0.5],
  pausedDelta: 0.075,
  resumedDelta: 0.025,
  overflowTick: Number.MAX_SAFE_INTEGER,
  overflowDelta: 0.05,
}

export const fixedStepMainParityExpected = {
  sequence: [
    {
      _tag: 'Success',
      value: {
        state: { accumulator: 0.0125, tick: 100, tickDuration: 0.05, maxCatchUpTicks: 5, paused: false },
        ticks: 0,
        interpolationFraction: 0.25,
        overloaded: false,
      },
    },
    {
      _tag: 'Success',
      value: {
        state: { accumulator: 0, tick: 101, tickDuration: 0.05, maxCatchUpTicks: 5, paused: false },
        ticks: 1,
        interpolationFraction: 0,
        overloaded: false,
      },
    },
    {
      _tag: 'Success',
      value: {
        state: {
          accumulator: 0.024999999999999994,
          tick: 103,
          tickDuration: 0.05,
          maxCatchUpTicks: 5,
          paused: false,
        },
        ticks: 2,
        interpolationFraction: 0.4999999999999999,
        overloaded: false,
      },
    },
    {
      _tag: 'Success',
      value: {
        state: { accumulator: 0, tick: 108, tickDuration: 0.05, maxCatchUpTicks: 5, paused: false },
        ticks: 5,
        interpolationFraction: 0,
        overloaded: true,
      },
    },
  ],
  pausedAdvance: {
    _tag: 'Success',
    value: {
      state: { accumulator: 0, tick: 108, tickDuration: 0.05, maxCatchUpTicks: 5, paused: true },
      ticks: 0,
      interpolationFraction: 0,
      overloaded: false,
    },
  },
  resumeAdvance: {
    _tag: 'Success',
    value: {
      state: { accumulator: 0.025, tick: 108, tickDuration: 0.05, maxCatchUpTicks: 5, paused: false },
      ticks: 0,
      interpolationFraction: 0.5,
      overloaded: false,
    },
  },
  overflow: { _tag: 'Failure', error: { _tag: 'TimeOverflow' } },
} as const
