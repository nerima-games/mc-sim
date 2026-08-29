import { INVENTORY_SLOT_COUNT } from './inventory'

/** Number of selectable slots in the player's hotbar. */
export const HOTBAR_SIZE = 9

/** First inventory index occupied by the hotbar. */
export const HOTBAR_START = INVENTORY_SLOT_COUNT - HOTBAR_SIZE

/** True when a value is an integer index within the selectable hotbar. */
export const isHotbarIndex = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value < HOTBAR_SIZE

/** Clamp an external slot value to the vanilla hotbar selection range. */
export const clampHotbarIndex = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.min(HOTBAR_SIZE - 1, Math.max(0, Math.trunc(value)))
}

/** Cycle a selection by a wheel or controller delta, wrapping at both ends. */
export const cycleHotbarIndex = (index: number, delta: number): number => {
  const current = clampHotbarIndex(index)
  if (!Number.isFinite(delta) || delta === 0) return current
  const steps = Math.trunc(delta)
  return ((current + steps) % HOTBAR_SIZE + HOTBAR_SIZE) % HOTBAR_SIZE
}

/** Convert a hotbar selection index into its player-inventory slot index. */
export const hotbarSlotIndex = (index: number): number => HOTBAR_START + clampHotbarIndex(index)
