import { Brand, Result } from 'effect'
import {
  StackCount,
  itemStackWithCount as kernelItemStackWithCount,
  type ItemStack,
  type ItemStackFailure as KernelItemStackFailure,
} from '@nerima-games/mc-kernel'

export type ItemStackFailure = Brand.BrandError | KernelItemStackFailure

export const itemStackWithCount = (
  stack: ItemStack,
  count: number,
): Result.Result<ItemStack, ItemStackFailure> =>
  Result.flatMap(StackCount.result(count), (stackCount) =>
    kernelItemStackWithCount(stack, stackCount))
