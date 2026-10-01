import { Brand, Schema } from 'effect'
import * as Smelting from './smelting.js'

export type FurnaceId = string & Brand.Brand<'FurnaceId'>
export type FurnaceState = Smelting.FurnaceState
export type FurnaceSnapshotValidationError = Smelting.FurnaceSnapshotValidationError

const furnaceId: Brand.Brand.Constructor<FurnaceId> = Brand.refined<FurnaceId>(
  (value) => typeof value === 'string' && value.trim().length > 0,
  (value) => Brand.error(`FurnaceId must be a non-blank string, received ${JSON.stringify(value)}`),
)

export { furnaceId as FurnaceId }

export const isFurnaceId = (value: unknown): value is FurnaceId =>
  typeof value === 'string' && value.trim().length > 0

export const emptyFurnaceState: typeof Smelting.emptyFurnaceState = Smelting.emptyFurnaceState
export const validateFurnaceStateSnapshot: typeof Smelting.validateFurnaceSnapshot =
  Smelting.validateFurnaceSnapshot

export const FurnaceStateSchema: Schema.Schema<FurnaceState> = Schema.declare(
  (value: unknown): value is FurnaceState =>
    validateFurnaceStateSnapshot(value)._tag === 'Valid',
)
