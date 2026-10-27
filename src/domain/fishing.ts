import { EntityIdSchema, ProjectileIdSchema } from '@nerima-games/mc-kernel'
import type { EntityId, ItemType, ProjectileId } from '@nerima-games/mc-kernel'
import { Result, Schema } from 'effect'
import type { YieldableError } from 'effect/Cause'

export type FishingRodPhase = 'cast' | 'bite'
export const FishingRodPhaseSchema: Schema.Codec<FishingRodPhase, FishingRodPhase> =
  Schema.Literals(['cast', 'bite'])

export type FishingRodState = Readonly<{
  actor: EntityId
  bobber: ProjectileId
  phase: FishingRodPhase
}>
type FishingRodStateEncoded = Readonly<{
  actor: Schema.Codec.Encoded<typeof EntityIdSchema>
  bobber: Schema.Codec.Encoded<typeof ProjectileIdSchema>
  phase: FishingRodPhase
}>
export const FishingRodStateSchema: Schema.Codec<FishingRodState, FishingRodStateEncoded> = Schema.Struct({
  actor: EntityIdSchema,
  bobber: ProjectileIdSchema,
  phase: FishingRodPhaseSchema,
})

export type FishingState = Readonly<{ rods: ReadonlyArray<FishingRodState> }>
type FishingStateEncoded = Readonly<{
  rods: ReadonlyArray<Schema.Codec.Encoded<typeof FishingRodStateSchema>>
}>
export const FishingStateSchema: Schema.Codec<FishingState, FishingStateEncoded> = Schema.Struct({
  rods: Schema.Array(FishingRodStateSchema),
})

export type FishingOperation = 'cast' | 'bite' | 'reel'
export type FishingInvalidStateReason =
  | 'rod-already-active'
  | 'rod-not-active'
  | 'rod-already-bitten'
  | 'rod-has-no-bite'

type FishingInvalidStateFields = Readonly<{
  actor: EntityId
  operation: FishingOperation
  reason: FishingInvalidStateReason
}>
const FishingInvalidStateBase: new (args: FishingInvalidStateFields) =>
  YieldableError & { readonly _tag: 'FishingInvalidState' } & FishingInvalidStateFields =
  Schema.TaggedError<FishingInvalidState>()('FishingInvalidState', {
    actor: EntityIdSchema,
    operation: Schema.Literals(['cast', 'bite', 'reel']),
    reason: Schema.Literals([
      'rod-already-active',
      'rod-not-active',
      'rod-already-bitten',
      'rod-has-no-bite',
    ]),
  })
export class FishingInvalidState extends FishingInvalidStateBase {}

type FishingInvalidLootRollFields = Readonly<{
  reason: 'outside-unit-interval'
}>
const FishingInvalidLootRollBase: new (args: FishingInvalidLootRollFields) =>
  YieldableError & { readonly _tag: 'FishingInvalidLootRoll' } & FishingInvalidLootRollFields =
  Schema.TaggedError<FishingInvalidLootRoll>()('FishingInvalidLootRoll', {
    reason: Schema.Literals(['outside-unit-interval']),
  })
export class FishingInvalidLootRoll extends FishingInvalidLootRollBase {}

export type FishingFailure = FishingInvalidState | FishingInvalidLootRoll

export const FishingInvalidStateSchema: Schema.Codec<FishingInvalidState, unknown> =
  Schema.instanceOf(FishingInvalidState)
export const FishingInvalidLootRollSchema: Schema.Codec<FishingInvalidLootRoll, unknown> =
  Schema.instanceOf(FishingInvalidLootRoll)
export const FishingFailureSchema: Schema.Codec<FishingFailure, unknown> = Schema.Union([
  FishingInvalidStateSchema,
  FishingInvalidLootRollSchema,
])

export type FishingReelPlan = Readonly<{
  state: FishingState
  outcome: Readonly<{ _tag: 'NoBite' }> | Readonly<{ _tag: 'Caught'; bobber: ProjectileId }>
}>

const FISHING_LOOT_BANDS = [
  { item: 'cod', weight: 51 },
  { item: 'salmon', weight: 21 },
  { item: 'tropical_fish', weight: 2 },
  { item: 'pufferfish', weight: 11 },
  { item: 'bowl', weight: 3 },
  { item: 'leather', weight: 3 },
  { item: 'bone', weight: 4 },
  { item: 'name_tag', weight: 2 },
  { item: 'fishing_rod', weight: 1 },
] as const satisfies ReadonlyArray<Readonly<{ item: ItemType; weight: number }>>

const FISHING_FINAL_LOOT_BAND = { item: 'enchanted_book', weight: 2 } as const satisfies Readonly<{
  item: ItemType
  weight: number
}>
const FISHING_LOOT_TOTAL_WEIGHT = FISHING_LOOT_BANDS.reduce<number>(
  (total, band) => total + band.weight,
  FISHING_FINAL_LOOT_BAND.weight,
)

export const emptyFishingState = (): FishingState => ({ rods: [] })

const invalidState = (
  actor: EntityId,
  operation: FishingOperation,
  reason: FishingInvalidStateReason,
): Result.Result<never, FishingInvalidState> =>
  Result.fail(new FishingInvalidState({ actor, operation, reason }))

export const castFishingRod = (
  state: FishingState,
  actor: EntityId,
  bobber: ProjectileId,
): Result.Result<FishingState, FishingInvalidState> => {
  if (state.rods.some((rod) => rod.actor === actor)) {
    return invalidState(actor, 'cast', 'rod-already-active')
  }
  const rods = [...state.rods, { actor, bobber, phase: 'cast' as const }]
    .sort((left, right) => left.actor < right.actor ? -1 : left.actor > right.actor ? 1 : 0)
  return Result.succeed({ rods })
}

export const registerFishingBite = (
  state: FishingState,
  actor: EntityId,
): Result.Result<FishingState, FishingInvalidState> => {
  const index = state.rods.findIndex((rod) => rod.actor === actor)
  const rod = state.rods[index]
  if (rod === undefined) return invalidState(actor, 'bite', 'rod-not-active')
  if (rod.phase === 'bite') return invalidState(actor, 'bite', 'rod-already-bitten')
  const rods = [...state.rods]
  rods[index] = { ...rod, phase: 'bite' }
  return Result.succeed({ rods })
}

export const reelFishingRod = (
  state: FishingState,
  actor: EntityId,
): Result.Result<FishingReelPlan, FishingInvalidState> => {
  const rod = state.rods.find((candidate) => candidate.actor === actor)
  if (rod === undefined) return invalidState(actor, 'reel', 'rod-not-active')
  const next = { rods: state.rods.filter((candidate) => candidate.actor !== actor) }
  return Result.succeed({
    state: next,
    outcome: rod.phase === 'bite'
      ? { _tag: 'Caught', bobber: rod.bobber }
      : { _tag: 'NoBite' },
  })
}

export const fishingLootForSample = (
  sample: number,
): Result.Result<ItemType, FishingInvalidLootRoll> => {
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    return Result.fail(new FishingInvalidLootRoll({ reason: 'outside-unit-interval' }))
  }
  const bucket = Math.floor(sample * FISHING_LOOT_TOTAL_WEIGHT)
  let remaining = bucket
  for (const band of FISHING_LOOT_BANDS) {
    if (remaining < band.weight) return Result.succeed(band.item)
    remaining -= band.weight
  }
  return Result.succeed(FISHING_FINAL_LOOT_BAND.item)
}
