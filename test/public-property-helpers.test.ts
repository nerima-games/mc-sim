import { Result, Schema, SchemaAST } from 'effect'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import * as PublicApi from '../src/index.js'
import { assertResultContract } from './public-property-helpers.js'

const TransferSuccessSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Transferred'),
    count: Schema.Int,
    item: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal('NoChange'),
    reason: Schema.String,
  }),
])

const TransferFailureSchema = Schema.Struct({
  _tag: Schema.Literal('TransferFailure'),
  reason: Schema.String,
})

const schemaFactoryExports = [
  'EntityRosterSchema',
  'EntitySchema',
  'makeCoreTickErrorSchema',
  'replicatedOwnerChangeSchema',
  'replicatedSnapshotSchema',
  'replicatedWorldDeltaSchema',
  'saveCoordinatorRequestSaveErrorSchema',
  'simulationSaveV3MigrationErrorSchema',
] as const

const schemasWithoutRequiredFields = [
  'AutoSaveDaemonSchema',
  'AutoSaveScheduleSchema',
  'BrandErrorSchema',
  'BrewingItemSlotSchema',
  'BrewingRecipeInputSchema',
  'BrewingRecipeOptionSchema',
  'CoreTickRunTickSuccessSchema',
  'CropServiceAdvanceByBoneMealSuccessSchema',
  'CropServiceAdvanceSuccessSchema',
  'CropServiceMatureYieldsSuccessSchema',
  'CropServiceNoFailureSchema',
  'CropServicePlantSuccessSchema',
  'CropServiceResetSuccessSchema',
  'CropServiceRestoreSuccessSchema',
  'CropTypeSchema',
  'DomainEventBusErrorSchema',
  'EntityHealthPointsSchema',
  'EntityRosterRepairCountSchema',
  'EntitySerialExhaustedSchema',
  'EntitySerialSchema',
  'EquipmentServiceNoFailureSchema',
  'EquipmentServiceResetSuccessSchema',
  'EquipmentServiceRestoreSuccessSchema',
  'EquipmentServiceSwapSuccessSchema',
  'EventSubscriberCapacitySchema',
  'FishingFailureSchema',
  'FishingInvalidLootRollSchema',
  'FishingInvalidStateSchema',
  'FishingRodPhaseSchema',
  'FishingServiceBiteSuccessSchema',
  'FishingServiceCastSuccessSchema',
  'IntentIdSchema',
  'IntentQueueCapacitySchema',
  'IntentQueueEnqueueFailureSchema',
  'IntentSequenceSchema',
  'InventoryAddLeftoverSchema',
  'InventoryCarriedSlotSchema',
  'InventoryCountSchema',
  'InventorySnapshotSchema',
  'ItemStackSchema',
  'LegacyItemStackSchema',
  'MatureYieldsSchema',
  'PitchRadiansSchema',
  'ProjectileServiceFailureSchema',
  'ReplicatedOwnerIdSchema',
  'SaveCoordinatorRequestSaveSuccessSchema',
  'SaveSimulationSuccessSchema',
  'SaveSnapshotConsistencyErrorSchema',
  'SchemaErrorSchema',
  'SimPhysicsStagesSchema',
  'SimulationSaveErrorSchema',
  'SimulationSaveV3MigrationSuccessSchema',
  'TntServiceFailureSchema',
  'VehicleServiceDespawnSuccessSchema',
  'VehicleServiceDismountSuccessSchema',
  'VehicleServiceMountSuccessSchema',
  'VehicleServiceNoFailureSchema',
  'VehicleServiceRestoreSuccessSchema',
  'VehicleServiceUpdateStateSuccessSchema',
  'VehicleServiceUpdateTransformSuccessSchema',
  'VehicleServiceUpdateVelocitySuccessSchema',
  'VehicleServiceVoidSuccessSchema',
  'WeatherSchema',
  'WorldCommitCoordinatorSnapshotErrorSchema',
  'WorldContainerIdSchema',
  'YawRadiansSchema',
] as const

