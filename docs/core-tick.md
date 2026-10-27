# Deterministic core state tick

`CoreTick` advances one logical `SimulationTick` without reading wall-clock time. `game-loop.ts` remains responsible for frame scheduling and fixed-step accumulation.

## Stage contract

`makeCoreTick` accepts four stage functions through `CoreTickOptions`. Their input and output types are `CoreTickStageInput` and `CoreTickStageCandidate` in `src/application/core.ts`.

Each stage receives:

- `tick`: the logical tick being attempted.
- `ready`: the merged ready-intent batch, ordered by target tick and admission sequence.
- `expectedRevision`: the coordinator revision read once before the stages run.
- `previous`: the completed stage records in stage order, including each prior candidate.

A stage returns candidate `changes`, `expectedDimensions`, and `events`, with an optional `value` for later stages. An optional `restore(delta)` callback receives the exact successful commit delta after replicated state commits. Stages should derive candidates from their input and committed snapshots; they must not mutate committed state or publish events before the commit.

Inside an `Effect.gen` program, an integration wires its dependencies and calls the returned API once for each ready simulation tick:

```ts
const core = yield* makeCoreTick({
  coordinator,
  publish,
  stages: {
    intentsAndRules: intentAndRulesStage,
    stations: stationsStage,
    environment: environmentStage,
    entities: entitiesStage,
  },
})

yield* core.runTick(nextTick, ready)
```

This is an illustrative wiring fragment. `HeadlessHarness` obtains `ready` with `takeReady(nextTick)` and passes it to the session's `runTick` for each fixed simulation step.

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

Stages return candidate state and events. They do not mutate committed state or publish events before the commit, so failures before commit are safe to retry.

## Failure and retry

If a stage or the commit fails before the commit succeeds, the runner does not publish events or advance the tick. It retains the intents taken for that tick. The caller retries by making another call for the same logical tick; the runner reruns the stages against the latest committed snapshots and current coordinator revision.

The coordinator commits all changed owners atomically. A tick with no owner changes skips the coordinator call, restore callbacks, and event publication.

After a successful commit, the runner calls candidate `restore` callbacks in stage order, publishes staged events in stage order, then advances the tick. These actions run in one uninterruptible section, and a backpressured event subscriber can delay completion. A failing `restore` callback occurs after replicated state has committed and does not roll it back; treat that as a post-commit failure rather than retrying as though the tick made no changes.

## Frame boundary

`game-loop.ts` converts elapsed frame time into fixed simulation steps and calls the core tick once per step. Rendering interpolation remains a frame concern; it does not change `SimulationTick` or committed world state.
