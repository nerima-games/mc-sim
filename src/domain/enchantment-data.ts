import {
  AnvilEnchantmentId,
  type AnvilEnchantmentRule,
  type ItemType,
} from '@nerima-games/mc-kernel'

export const SUPPORTED_VANILLA_ENCHANTMENT_IDS = [
  'aqua_affinity',
  'bane_of_arthropods',
  'binding_curse',
  'blast_protection',
  'depth_strider',
  'efficiency',
  'feather_falling',
  'fire_aspect',
  'fire_protection',
  'flame',
  'fortune',
  'frost_walker',
  'infinity',
  'knockback',
  'looting',
  'luck_of_the_sea',
  'lure',
  'mending',
  'power',
  'projectile_protection',
  'protection',
  'punch',
  'respiration',
  'sharpness',
  'silk_touch',
  'smite',
  'soul_speed',
  'sweeping_edge',
  'swift_sneak',
  'thorns',
  'unbreaking',
  'vanishing_curse',
] as const

export type SupportedVanillaEnchantmentId = (typeof SUPPORTED_VANILLA_ENCHANTMENT_IDS)[number]

export type VanillaAnvilCost = Readonly<{
  item: number
  book: number
}>

export const VANILLA_ENCHANTMENT_COSTS: Record<SupportedVanillaEnchantmentId, VanillaAnvilCost> = {
  aqua_affinity: { item: 4, book: 2 },
  bane_of_arthropods: { item: 2, book: 1 },
  binding_curse: { item: 8, book: 4 },
  blast_protection: { item: 4, book: 2 },
  depth_strider: { item: 4, book: 2 },
  efficiency: { item: 1, book: 1 },
  feather_falling: { item: 2, book: 1 },
  fire_aspect: { item: 4, book: 2 },
  fire_protection: { item: 2, book: 1 },
  flame: { item: 4, book: 2 },
  fortune: { item: 4, book: 2 },
  frost_walker: { item: 4, book: 2 },
  infinity: { item: 8, book: 4 },
  knockback: { item: 2, book: 1 },
  looting: { item: 4, book: 2 },
  luck_of_the_sea: { item: 4, book: 2 },
  lure: { item: 4, book: 2 },
  mending: { item: 4, book: 2 },
  power: { item: 1, book: 1 },
  projectile_protection: { item: 2, book: 1 },
  protection: { item: 1, book: 1 },
  punch: { item: 4, book: 2 },
  respiration: { item: 4, book: 2 },
  sharpness: { item: 1, book: 1 },
  silk_touch: { item: 8, book: 4 },
  smite: { item: 2, book: 1 },
  soul_speed: { item: 8, book: 4 },
  sweeping_edge: { item: 4, book: 2 },
  swift_sneak: { item: 8, book: 4 },
  thorns: { item: 8, book: 4 },
  unbreaking: { item: 2, book: 1 },
  vanishing_curse: { item: 8, book: 4 },
} as const

const ARMOR_ITEMS = [
  'iron_helmet',
  'iron_chestplate',
  'iron_leggings',
  'iron_boots',
] as const satisfies ReadonlyArray<ItemType>

const HELMET_ITEMS = ['iron_helmet'] as const satisfies ReadonlyArray<ItemType>
const BOOTS_ITEMS = ['iron_boots'] as const satisfies ReadonlyArray<ItemType>
const LEGGINGS_ITEMS = ['iron_leggings'] as const satisfies ReadonlyArray<ItemType>

const SWORD_ITEMS = [
  'wooden_sword',
  'stone_sword',
  'iron_sword',
  'diamond_sword',
] as const satisfies ReadonlyArray<ItemType>

const MINING_ITEMS = [
  'wooden_pickaxe',
  'stone_pickaxe',
  'iron_pickaxe',
  'diamond_pickaxe',
  'wooden_hoe',
  'stone_hoe',
  'iron_hoe',
  'diamond_hoe',
  'shears',
] as const satisfies ReadonlyArray<ItemType>

const BOW_ITEMS = ['bow'] as const satisfies ReadonlyArray<ItemType>
const FISHING_ROD_ITEMS = ['fishing_rod'] as const satisfies ReadonlyArray<ItemType>

const DAMAGEABLE_ITEMS = [
  ...ARMOR_ITEMS,
  'flint_and_steel',
  ...MINING_ITEMS,
  ...SWORD_ITEMS,
  ...BOW_ITEMS,
  ...FISHING_ROD_ITEMS,
] as const satisfies ReadonlyArray<ItemType>

