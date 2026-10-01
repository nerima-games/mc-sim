export type PortalStateEntry = {
  readonly id: string
  readonly active: boolean
}

export type PortalState = {
  readonly entries: ReadonlyArray<PortalStateEntry>
}

export const EMPTY_PORTAL_STATE: PortalState = { entries: [] }
