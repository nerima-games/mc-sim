import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

const now = (): number => performance.now() // mc-kernel-allow-time-source: benchmark harness

export type MeasureOptions = {
  readonly iterations: number
  readonly warmupIterations: number
  readonly runs: number
}

export type PairedMeasurement = {
  readonly fastMs: number
  readonly slowMs: number
  readonly ratio: number
}

export type Workload = {
  readonly name: string
  readonly msPerUnit: number
  readonly ratio?: number
  readonly unit: string
  readonly detail?: string
}

export type Baseline = {
  readonly version: 1
  readonly recordedOn: string
  readonly note: string
  readonly guards: Readonly<Record<string, number>>
  readonly workloads: Readonly<Record<string, number>>
}

export type CheckResult = {
  readonly label: string
  readonly kind: 'guard' | 'workload'
  readonly observed: number
  readonly baseline: number | undefined
  readonly status: 'ok' | 'regressed' | 'new'
}

export type Guard = {
  readonly name: string
  readonly fastMs: number
  readonly slowMs: number
}

export const DEFAULT_GUARD_TOLERANCE = 1.3
export const guardRatio = (guard: Guard): number => guard.slowMs / guard.fastMs

export const checkGuards = (
  guards: ReadonlyArray<Guard>,
  baseline: Baseline | undefined,
  tolerance: number,
): ReadonlyArray<CheckResult> => guards.map((guard) => {
  const observed = guardRatio(guard)
  const recorded = baseline?.guards[guard.name]
  return recorded === undefined
    ? { label: guard.name, kind: 'guard', observed, baseline: undefined, status: 'new' }
    : {
        label: guard.name,
        kind: 'guard',
        observed,
        baseline: recorded,
        status: observed >= recorded / tolerance ? 'ok' : 'regressed',
      }
})

export const median = (samples: ReadonlyArray<number>): number => {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
}

const timeBatch = (run: () => void, iterations: number): number => {
  const started = now()
  for (let index = 0; index < iterations; index += 1) run()
  return (now() - started) / iterations
}

export const measurePaired = (
  fast: () => void,
  slow: () => void,
  fastOptions: MeasureOptions,
  slowOptions: MeasureOptions,
): PairedMeasurement => {
  if (fastOptions.runs !== slowOptions.runs) throw new RangeError('paired measurements require equal run counts')
  const warmups = Math.max(fastOptions.warmupIterations, slowOptions.warmupIterations)
  for (let index = 0; index < warmups; index += 1) {
    if (index % 2 === 0) {
      if (index < fastOptions.warmupIterations) fast()
      if (index < slowOptions.warmupIterations) slow()
    } else {
      if (index < slowOptions.warmupIterations) slow()
      if (index < fastOptions.warmupIterations) fast()
    }
  }
  const fastSamples: number[] = []
  const slowSamples: number[] = []
  const ratios: number[] = []
  for (let sample = 0; sample < fastOptions.runs; sample += 1) {
    const fastFirst = sample % 2 === 0
    const first = fastFirst ? timeBatch(fast, fastOptions.iterations) : timeBatch(slow, slowOptions.iterations)
    const second = fastFirst ? timeBatch(slow, slowOptions.iterations) : timeBatch(fast, fastOptions.iterations)
    const fastMs = fastFirst ? first : second
    const slowMs = fastFirst ? second : first
    fastSamples.push(fastMs)
    slowSamples.push(slowMs)
    ratios.push(slowMs / fastMs)
  }
  return { fastMs: median(fastSamples), slowMs: median(slowSamples), ratio: median(ratios) }
}

export const checkWorkloads = (
  workloads: ReadonlyArray<Workload>,
  yardstickMs: number,
  baseline: Baseline | undefined,
  tolerance: number,
): ReadonlyArray<CheckResult> => workloads.map((workload) => {
  const observed = workload.ratio ?? workload.msPerUnit / yardstickMs
  const recorded = baseline?.workloads[workload.name]
  if (recorded === undefined) return { label: workload.name, kind: 'workload', observed, baseline: undefined, status: 'new' }
  return {
    label: workload.name,
    kind: 'workload',
    observed,
    baseline: recorded,
    status: observed <= recorded * tolerance ? 'ok' : 'regressed',
  }
})

export const readBaseline = async (filePath: string): Promise<Baseline | undefined> => {
  const raw = await readFile(filePath, 'utf8').catch(() => undefined)
  return raw === undefined ? undefined : (JSON.parse(raw) as Baseline)
}

export const writeBaseline = async (filePath: string, baseline: Baseline): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(baseline, undefined, 2)}\n`, 'utf8')
}

const pad = (text: string, width: number): string => text.padEnd(width)

export const formatWorkload = (workload: Workload): string =>
  `  ${pad(workload.name, 34)} ${workload.msPerUnit.toFixed(4)} ms/${workload.unit}` +
  (workload.detail === undefined ? '' : `   (${workload.detail})`)

export const formatCheck = (result: CheckResult): string => {
  const marker = result.status === 'ok' ? 'ok' : result.status === 'new' ? 'NEW' : 'REGRESSED'
  const against = result.baseline === undefined
    ? 'no baseline entry'
    : `observed ${result.observed.toFixed(3)}  baseline ${result.baseline.toFixed(3)}  (${(result.observed / result.baseline).toFixed(2)}x)`
  return `  ${pad(marker, 9)} ${pad(result.label, 34)} ${against}`
}

export const wantsBaselineUpdate = (argv: ReadonlyArray<string>): boolean => argv.includes('--update-baseline')

const numericFlag = (argv: ReadonlyArray<string>, name: string, fallback: number): number => {
  const flag = argv.find((argument) => argument.startsWith(`--${name}=`))
  const parsed = flag === undefined ? Number.NaN : Number.parseFloat(flag.slice(name.length + 3))
  return Number.isFinite(parsed) && parsed > 1 ? parsed : fallback
}

export const tolerancesFrom = (argv: ReadonlyArray<string>): { readonly guard: number; readonly workload: number } => ({
  guard: numericFlag(argv, 'guard-tolerance', DEFAULT_GUARD_TOLERANCE),
  workload: numericFlag(argv, 'workload-tolerance', 2),
})
