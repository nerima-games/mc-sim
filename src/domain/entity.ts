/** Public entity API: value types and pure roster operations. */
export {
  EntityId,
  EntityKind,
  type EntityState,
  type Entity,
  type EntityRoster,
  type SpawnRequest,
  type SpawnOutcome,
  type DespawnOutcome,
  type EntityTransition,
  type EntityStep,
  type SweepOutcome,
  type BehaviourRepair,
  type RosterRepair,
  type NormaliseRosterOutcome,
  isEntityId,
  isEntityKind,
  ENTITY_ID_PREFIX,
  mintEntityId,
  serialOfEntityId,
} from './entity-types'
export * from './entity-operations'
