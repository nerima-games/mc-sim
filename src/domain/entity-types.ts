import { Brand } from 'effect'
import type { Position } from '@nerima-games/mc-kernel'
import { position } from '@nerima-games/mc-kernel'

export type EntityId = string & Brand.Brand<'EntityId'>

const entityId: Brand.Brand.Constructor<EntityId> = Brand.refined<EntityId>(
  (value) => typeof value === 'string' && value.trim().length > 0,
  (value) => Brand.error(`EntityId must be a non-blank string, received ${JSON.stringify(value)}`),
)
export { entityId as EntityId }

export type EntityKind = string & Brand.Brand<'EntityKind'>

const entityKind: Brand.Brand.Constructor<EntityKind> = Brand.refined<EntityKind>(
  (value) => typeof value === 'string' && value.trim().length > 0,
  (value) => Brand.error(`EntityKind must be a non-blank string, received ${JSON.stringify(value)}`),
)
export { entityKind as EntityKind }

export const isEntityId = (value: unknown): value is EntityId =>
  typeof value === 'string' && value.trim().length > 0

export const isEntityKind = (value: unknown): value is EntityKind =>
  typeof value === 'string' && value.trim().length > 0

export const ENTITY_ID_PREFIX = 'e:'

export const mintEntityId = (serial: number): EntityId => entityId(`${ENTITY_ID_PREFIX}${serial}`)

export const serialOfEntityId = (id: string): number | undefined => {
  if (!id.startsWith(ENTITY_ID_PREFIX)) {
    return undefined
  }
  const digits = id.slice(ENTITY_ID_PREFIX.length)
  if (digits.length === 0 || !/^\d+$/.test(digits)) {
    return undefined
  }
  const serial = Number(digits)
  return Number.isSafeInteger(serial) ? serial : undefined
}

export type EntityState<S> = {
  readonly feetPosition: Position
  readonly healthPoints: number
  readonly behaviour: S
}

export type Entity<S> = EntityState<S> & {
  readonly id: EntityId
  readonly kind: EntityKind
}

export type EntityRoster<S> = {
  readonly entities: ReadonlyArray<Entity<S>>
  readonly nextSerial: number
}

export const NO_ENTITIES: ReadonlyArray<never> = []

const magnitude = (value: number): number => (Number.isFinite(value) ? value : 0)

const repairPosition = (value: Position): Position =>
  typeof value === 'object' && value !== null
    ? position(magnitude(value.x), magnitude(value.y), magnitude(value.z))
    : position(0, 0, 0)

const repairHealth = (value: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0

export const repairState = <S>(state: EntityState<S>): EntityState<S> => ({
  feetPosition: repairPosition(state.feetPosition),
  healthPoints: repairHealth(state.healthPoints),
  behaviour: state.behaviour,
})

export type SpawnRequest<S> = {
  readonly kind: EntityKind
  readonly feetPosition: Position
  readonly healthPoints: number
  readonly behaviour: S
}

export type SpawnOutcome<S> = {
  readonly roster: EntityRoster<S>
  readonly entity: Entity<S>
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
  readonly discarded: number
  readonly reidentified: number
}

export type NormaliseRosterOutcome<S> = RosterRepair & {
  readonly roster: EntityRoster<S>
}
