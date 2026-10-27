import { Brand, Result } from 'effect'
import {
  ingredientMatches,
  isItemStack,
  isItemType,
  StackCount,
  TagLocation,
  itemStackWithCount,
  type CraftingIngredient,
  type ItemStack,
  type ItemStackFailure,
  type ItemTagMemberships,
  type RecipeFailure,
  type RecipeMatchContext,
  type Slot,
} from '@nerima-games/mc-kernel'

export type StationRecipeValidationFailure = Readonly<{
  readonly _tag: 'StationRecipeValidationFailure'
  readonly path: string
  readonly reason: string
}>

export type StationRecipeFailure = Brand.BrandError | RecipeFailure | ItemStackFailure | StationRecipeValidationFailure

export const stationRecipeFailure = (path: string, reason: string): StationRecipeValidationFailure => ({
  _tag: 'StationRecipeValidationFailure',
  path,
  reason,
})

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isItemTagMemberships = (value: unknown): value is ItemTagMemberships =>
  value instanceof Map &&
  [...value.entries()].every(([tag, items]) =>
    typeof tag === 'string' && Result.isSuccess(TagLocation.result(tag)) &&
    items instanceof Set && [...items].every(isItemType),
  )

export const isRecipeMatchContext = (value: unknown): value is RecipeMatchContext =>
  isRecord(value) &&
  (value['station'] === undefined || typeof value['station'] === 'string' && value['station'].trim().length > 0) &&
  (value['itemTags'] === undefined || isItemTagMemberships(value['itemTags']))

export const validateContext = (
  value: unknown,
): Result.Result<RecipeMatchContext, StationRecipeValidationFailure> =>
  isRecipeMatchContext(value)
    ? Result.succeed(value)
    : Result.fail(stationRecipeFailure('context', 'invalid recipe match context'))

export const validateSlot = (
  value: unknown,
  path: string,
): Result.Result<Slot, StationRecipeValidationFailure> =>
  value === undefined || isItemStack(value)
    ? Result.succeed(value)
    : Result.fail(stationRecipeFailure(path, 'expected an ItemStack or undefined'))

export const validateRecipeTable = <A>(
  value: unknown,
  isRecipe: (candidate: unknown) => candidate is A,
  path: string,
): Result.Result<ReadonlyArray<A>, StationRecipeValidationFailure> =>
  Array.isArray(value) && value.every(isRecipe)
    ? Result.succeed(value)
    : Result.fail(stationRecipeFailure(path, 'expected a valid recipe table'))

export const matchesIngredient = (
  ingredient: CraftingIngredient,
  stack: ItemStack | undefined,
  context: RecipeMatchContext,
): Result.Result<boolean, RecipeFailure> =>
  stack === undefined || stack.count < ingredient.count
    ? Result.succeed(false)
    : ingredientMatches(ingredient, stack.item, context.itemTags)

export const consumeIngredient = (
  stack: ItemStack,
  ingredient: CraftingIngredient,
): Result.Result<Slot, Brand.BrandError | ItemStackFailure> => {
  const remaining = stack.count - ingredient.count
  if (remaining === 0) return Result.succeed(undefined)
  return Result.flatMap(StackCount.result(remaining), (count) => itemStackWithCount(stack, count))
}

export const comparePriorityAndId = (
  left: Readonly<{ readonly priority: number; readonly id: string }>,
  right: Readonly<{ readonly priority: number; readonly id: string }>,
): number => left.priority - right.priority || left.id.localeCompare(right.id)
