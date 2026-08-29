/**
 * Primed-TNT planning is delegated entirely to mc-physics (re-exporting mc-kernel's
 * implementation) so fuse timing and blast planning stay in sync with the rest of
 * the ecosystem instead of diverging in a parallel fork.
 */
export {
  applyPrimedTntPlan,
  DEFAULT_TNT_FUSE_SECS,
  MAX_TNT_FUSE_ADVANCE_SECS,
  planPrimedTnt,
  primeTnt,
} from '@nerima-games/mc-physics'
export type {
  PrimedTntCommit,
  PrimedTntMutation,
  PrimedTntPlan,
  PrimedTntRequest,
  PrimedTntState,
} from '@nerima-games/mc-physics'
