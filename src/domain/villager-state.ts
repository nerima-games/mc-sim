export type VillagerTradeStateEntry = {
  readonly id: string
  readonly uses: number
}

export type VillagerTradeState = {
  readonly entries: ReadonlyArray<VillagerTradeStateEntry>
}

export const EMPTY_VILLAGER_TRADE_STATE: VillagerTradeState = { entries: [] }
