/**
 * Explosion and fixed-step workload benchmark.
 *
 * This follows mc-noise's R-C5 protocol: warm up, measure odd-numbered
 * samples, and compare the workload with a deterministic yardstick measured
 * in the same sample window. It is diagnostic, not part of `pnpm verify`.
 *
 * There is deliberately no guard here. mc-sim has no documented performance
 * exception with a fast spelling versus a straightforward spelling like
 * mc-noise's octave-loop exception. If one is introduced, add an in-process
 * A/B guard at the same time; an artificial slow implementation would make
 * this gate meaningless.
 */
import { DeltaTimeSecs, position, type DeltaTimeSecs as DeltaTimeSecsValue } from '@nerima-games/mc-kernel'
import { loadavg } from 'node:os'
import { Either } from 'effect'
import { planExplosion, type ExplosionBlockReader, type ExplosionRequest } from '../src/domain/explosion'
import { advanceFixedStep, initialFixedStepAccumulator } from '../src/domain/fixed-step'
import {
  checkGuards,
  checkWorkloads,
  formatCheck,
  formatWorkload,
  measurePaired,
  readBaseline,
  tolerancesFrom,
  wantsBaselineUpdate,
  writeBaseline,
  type Baseline,
  type Guard,
  type MeasureOptions,
  type Workload,
} from './bench-harness'

const BASELINE_PATH = new URL('./bench-baseline.json', import.meta.url).pathname
const RADII = [4, 8, 16] as const
const RUNS = 9
const WARMUP_ITERATIONS = 20
const BLOCKS_PER_RADIUS = (radius: number): number => (radius * 2 + 1) ** 3
// Fixed counts keep each timed explosion sample near 5 ms without weakening the gate.
const EXPLOSION_ITERATIONS: Readonly<Record<number, number>> = { 4: 32, 8: 4, 16: 1 }
const FIXED_STEP_FRAMES = 8192
const FIXED_STEP_ITERATIONS = 4

const blocks: ExplosionBlockReader = () => ({ resistance: 0, destructible: true })

const oneMinuteLoad = loadavg()[0] ?? Number.POSITIVE_INFINITY
if (oneMinuteLoad >= 10) {
  console.error(`Skipping benchmark: uptime 1-minute load average is ${oneMinuteLoad.toFixed(2)} (requires < 10)`)
  process.exit(2)
}
console.log(`uptime 1-minute load average: ${oneMinuteLoad.toFixed(2)} (< 10)`)

const requestFor = (radius: number): ExplosionRequest => ({
  center: position(0, 0, 0),
  radius,
  seed: 7,
  blocks,
  entities: [],
})

let sink = 0

const assertDeterministic = (request: ExplosionRequest): void => {
  const first = planExplosion(request)
  const second = planExplosion(request)
  if (
    first.visitedBlocks !== second.visitedBlocks ||
    first.destroyedBlocks.length !== second.destroyedBlocks.length ||
    first.truncated !== second.truncated
  ) {
    throw new Error('explosion benchmark fixture is not deterministic')
  }
}

const optionsFor = (iterations: number): MeasureOptions => ({
  iterations,
  runs: RUNS,
  warmupIterations: WARMUP_ITERATIONS,
})

const workloads: Workload[] = []
for (const radius of RADII) {
  const request = requestFor(radius)
  assertDeterministic(request)
  const yardstickIterations = BLOCKS_PER_RADIUS(radius)
  const iterations = EXPLOSION_ITERATIONS[radius] ?? 1
  const measurement = measurePaired(
    () => {
      const plan = planExplosion(request)
      sink ^= plan.visitedBlocks + plan.destroyedBlocks.length
    },
    () => {
      let value = 0
      for (let index = 0; index < yardstickIterations; index += 1) value = (value + index) | 0
      sink ^= value
    },
    optionsFor(iterations),
    optionsFor(iterations * yardstickIterations),
  )
  const plan = planExplosion(request)
  workloads.push({
    detail: `visited=${plan.visitedBlocks}`,
    msPerUnit: measurement.fastMs,
    name: `explosion/plan/radius-${radius}`,
    ratio: measurement.ratio,
    unit: 'explosion',
  })
}

const fixedStepDeltas: ReadonlyArray<DeltaTimeSecsValue> = Array.from(
  { length: FIXED_STEP_FRAMES },
  (_, index) => index % 17 === 0 ? DeltaTimeSecs(0.35) : DeltaTimeSecs(0.016),
)

const fixedStepWorkload = (): void => {
  let state = initialFixedStepAccumulator()
  let checksum = 0
  for (const delta of fixedStepDeltas) {
    const result = advanceFixedStep(state, delta)
    if (Either.isLeft(result)) throw new Error('fixed-step benchmark overflowed')
    state = result.right.state
    checksum += Number(result.right.ticks) + (result.right.overloaded ? 1 : 0)
  }
  sink ^= checksum + Number(state.tick)
}

const fixedStepYardstick = (): void => {
  let value = 0
  for (let index = 0; index < FIXED_STEP_FRAMES; index += 1) {
    value = (value + index * (index % 17 === 0 ? 5 : 1)) | 0
  }
  sink ^= value
}

const fixedStepMeasurement = measurePaired(
  fixedStepWorkload,
  fixedStepYardstick,
  optionsFor(FIXED_STEP_ITERATIONS),
  optionsFor(FIXED_STEP_ITERATIONS),
)
workloads.push({
  detail: `${String(FIXED_STEP_FRAMES)} deterministic frames; ordinary and overload deltas`,
  msPerUnit: fixedStepMeasurement.fastMs,
  name: `game-loop/fixed-step/${String(FIXED_STEP_FRAMES)}-frames`,
  ratio: fixedStepMeasurement.ratio,
  unit: 'frame-batch',
})

if (sink === Number.MIN_VALUE) console.log(sink)

const baseline = await readBaseline(BASELINE_PATH)
const tolerances = tolerancesFrom(process.argv)
const guards: Guard[] = []
const checks = [
  ...checkGuards(guards, baseline, tolerances.guard),
  ...checkWorkloads(workloads, 1, baseline, tolerances.workload),
]

console.log('Explosion and fixed-step benchmark (mc-noise R-C5 workload protocol)')
for (const workload of workloads) console.log(formatWorkload(workload))
for (const check of checks) console.log(formatCheck(check))

if (wantsBaselineUpdate(process.argv)) {
  const nextBaseline: Baseline = {
    version: 1,
    recordedOn: 'deterministic explosion fixtures; ratios are environment-sensitive',
    note: 'Workloads are planExplosion/yardstick ratios measured in one process with 20 warmups and 9 paired samples. Regenerate only for an intentional implementation or measurement change.',
    guards: {},
    workloads: Object.fromEntries(workloads.map((workload) => [workload.name, workload.ratio ?? Number.NaN])),
  }
  await writeBaseline(BASELINE_PATH, nextBaseline)
  console.log(`baseline updated: ${BASELINE_PATH}`)
} else if (checks.some((check) => check.status === 'regressed')) {
  process.exitCode = 1
}
