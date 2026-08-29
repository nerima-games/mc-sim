/**
 * Explosion planning is delegated entirely to mc-physics (re-exporting mc-kernel's
 * implementation) so the block-destruction hash and every other detail stay in sync
 * with the rest of the ecosystem instead of diverging in a parallel fork.
 */
export {
  applyExplosionPlan,
  DEFAULT_EXPLOSION_LIMITS,
  planExplosion,
} from '@nerima-games/mc-physics'
export type {
  ExplosionBlock,
  ExplosionBlockPosition,
  ExplosionBlockReader,
  ExplosionCommit,
  ExplosionEntity,
  ExplosionEntityEffect,
  ExplosionLimits,
  ExplosionMutation,
  ExplosionPlan,
  ExplosionRequest,
} from '@nerima-games/mc-physics'
