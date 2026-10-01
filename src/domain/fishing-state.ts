export type FishingStateEntry = {
  readonly id: string
  readonly active: boolean
}

export type FishingState = {
  readonly entries: ReadonlyArray<FishingStateEntry>
}

export const EMPTY_FISHING_STATE: FishingState = { entries: [] }
