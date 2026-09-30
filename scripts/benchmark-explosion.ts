/**
 * Bounded explosion workload benchmark.
 *
 * This follows mc-noise's R-C5 protocol: warm up, measure odd-numbered
 * samples, and compare the workload with a deterministic yardstick measured
 * in the same sample window. It is diagnostic, not part of `pnpm verify`.
 */
import { position } from '@nerima-games/mc-kernel'
import { loadavg } from 'node:os'
import { planExplosion, type ExplosionBlockReader, type ExplosionRequest } from '../src/domain/explosion'
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

const options: MeasureOptions = {
  iterations: 1,
  runs: RUNS,
  warmupIterations: WARMUP_ITERATIONS,
}

const workloads: Workload[] = []
for (const radius of RADII) {
  const request = requestFor(radius)
  assertDeterministic(request)
  const yardstickIterations = BLOCKS_PER_RADIUS(radius)
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
    options,
    { ...options, iterations: yardstickIterations },
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

if (sink === Number.MIN_VALUE) console.log(sink)

const baseline = await readBaseline(BASELINE_PATH)
const tolerances = tolerancesFrom(process.argv)
const guards: Guard[] = []
const checks = [
  ...checkGuards(guards, baseline, tolerances.guard),
  ...checkWorkloads(workloads, 1, baseline, tolerances.workload),
]

console.log('Explosion benchmark (mc-noise R-C5 workload protocol)')
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
