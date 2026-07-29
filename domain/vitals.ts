/**
 * Stable public facade for the vitals domain.
 *
 * Keep consumers importing from this module. Implementations live in focused
 * internal modules so the public import path stays stable.
 */
export * from './vitals-model'
export * from './vitals-health'
export * from './vitals-hunger'
export * from './vitals-experience'
export * from './vitals-lifecycle'
export * from './vitals-validation'
export * from './vitals-view'
