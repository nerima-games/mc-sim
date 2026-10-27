import type { SaveSliceId, SaveVersion, SimulationTick } from '@nerima-games/mc-kernel'
import type { NoiseSeed } from '@nerima-games/mc-worldgen'
import { Context, Effect, Schema } from 'effect'
import type { IntentQueue, QueuedIntent } from '../application/intent-queue.js'

export type HeadlessSaveSlice = {
  readonly id: SaveSliceId
  readonly version: SaveVersion
  readonly schema: Schema.Codec<unknown, unknown>
  readonly snapshot: Effect.Effect<unknown>
}

export type HeadlessHarnessSession = {
  readonly close: Effect.Effect<void>
  readonly intents: IntentQueue['Service']
  readonly runTick: (
    tick: SimulationTick,
    ready: ReadonlyArray<QueuedIntent>,
  ) => Effect.Effect<void>
  readonly saveSlices: ReadonlyArray<HeadlessSaveSlice>
}

export type HeadlessHarnessSessionFactoryApi = {
  readonly open: (worldSeed: NoiseSeed) => Effect.Effect<HeadlessHarnessSession>
}

const HeadlessHarnessSessionFactoryBase: Context.ServiceClass<
  HeadlessHarnessSessionFactory,
  'mc-sim/testing/HeadlessHarnessSessionFactory',
  HeadlessHarnessSessionFactoryApi
> = Context.Service<HeadlessHarnessSessionFactory, HeadlessHarnessSessionFactoryApi>()(
  'mc-sim/testing/HeadlessHarnessSessionFactory',
)

export class HeadlessHarnessSessionFactory extends HeadlessHarnessSessionFactoryBase {}
