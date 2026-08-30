import {
  isEntityId,
  isEntityKind,
  mintEntityId,
  NO_ENTITIES,
  repairState,
  serialOfEntityId,
} from './entity-types.js'
import type {
  BehaviourRepair,
  DespawnOutcome,
  Entity,
  EntityId,
  EntityKind,
  EntityRoster,
  EntityState,
  EntityStep,
  EntityTransition,
  NormaliseRosterOutcome,
  SpawnOutcome,
  SpawnRequest,
  SweepOutcome,
} from './entity-types.js'

export const emptyRoster = <S>(): EntityRoster<S> => ({ entities: NO_ENTITIES, nextSerial: 0 })

export const spawnEntity = <S>(roster: EntityRoster<S>, request: SpawnRequest<S>): SpawnOutcome<S> => {
  const entity: Entity<S> = {
    id: mintEntityId(roster.nextSerial),
    kind: request.kind,
    ...repairState(request),
  }
  return {
    roster: { entities: [...roster.entities, entity], nextSerial: roster.nextSerial + 1 },
    entity,
  }
}

export const despawnEntity = <S>(roster: EntityRoster<S>, id: EntityId): DespawnOutcome<S> => {
  const entities = roster.entities.filter((entity) => entity.id !== id)
  return entities.length === roster.entities.length
    ? { roster, despawned: false }
    : { roster: { entities, nextSerial: roster.nextSerial }, despawned: true }
}

export const findEntity = <S>(roster: EntityRoster<S>, id: EntityId): Entity<S> | undefined =>
  roster.entities.find((entity) => entity.id === id)

export const countOfKind = <S>(roster: EntityRoster<S>, kind: EntityKind): number =>
  roster.entities.reduce((total, entity) => (entity.kind === kind ? total + 1 : total), 0)

export const UNCHANGED: EntityTransition<never> = { _tag: 'Unchanged' }
export const DESPAWNED: EntityTransition<never> = { _tag: 'Despawned' }

export const changed = <S>(state: EntityState<S>): EntityTransition<S> => ({ _tag: 'Changed', state })

const NO_EMISSIONS: ReadonlyArray<never> = []

export const sweepRoster = <S, A>(
  roster: EntityRoster<S>,
  step: (entity: Entity<S>) => EntityStep<S, A>,
): SweepOutcome<S, A> => {
  let kept: Array<Entity<S>> | undefined
  let emitted: Array<A> | undefined

  roster.entities.forEach((entity, index) => {
    const outcome = step(entity)
    if (outcome.emit !== undefined) {
      emitted = emitted ?? []
      emitted.push(outcome.emit)
    }
    if (outcome.transition._tag === 'Unchanged') {
      kept?.push(entity)
      return
    }
    kept = kept ?? roster.entities.slice(0, index)
    if (outcome.transition._tag === 'Changed') {
      kept.push({ id: entity.id, kind: entity.kind, ...repairState(outcome.transition.state) })
    }
  })
  return {
    roster: kept === undefined ? roster : { entities: kept, nextSerial: roster.nextSerial },
    emitted: emitted ?? NO_EMISSIONS,
  }
}

export const normaliseRoster = <S>(
  roster: EntityRoster<S>,
  repairBehaviour?: BehaviourRepair<S>,
): NormaliseRosterOutcome<S> => {
  const incoming: ReadonlyArray<Entity<S>> =
    typeof roster === 'object' && roster !== null && Array.isArray(roster.entities) ? roster.entities : NO_ENTITIES

  const savedSerial =
    typeof roster?.nextSerial === 'number' && Number.isSafeInteger(roster.nextSerial)
      ? Math.max(0, roster.nextSerial)
      : 0
  const highestSerial = incoming.reduce((highest, entity) => {
    const serial = isEntityId(entity?.id) ? serialOfEntityId(entity.id) : undefined
    return serial !== undefined && serial >= highest ? serial + 1 : highest
  }, 0)

  let nextSerial = Math.max(savedSerial, highestSerial)
  let discarded = 0
  let reidentified = 0
  const taken = new Set<string>()
  const entities: Array<Entity<S>> = []

  incoming.forEach((entity) => {
    if (typeof entity !== 'object' || entity === null || !isEntityKind(entity.kind)) {
      discarded += 1
      return
    }
    const keepsItsId = isEntityId(entity.id) && !taken.has(entity.id)
    const id = keepsItsId ? entity.id : mintEntityId(nextSerial)
    if (!keepsItsId) {
      nextSerial += 1
      reidentified += 1
    }
    taken.add(id)

    const repaired = repairState(entity)
    entities.push({
      id,
      kind: entity.kind,
      feetPosition: repaired.feetPosition,
      healthPoints: repaired.healthPoints,
      behaviour: repairBehaviour === undefined ? repaired.behaviour : repairBehaviour(entity.kind, repaired.behaviour),
    })
  })

  return {
    roster: { entities: entities.length === 0 ? NO_ENTITIES : entities, nextSerial },
    discarded,
    reidentified,
  }
}
