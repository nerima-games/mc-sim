import { Context, Effect, Layer, Ref, Schema } from 'effect'
import * as Equipment from '../domain/equipment.js'

export type EquipmentServiceApi = {
  readonly equip: (
    slot: Equipment.EquipmentSlot,
    item: Equipment.EquipmentItem,
  ) => Effect.Effect<Equipment.EquipmentItem | null, Equipment.EquipmentValidationError>
  readonly unequip: (
    slot: Equipment.EquipmentSlot,
  ) => Effect.Effect<Equipment.EquipmentItem | null, Equipment.EquipmentValidationError>
  readonly swap: (
    first: Equipment.EquipmentSlot,
    second: Equipment.EquipmentSlot,
  ) => Effect.Effect<void, Equipment.EquipmentValidationError>
  readonly damage: (
    slot: Equipment.EquipmentSlot,
    amount: number,
  ) => Effect.Effect<Equipment.DamageEquipmentResult, Equipment.EquipmentValidationError>
  readonly snapshot: Effect.Effect<Equipment.Equipment>
  /** World-load path. Invalid or partial snapshots fail without changing current state. */
  readonly restore: (
    snapshot: unknown,
  ) => Effect.Effect<void, Equipment.EquipmentValidationError>
  readonly reset: Effect.Effect<void>
}

export const EquipmentServiceEquipSuccessSchema: Schema.Codec<Equipment.EquipmentItem | null, unknown> =
  Schema.NullOr(Equipment.EquipmentItemSchema)
export const EquipmentServiceUnequipSuccessSchema: Schema.Codec<Equipment.EquipmentItem | null, unknown> =
  Schema.NullOr(Equipment.EquipmentItemSchema)
export const EquipmentServiceSwapSuccessSchema: Schema.Codec<void, undefined> = Schema.Undefined
export const EquipmentServiceDamageSuccessSchema: Schema.Codec<Equipment.DamageEquipmentResult, unknown> =
  Equipment.DamageEquipmentResultSchema
export const EquipmentServiceSnapshotSuccessSchema: Schema.Codec<Equipment.Equipment, unknown> =
  Equipment.EquipmentSchema
export const EquipmentServiceRestoreSuccessSchema: Schema.Codec<void, undefined> = Schema.Undefined
export const EquipmentServiceResetSuccessSchema: Schema.Codec<void, undefined> = Schema.Undefined
export const EquipmentServiceValidationErrorSchema: Schema.Codec<Equipment.EquipmentValidationError, unknown> =
  Equipment.EquipmentValidationErrorSchema
export const EquipmentServiceNoFailureSchema: Schema.Codec<never, never> = Schema.Never

const validationError = (path: string, reason: string): Equipment.EquipmentValidationError => ({
  _tag: 'EquipmentValidationError',
  path,
  reason,
})

const EquipmentServiceBase: Context.ServiceClass<
  EquipmentService,
  '@nerima-games/mc-sim/EquipmentService',
  EquipmentServiceApi
> = Context.Service<EquipmentService, EquipmentServiceApi>()('@nerima-games/mc-sim/EquipmentService')

export class EquipmentService extends EquipmentServiceBase {}

export const makeEquipmentService = (): Effect.Effect<EquipmentServiceApi> =>
  Effect.map(Ref.make(Equipment.emptyEquipment()), (state) => ({
    equip: (slot, item) => {
      if (!Equipment.isEquipmentSlot(slot)) {
        return Effect.fail(validationError('slot', 'expected an equipment slot'))
      }
      if (!Equipment.isEquipmentItem(item)) {
        return Effect.fail(validationError('item', 'expected a valid equipment item'))
      }
      return Ref.modify(state, (current) => {
        const outcome = Equipment.equip(current, slot, item)
        return [outcome.result, outcome.equipment]
      })
    },
    unequip: (slot) =>
      Equipment.isEquipmentSlot(slot)
        ? Ref.modify(state, (current) => {
            const outcome = Equipment.unequip(current, slot)
            return [outcome.result, outcome.equipment]
          })
        : Effect.fail(validationError('slot', 'expected an equipment slot')),
    swap: (first, second) =>
      Equipment.isEquipmentSlot(first) && Equipment.isEquipmentSlot(second)
        ? Effect.map(Ref.update(state, (current) => Equipment.swapEquipment(current, first, second)), () => undefined)
        : Effect.fail(validationError('slot', 'expected two equipment slots')),
    damage: (slot, amount) =>
      Equipment.isEquipmentSlot(slot)
        ? Ref.modify(state, (current) => {
            const outcome = Equipment.damageEquipment(current, slot, amount)
            return [outcome.result, outcome.equipment]
          })
        : Effect.fail(validationError('slot', 'expected an equipment slot')),
    snapshot: Ref.get(state),
    restore: (snapshot) => {
      const validated = Equipment.validateEquipmentSnapshot(snapshot)
      return validated._tag === 'Valid'
        ? Effect.map(Ref.set(state, validated.equipment), () => undefined)
        : Effect.fail(validated.error)
    },
    reset: Effect.map(Ref.set(state, Equipment.emptyEquipment()), () => undefined),
  }))

export const EquipmentServiceLayer: Layer.Layer<EquipmentService> = Layer.effect(
  EquipmentService,
  makeEquipmentService(),
)