const nullableRequiredFieldPaths = [
  'AchievementServiceErrorSchema|0|1|0.value',
  'AchievementUnlockStageErrorSchema|1|0.value',
  'AddStoredStackResultSchema|0.leftover',
  'AddStoredStackResultSchema|0.leftover|0.durability',
  'BrewingServiceErrorSchema|2|0.value',
  'ConsumeAndDamageAtResultSchema|4.actualItem',
  'ContainerExtractResultSchema|0.stack.durability',
  'ContainerStorageServiceErrorSchema|1|0.value',
  'ContainerStorageSnapshotSchema.containers[].slots[]|0.durability',
  'ContainerStoredStackSchema.durability',
  'CreateContainerResultSchema|0.container.slots[]|0.durability',
  'CreateContainerResultSchema|1.container.slots[]|0.durability',
  'DamageEquipmentResultSchema|2.item.durability',
  'DamageEquipmentResultSchema|4.item.durability',
  'DamageEquipmentResultSchema|5.item.durability',
  'EquipmentItemSchema.durability',
  'EquipmentSchema.slots.chest',
  'EquipmentSchema.slots.chest|0.durability',
  'EquipmentSchema.slots.feet',
  'EquipmentSchema.slots.feet|0.durability',
  'EquipmentSchema.slots.head',
  'EquipmentSchema.slots.head|0.durability',
  'EquipmentSchema.slots.legs',
  'EquipmentSchema.slots.legs|0.durability',
  'EquipmentSchema.slots.offhand',
  'EquipmentSchema.slots.offhand|0.durability',
  'EquipmentServiceDamageSuccessSchema|2.item.durability',
  'EquipmentServiceDamageSuccessSchema|4.item.durability',
  'EquipmentServiceDamageSuccessSchema|5.item.durability',
  'EquipmentServiceEquipSuccessSchema|0.durability',
  'EquipmentServiceSnapshotSuccessSchema.slots.chest',
  'EquipmentServiceSnapshotSuccessSchema.slots.chest|0.durability',
  'EquipmentServiceSnapshotSuccessSchema.slots.feet',
  'EquipmentServiceSnapshotSuccessSchema.slots.feet|0.durability',
  'EquipmentServiceSnapshotSuccessSchema.slots.head',
  'EquipmentServiceSnapshotSuccessSchema.slots.head|0.durability',
  'EquipmentServiceSnapshotSuccessSchema.slots.legs',
  'EquipmentServiceSnapshotSuccessSchema.slots.legs|0.durability',
  'EquipmentServiceSnapshotSuccessSchema.slots.offhand',
  'EquipmentServiceSnapshotSuccessSchema.slots.offhand|0.durability',
  'EquipmentServiceUnequipSuccessSchema|0.durability',
  'EquipmentSlotsSchema.chest',
  'EquipmentSlotsSchema.chest|0.durability',
  'EquipmentSlotsSchema.feet',
  'EquipmentSlotsSchema.feet|0.durability',
  'EquipmentSlotsSchema.head',
  'EquipmentSlotsSchema.head|0.durability',
  'EquipmentSlotsSchema.legs',
  'EquipmentSlotsSchema.legs|0.durability',
  'EquipmentSlotsSchema.offhand',
  'EquipmentSlotsSchema.offhand|0.durability',
  'FishingServiceErrorSchema|3|0.value',
  'FurnaceServiceErrorSchema|2|0.value',
  'PlayerStorageSnapshotSchema.equipment.slots.chest',
  'PlayerStorageSnapshotSchema.equipment.slots.chest|0.durability',
  'PlayerStorageSnapshotSchema.equipment.slots.feet',
  'PlayerStorageSnapshotSchema.equipment.slots.feet|0.durability',
  'PlayerStorageSnapshotSchema.equipment.slots.head',
  'PlayerStorageSnapshotSchema.equipment.slots.head|0.durability',
  'PlayerStorageSnapshotSchema.equipment.slots.legs',
  'PlayerStorageSnapshotSchema.equipment.slots.legs|0.durability',
  'PlayerStorageSnapshotSchema.equipment.slots.offhand',
  'PlayerStorageSnapshotSchema.equipment.slots.offhand|0.durability',
  'ProjectileServiceErrorSchema|2|0.value',
  'ProjectileServiceSnapshotErrorSchema|1|0.value',
  'ReplicatedOwnerChangeSchema.state',
  'TntServiceErrorSchema|2|0.value',
  'TntServiceSnapshotErrorSchema|1|0.value',
  'WorldCommitCoordinatorErrorSchema|0.value',
] as const

