/**
 * Placement consumption — separating an item a use-context already reserved
 * (so it is not consumed a second time) from the items an interaction
 * actually spends.
 *
 * Ported verbatim from mc-compose's `apps/web/placement-consumption.ts`:
 * zero imports, fully generic over `Item`, and it never
 * touched a slot index or a stack limit, so it carries no dependency risk and
 * no behavioural change crossing into mc-sim. It is inventory bookkeeping —
 * "what did placing a block actually take out of hand" — which is a noun
 * this package already owns (`domain/inventory.ts`); the caller decides WHEN
 * a reservation exists and WHAT counts as consumed (mx-gameplay's placement
 * rule), same split as `applyDamage`'s amount/cause in `domain/vitals.ts`.
 */

/**
 * Remove one occurrence of each reserved item from `consumedItems`, at most
 * once per reservation and at most once per matching entry.
 *
 * A reservation match is consumed positionally (`indexOf` + `splice`), so two
 * equal items in `reservedItems` reserve against two separate occurrences in
 * `consumedItems`, never the same one twice. An item with no matching
 * reservation left passes through unchanged. Total item count is conserved
 * exactly: `consumedItems.length - result.length === number of reservations
 * actually matched`, which is never more than `reservedItems.length`.
 */
export const excludeReservedPlacementConsumptions = <Item>(
  consumedItems: ReadonlyArray<Item>,
  reservedItems: ReadonlyArray<Item>,
): ReadonlyArray<Item> => {
  const remainingReservations = [...reservedItems]

  return consumedItems.filter((item) => {
    const reservationIndex = remainingReservations.indexOf(item)
    if (reservationIndex < 0) return true
    remainingReservations.splice(reservationIndex, 1)
    return false
  })
}
