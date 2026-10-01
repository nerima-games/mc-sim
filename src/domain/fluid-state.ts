export type FluidStateEntry = {
  readonly key: string
  readonly fluid: string
  readonly level: number
}

export type FluidState = {
  readonly entries: ReadonlyArray<FluidStateEntry>
}

export const EMPTY_FLUID_STATE: FluidState = { entries: [] }
