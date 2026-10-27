# Deterministic core state tick

`CoreTick` advances one logical `SimulationTick` without reading wall-clock time. `game-loop.ts` remains responsible for frame scheduling and fixed-step accumulation.

## Tick order

Before processing a tick, the runner validates that the current tick can be incremented. This prevents overflow from consuming intents or committing state.

For a valid current tick, the runner performs these stages in order:

1. `HeadlessHarness` takes the ready intents for the next `SimulationTick` and passes them to the core runner. The core merges any retained batch from a failed attempt, removes duplicate admission sequences, and orders the batch by target tick and then admission sequence.
2. Apply intent rules and game-rule decisions to produce candidate owner state and pending domain events.
3. Advance station state, including furnace and brewing progress.
4. Advance environment state, including world time and weather.
5. Advance entity state, including roster, vitals, wither, and vehicle updates.
6. Commit all changed owner candidates through the world's `WorldCommitCoordinator` in one commit.
7. Publish the staged domain events in stage order.
8. Advance the logical tick by one.

Stages return candidate state and events. They do not mutate committed state or publish events before the commit. This keeps a failed tick safe to retry.

## Failure and retry

If a stage or the commit fails, the runner does not publish events or advance the tick. It retains the intents taken for that tick and retries the stages against the latest committed snapshots on the next call. Stages must therefore derive their output from their inputs and committed snapshots instead of applying side effects before commit.

The coordinator commits all changed owners atomically. A tick with no owner changes skips the coordinator call; it also cannot publish domain events because no state change was committed.

The runner publishes events only after a successful commit and advances the tick after publication completes. Event publication and tick advancement run as one uninterruptible section so an interruption cannot leave a committed tick unadvanced. A backpressured event subscriber can delay the next tick until it accepts the event.

## Frame boundary

`game-loop.ts` converts elapsed frame time into fixed simulation steps and calls the core tick once per step. Rendering interpolation remains a frame concern; it does not change `SimulationTick` or committed world state.
