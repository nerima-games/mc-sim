import { Effect } from 'effect'
import {
  blockPosition,
  ChunkAxis,
  type BlockAxis,
  type ChunkAxis as ChunkAxisValue,
  DeltaTimeSecs,
  FixedDurationSecs,
  itemStack,
  type ItemStack,
  SimulationTick,
  addTick,
  MonotonicTimeSecs,
  NonNegativeTickCount,
} from '@nerima-games/mc-kernel'
import type { FrameHandler, GameLoopApi, TimeServiceApi } from '../src/index.js'
import { advanceFixedStep, initialFixedStepAccumulator } from '../src/index.js'

const handler: FrameHandler = () => Effect.void
const delta: DeltaTimeSecs = DeltaTimeSecs(0.05)
const fixed: FixedDurationSecs = FixedDurationSecs(0.05)
const tick: SimulationTick = SimulationTick(1)
const blockAxis: BlockAxis = blockPosition(0, 0, 0).x
const chunkAxis: ChunkAxisValue = ChunkAxis(0)

const gameLoopInput: Parameters<GameLoopApi['submitFrame']>[0] = MonotonicTimeSecs(0)
const timeAdvanceInput: Parameters<TimeServiceApi['advance']>[0] = delta
const item: ItemStack = itemStack('stone', 1)

void handler
void gameLoopInput
void timeAdvanceInput
void item
void addTick(tick, NonNegativeTickCount(1))
void advanceFixedStep(initialFixedStepAccumulator(), delta)
void blockAxis
void chunkAxis

// @ts-expect-error A fixed duration is not a per-frame delta.
const wrongDelta: DeltaTimeSecs = fixed

// @ts-expect-error A plain number cannot be used as a simulation tick.
addTick(1, NonNegativeTickCount(1))

// @ts-expect-error A plain number cannot be used as a fixed-step delta.
advanceFixedStep(initialFixedStepAccumulator(), 0)

// @ts-expect-error Chunk coordinates cannot be used as block coordinates.
const wrongAxis: BlockAxis = chunkAxis

// @ts-expect-error Canonical ItemStack counts are positive branded values; zero is an empty slot.
const zeroCount: ItemStack = { item: 'stone', count: 0 }

void wrongDelta
void zeroCount
void wrongAxis
