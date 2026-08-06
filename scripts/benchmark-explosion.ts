import { performance } from 'node:perf_hooks'
import { planExplosion, type ExplosionBlockReader } from '../src/domain/explosion'
import { position } from '@nerima-games/mc-kernel'

const radii = [4, 8, 16] as const
const iterations = 9
const warmups = 3
const blocks: ExplosionBlockReader = () => ({ resistance: 0, destructible: true })

for (const radius of radii) {
  const request = {
    center: position(0, 0, 0),
    radius,
    seed: 7,
    blocks,
    entities: [],
  }
  for (let index = 0; index < warmups; index += 1) planExplosion(request)

  const samples: number[] = []
  let visitedBlocks = 0
  let destroyedBlocks = 0
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now()
    const plan = planExplosion(request)
    samples.push(performance.now() - startedAt)
    visitedBlocks = plan.visitedBlocks
    destroyedBlocks = plan.destroyedBlocks.length
  }
  samples.sort((left, right) => left - right)
  console.log(JSON.stringify({
    radius,
    medianMs: samples[Math.floor(samples.length / 2)],
    minMs: samples[0],
    maxMs: samples.at(-1),
    visitedBlocks,
    destroyedBlocks,
  }))
}
