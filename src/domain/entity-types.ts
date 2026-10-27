import { Brand } from 'effect'
import {
  EntityHealthPoints,
  EntityRosterRepairCount,
  EntitySerial,
  PositionAxis,
  position,
  type EntityId,
  type EntityKind,
  type Position,
} from '@nerima-games/mc-kernel'

export {
  EntityHealthPoints,
  EntityId,
  EntityKind,
  EntityRosterRepairCount,
  EntitySerial,
  isEntityId,
  isEntityKind,
  ENTITY_ID_PREFIX,
  mintEntityId,
  serialOfEntityId,
} from '@nerima-games/mc-kernel'

export type EntityCount = number & Brand.Brand<'EntityCount'>
export const EntityCount: Brand.Constructor<EntityCount> = Brand.make((value) =>
  Number.isSafeInteger(value) && value >= 0
    ? true
    : `EntityCount must be a non-negative safe integer, received ${String(value)}`,
)

export type EntityState<S> = {
  readonly feetPosition: Position
  readonly healthPoints: EntityHealthPoints
  readonly behaviour: S
}

export type Entity<S> = EntityState<S> & {
  readonly id: EntityId
  readonly kind: EntityKind
}

export type EntityRoster<S> = {
  readonly entities: ReadonlyArray<Entity<S>>
  readonly nextSerial: EntitySerial
}

export const NO_ENTITIES: ReadonlyArray<never> = []

const magnitude = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const repairPosition = (value: Position): Position =>
  typeof value === 'object' && value !== null
    ? position(PositionAxis(magnitude(value.x)), PositionAxis(magnitude(value.y)), PositionAxis(magnitude(value.z)))
    : position(PositionAxis(0), PositionAxis(0), PositionAxis(0))

const repairHealth = (value: number): EntityHealthPoints =>
  EntityHealthPoints(typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0)

export const repairState = <S>(state: EntityState<S>): EntityState<S> => ({
  feetPosition: repairPosition(state.feetPosition),
  healthPoints: repairHealth(state.healthPoints),
  behaviour: state.behaviour,
})

export type SpawnRequest<S> = {
  readonly kind: EntityKind
  readonly feetPosition: Position
  readonly healthPoints: EntityHealthPoints
  readonly behaviour: S
}

export type SpawnOutcome<S> = {
  readonly roster: EntityRoster<S>
  readonly entity: Entity<S>
}

export type EntitySerialExhausted = {
  readonly _tag: 'EntitySerialExhausted'
}

export type DespawnOutcome<S> = {
  readonly roster: EntityRoster<S>
  readonly despawned: boolean
}

export type EntityTransition<S> =
  | { readonly _tag: 'Unchanged' }
  | { readonly _tag: 'Changed'; readonly state: EntityState<S> }
  | { readonly _tag: 'Despawned' }

export type EntityStep<S, A> = {
  readonly transition: EntityTransition<S>
  readonly emit: A | undefined
}

export type SweepOutcome<S, A> = {
  readonly roster: EntityRoster<S>
  readonly emitted: ReadonlyArray<A>
}

export type BehaviourRepair<S> = (kind: EntityKind, behaviour: S) => S

export type RosterRepair = {
  readonly discarded: EntityRosterRepairCount
  readonly reidentified: EntityRosterRepairCount
}

export type NormaliseRosterOutcome<S> = RosterRepair & {
  readonly roster: EntityRoster<S>
}
