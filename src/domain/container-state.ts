import { Brand, Schema } from 'effect'
import * as Storage from './container-storage.js'

export type ContainerId = string & Brand.Brand<'ContainerId'>
export type ContainerState = Storage.Container
export type ContainerStateSnapshot = Storage.ContainerStorageSnapshot

const containerId: Brand.Brand.Constructor<ContainerId> = Brand.refined<ContainerId>(
  (value) => typeof value === 'string' && value.trim().length > 0,
  (value) => Brand.error(`ContainerId must be a non-blank string, received ${JSON.stringify(value)}`),
)

export { containerId as ContainerId }

export const isContainerId = (value: unknown): value is ContainerId =>
  typeof value === 'string' && value.trim().length > 0

export const emptyContainerState = (
  id: ContainerId,
  kind: Storage.ContainerKind = 'chest',
): ContainerState => Storage.emptyContainer(id, kind)

export const validateContainerStateSnapshot: typeof Storage.validateContainerStorageSnapshot =
  Storage.validateContainerStorageSnapshot

export const ContainerStateSchema: Schema.Schema<ContainerStateSnapshot> = Schema.declare(
  (value: unknown): value is ContainerStateSnapshot =>
    validateContainerStateSnapshot(value)._tag === 'Valid',
)
