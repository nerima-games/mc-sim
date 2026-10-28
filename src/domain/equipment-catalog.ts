export type EquipmentCatalogDefinition<Slot extends string> = Readonly<{ readonly slot: Slot }>

export const buildRuntimeEquipmentCatalog = <Item extends string, Slot extends string>(
  items: ReadonlyArray<Item>,
  source: Readonly<Record<Item, Readonly<{ readonly slots: ReadonlyArray<unknown> }>>>,
  isSlot: (value: unknown) => value is Slot,
): Readonly<Partial<Record<Item, EquipmentCatalogDefinition<Slot>>>> => {
  const catalog: Partial<Record<Item, EquipmentCatalogDefinition<Slot>>> = {}
  for (const item of items) {
    const slot = source[item].slots.find(isSlot)
    if (slot === undefined) continue
    catalog[item] = { slot }
  }
  return catalog
}
