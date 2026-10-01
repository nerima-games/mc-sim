export type ProjectileCharge = {
  readonly id: string
  readonly charge: number
}

export type ProjectileState = {
  readonly charges: ReadonlyArray<ProjectileCharge>
}

export const EMPTY_PROJECTILE_STATE: ProjectileState = { charges: [] }