type VanillaEnchantmentRuleDefinition = Readonly<{
  id: SupportedVanillaEnchantmentId
  maxLevel: number
  applicableItems: ReadonlyArray<ItemType>
  incompatibleWith: ReadonlyArray<SupportedVanillaEnchantmentId>
}>

const defineRule = (
  id: SupportedVanillaEnchantmentId,
  maxLevel: number,
  applicableItems: ReadonlyArray<ItemType>,
  incompatibleWith: ReadonlyArray<SupportedVanillaEnchantmentId> = [],
): VanillaEnchantmentRuleDefinition => ({
  id,
  maxLevel,
  applicableItems,
  incompatibleWith,
})

const VANILLA_ENCHANTMENT_RULE_DEFINITIONS = [
  defineRule('aqua_affinity', 1, HELMET_ITEMS),
  defineRule('bane_of_arthropods', 5, SWORD_ITEMS, ['sharpness', 'smite']),
  defineRule('binding_curse', 1, ARMOR_ITEMS),
  defineRule('blast_protection', 4, ARMOR_ITEMS, ['protection', 'fire_protection', 'projectile_protection']),
  defineRule('depth_strider', 3, BOOTS_ITEMS, ['frost_walker']),
  defineRule('efficiency', 5, MINING_ITEMS),
  defineRule('feather_falling', 4, BOOTS_ITEMS),
  defineRule('fire_aspect', 2, SWORD_ITEMS),
  defineRule('fire_protection', 4, ARMOR_ITEMS, ['protection', 'blast_protection', 'projectile_protection']),
  defineRule('flame', 1, BOW_ITEMS),
  defineRule('fortune', 3, MINING_ITEMS, ['silk_touch']),
  defineRule('frost_walker', 2, BOOTS_ITEMS, ['depth_strider']),
  defineRule('infinity', 1, BOW_ITEMS, ['mending']),
  defineRule('knockback', 2, SWORD_ITEMS),
  defineRule('looting', 3, SWORD_ITEMS),
  defineRule('luck_of_the_sea', 3, FISHING_ROD_ITEMS),
  defineRule('lure', 3, FISHING_ROD_ITEMS),
  defineRule('mending', 1, DAMAGEABLE_ITEMS, ['infinity']),
  defineRule('power', 5, BOW_ITEMS),
  defineRule('projectile_protection', 4, ARMOR_ITEMS, ['protection', 'fire_protection', 'blast_protection']),
  defineRule('protection', 4, ARMOR_ITEMS, ['fire_protection', 'blast_protection', 'projectile_protection']),
  defineRule('punch', 2, BOW_ITEMS),
  defineRule('respiration', 3, HELMET_ITEMS),
  defineRule('sharpness', 5, SWORD_ITEMS, ['smite', 'bane_of_arthropods']),
  defineRule('silk_touch', 1, MINING_ITEMS, ['fortune']),
  defineRule('smite', 5, SWORD_ITEMS, ['sharpness', 'bane_of_arthropods']),
  defineRule('soul_speed', 3, BOOTS_ITEMS),
  defineRule('sweeping_edge', 3, SWORD_ITEMS),
  defineRule('swift_sneak', 3, LEGGINGS_ITEMS),
  defineRule('thorns', 3, ARMOR_ITEMS),
  defineRule('unbreaking', 3, DAMAGEABLE_ITEMS),
  defineRule('vanishing_curse', 1, DAMAGEABLE_ITEMS),
] as const

type VanillaAnvilCostSource = keyof VanillaAnvilCost

const rulesForCostSource = (
  costSource: VanillaAnvilCostSource,
): ReadonlyArray<AnvilEnchantmentRule> =>
  VANILLA_ENCHANTMENT_RULE_DEFINITIONS.map(({ id, maxLevel, applicableItems, incompatibleWith }) => ({
    id: AnvilEnchantmentId(id),
    maxLevel,
    applicableItems,
    incompatibleWith: incompatibleWith.map((value) => AnvilEnchantmentId(value)),
    costPerLevel: VANILLA_ENCHANTMENT_COSTS[id][costSource],
  }))

export const SUPPORTED_VANILLA_BOOK_ENCHANTMENT_RULES: ReadonlyArray<AnvilEnchantmentRule> =
  rulesForCostSource('book')
export const SUPPORTED_VANILLA_ITEM_ENCHANTMENT_RULES: ReadonlyArray<AnvilEnchantmentRule> =
  rulesForCostSource('item')

export const SUPPORTED_VANILLA_ENCHANTMENT_RULES: ReadonlyArray<AnvilEnchantmentRule> =
  SUPPORTED_VANILLA_BOOK_ENCHANTMENT_RULES