type DecodableSchema = Schema.Codec<unknown, unknown, never, never>

type MutationSegment =
  | { readonly kind: 'property'; readonly key: PropertyKey }
  | { readonly kind: 'arrayItem' }

type RequiredFieldCase = {
  readonly path: string
  readonly key: PropertyKey
  readonly rootSchema: DecodableSchema
  readonly inputPath: ReadonlyArray<MutationSegment>
  readonly objectSchema: DecodableSchema
}

const decodes = (schema: DecodableSchema, value: unknown): boolean => {
  try {
    Schema.decodeUnknownSync(schema)(value)
    return true
  } catch {
    return false
  }
}

const makeMutationInput = (
  path: ReadonlyArray<MutationSegment>,
  mutation: 'missing' | 'null',
): unknown => {
  let root: Record<PropertyKey, unknown> | Array<unknown> = path[0]?.kind === 'arrayItem' ? [] : {}
  let current: Record<PropertyKey, unknown> | Array<unknown> = root

  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index]
    if (segment === undefined) throw new Error('Missing schema path segment')
    if (segment.kind === 'arrayItem') {
      if (!Array.isArray(current)) throw new Error('Schema array item has no array parent')
      const item: Record<PropertyKey, unknown> = {}
      current.push(item)
      current = item
      continue
    }

    if (Array.isArray(current)) throw new Error('Schema property has no object parent')
    const isTarget = index === path.length - 1
    if (isTarget) {
      if (mutation === 'null') current[segment.key] = null
      continue
    }

    const nextSegment = path[index + 1]
    const nested: Record<PropertyKey, unknown> | Array<unknown> = nextSegment?.kind === 'arrayItem' ? [] : {}
    current[segment.key] = nested
    current = nested
  }

  return root
}

const collectRequiredFieldCases = (): ReadonlyArray<RequiredFieldCase> => {
  const schemaSuffixExports = Object.entries(PublicApi)
    .filter(([name]) => name.endsWith('Schema'))
  const schemas = schemaSuffixExports
    .filter(([, value]) => Schema.isSchema(value))
    .map(([name, schema]) => ({ name, schema: schema as DecodableSchema }))
  const factories = schemaSuffixExports
    .filter(([, value]) => !Schema.isSchema(value))
    .map(([name]) => name)
    .sort()

  expect(factories).toStrictEqual([...schemaFactoryExports].sort())

  const cases: Array<RequiredFieldCase> = []
  const schemasWithRequiredFields = new Set<string>()

  const visit = (
    schemaName: string,
    rootSchema: DecodableSchema,
    ast: SchemaAST.AST,
    path: string,
    inputPath: ReadonlyArray<MutationSegment>,
    ancestors: ReadonlySet<SchemaAST.AST>,
  ): void => {
    const typeAst = SchemaAST.toType(ast)
    if (ancestors.has(typeAst)) return
    const nextAncestors = new Set(ancestors).add(typeAst)

    switch (typeAst._tag) {
      case 'Objects':
        for (const property of typeAst.propertySignatures) {
          const fieldPath = `${path}.${String(property.name)}`
          const propertyPath = [...inputPath, { kind: 'property' as const, key: property.name }]
          if (!SchemaAST.isOptional(property.type) && property.type.context?.constructorDefault === undefined) {
            const fieldSchema = Schema.make(property.type) as DecodableSchema
            cases.push({
              path: fieldPath,
              key: property.name,
              rootSchema,
              inputPath: propertyPath,
              objectSchema: Schema.Struct({ [property.name]: fieldSchema }) as DecodableSchema,
            })
            schemasWithRequiredFields.add(schemaName)
          }
          visit(schemaName, rootSchema, property.type, fieldPath, propertyPath, nextAncestors)
        }
        return
      case 'Union':
        typeAst.types.forEach((member, index) =>
          visit(schemaName, rootSchema, member, `${path}|${index}`, inputPath, nextAncestors))
        return
      case 'Arrays':
        ;[...typeAst.elements, ...typeAst.rest].forEach((member) =>
          visit(schemaName, rootSchema, member, `${path}[]`, [...inputPath, { kind: 'arrayItem' }], nextAncestors))
        return
      case 'Suspend':
        visit(schemaName, rootSchema, typeAst.thunk(), path, inputPath, nextAncestors)
        return
      case 'Declaration':
        typeAst.typeParameters.forEach((parameter, index) =>
          visit(schemaName, rootSchema, parameter, `${path}<${index}>`, inputPath, nextAncestors))
        return
      case 'Boolean':
      case 'Literal':
      case 'Never':
      case 'Null':
      case 'Number':
      case 'String':
      case 'Undefined':
      case 'Unknown':
        return
      default:
        throw new Error(`Unclassified Schema AST node in ${schemaName}: ${typeAst._tag}`)
    }
  }

  for (const { name, schema } of schemas) {
    visit(name, schema, schema.ast, name, [], new Set())
  }

  const schemasWithoutFields = schemas.map(({ name }) => name)
    .filter((name) => !schemasWithRequiredFields.has(name))
    .sort()
  expect(schemasWithoutFields).toStrictEqual([...schemasWithoutRequiredFields].sort())

  const nullablePaths = [...new Set(cases
    .filter(({ objectSchema, key }) => decodes(objectSchema, { [key]: null }))
    .map(({ path }) => path))].sort()
  expect(nullablePaths).toStrictEqual([...nullableRequiredFieldPaths].sort())

  const accountedSchemas = new Set([...schemasWithRequiredFields, ...schemasWithoutFields])
  expect([...accountedSchemas].sort()).toStrictEqual(schemas.map(({ name }) => name).sort())

  return cases
}

