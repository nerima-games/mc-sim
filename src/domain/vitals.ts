/**
 * Stable public facade for the vitals domain.
 *
 * Keep consumers importing from this module. Implementations live in focused
 * internal modules so the public import path stays stable.
 */
export * from './vitals-model.js'
export * from './vitals-health.js'
export * from './vitals-hunger.js'
export * from './vitals-experience.js'
export * from './vitals-lifecycle.js'
export * from './vitals-validation.js'
export * from './vitals-view.js'