it('public barrel Schemas reject a missing required property', () => {
  const requiredFields = collectRequiredFieldCases()
  expect(requiredFields.length).toBeGreaterThan(0)

  fc.assert(
    fc.property(fc.constant(requiredFields), (fields) => {
      for (const { path, objectSchema, rootSchema, inputPath } of fields) {
        expect(decodes(objectSchema, {}), `${path} required member`).toBe(false)
        expect(decodes(rootSchema, makeMutationInput(inputPath, 'missing')), `${path} public Schema`).toBe(false)
      }
    }),
    { numRuns: 1 },
  )
})

it('public barrel Schemas reject null for required nonnullable properties', () => {
  const requiredFields = collectRequiredFieldCases()
  expect(requiredFields.length).toBeGreaterThan(0)

  fc.assert(
    fc.property(fc.constant(requiredFields), (fields) => {
      const nullablePaths = new Set<string>(nullableRequiredFieldPaths)
      for (const { path, key, objectSchema, rootSchema, inputPath } of fields) {
        expect(
          decodes(objectSchema, { [key]: null }),
          `${path} field Schema`,
        ).toBe(nullablePaths.has(path))
        expect(decodes(rootSchema, makeMutationInput(inputPath, 'null')), `${path} public Schema`).toBe(false)
      }
    }),
    { numRuns: 1 },
  )
})

it('accepts declared successes and failures only when their schemas match', () => {
  expect(() => assertResultContract(
    'transfer',
    () => Result.succeed({ _tag: 'Transferred', count: 2, item: 'stone' }),
    TransferSuccessSchema,
    TransferFailureSchema,
  )).not.toThrow()

  expect(() => assertResultContract(
    'transfer',
    () => Result.fail({ _tag: 'TransferFailure', reason: 'full' }),
    TransferSuccessSchema,
    TransferFailureSchema,
  )).not.toThrow()
})

it('rejects missing success fields, unknown error tags, and invalid branded values', () => {
  expect(() => assertResultContract(
    'transfer',
    () => Result.succeed({ _tag: 'Transferred' }),
    TransferSuccessSchema,
    TransferFailureSchema,
  )).toThrow()

  expect(() => assertResultContract(
    'transfer',
    () => Result.fail({ _tag: 'UnknownFailure' }),
    TransferSuccessSchema,
    TransferFailureSchema,
  )).toThrow()

  const BrandedCountSchema = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand('BrandedCount'))
  expect(() => assertResultContract(
    'branded count',
    () => Result.succeed(0),
    BrandedCountSchema,
    Schema.Never,
  )).toThrow()
})
