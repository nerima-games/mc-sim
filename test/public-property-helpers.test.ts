import { Arbitrary, Brand, Duration, Effect, Option, Result, Schedule, Schema, SchemaAST, SchemaIssue } from 'effect'
import { SaveDecodeError } from '@nerima-games/mc-save'
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
  'WorldCommitResultSchema',
  'WorldReadSnapshotSchema',
  'makeCoreTickErrorSchema',
  'replicatedOwnerChangeSchema',
  'replicatedSnapshotSchema',
  'replicatedWorldDeltaSchema',
  'saveCoordinatorRequestSaveErrorSchema',
  'simulationSaveV3MigrationErrorSchema',
] as const

type DecodableSchema = Schema.Codec<unknown, unknown, never, never>

type MutationSegment =
  | { readonly kind: 'property'; readonly key: PropertyKey }
  | { readonly kind: 'arrayItem'; readonly index: number }

type RequiredFieldCase = {
  readonly path: string
  readonly schemaName: string
  readonly rootSchema: DecodableSchema
  readonly sample: unknown
  readonly inputPath: ReadonlyArray<MutationSegment>
  readonly fieldSchema: DecodableSchema
}

type PublicSchema = {
  readonly name: string
  readonly schema: DecodableSchema
}

const MAX_CANDIDATES = 64
const MAX_ARBITRARY_SAMPLES = 48

const schemasWithoutValues = [
  'CropServiceNoFailureSchema',
  'EquipmentServiceNoFailureSchema',
  'VehicleServiceNoFailureSchema',
  'VitalsServiceNoErrorSchema',
] as const

// Effect Arbitrary currently cannot derive samples for these validated ASTs; their AST generator remains explicit.
const schemasUsingAstFallbackForArbitrary = [
  'DamageOutcomeSchema',
  'ExplosionPlanSchema',
  'FixedStepAdvanceSchema',
  'TimeStateSchema',
  'VitalsSchema',
  'VitalsViewSchema',
] as const

const construct = (constructor: unknown, fields: unknown): unknown =>
  Reflect.construct(constructor as Function, [fields])

const schemaError = new Schema.SchemaError(new SchemaIssue.InvalidType(Schema.Number.ast, null))
const brandError = new Brand.BrandError(new SchemaIssue.InvalidType(Schema.Number.ast, null))
const sampleItemStack = Result.getOrThrow(PublicApi.itemStack('stone', 1))

// Opaque declarations need explicit representatives, each checked by its exported root Schema below.
const opaqueSchemaInputProviders: Readonly<Record<string, () => unknown>> = {
  AchievementServiceErrorSchema: () => construct(PublicApi.AchievementCommitMismatch, {
    expectedWorld: 'world',
    actualWorld: 'world',
    expectedRevision: 0,
    actualRevision: 1,
    ownerId: 'owner',
    reason: 'revision',
  }),
  AutoSaveDaemonSchema: () => Effect.runFork(Effect.void),
  AutoSaveScheduleSchema: () => Schedule.spaced(Duration.millis(1)),
  BrandErrorSchema: () => brandError,
  BrewingRecipeInputSchema: () => PublicApi.VANILLA_BREWING_RECIPES[0],
  BrewingRecipeOptionSchema: () => undefined,
  ContainerStoredStackSchema: () => ({ ...sampleItemStack, durability: null }),
  DomainEventBusErrorSchema: () => schemaError,
  FishingFailureSchema: () => construct(PublicApi.FishingInvalidState, {
    actor: 'entity',
    operation: 'cast',
    reason: 'rod-not-active',
  }),
  FishingInvalidLootRollSchema: () => construct(PublicApi.FishingInvalidLootRoll, {
    reason: 'outside-unit-interval',
  }),
  FishingInvalidStateSchema: () => construct(PublicApi.FishingInvalidState, {
    actor: 'entity',
    operation: 'cast',
    reason: 'rod-not-active',
  }),
  IntentQueueEnqueueFailureSchema: () => construct(PublicApi.IntentQueueFull, { capacity: 1 }),
  InventorySnapshotSchema: () => PublicApi.emptyInventory(),
  ItemStackSchema: () => sampleItemStack,
  LegacyItemStackSchema: () => sampleItemStack,
  LoadSimulationSuccessSchema: () => Option.none(),
  PlayerStorageSnapshotSchema: () => PublicApi.emptyPlayerStorage(),
  ProjectileServiceFailureSchema: () => new PublicApi.ProjectileServiceFailure({ reason: 'invalid-launch' }),
  SaveSnapshotConsistencyErrorSchema: () => new PublicApi.SaveSnapshotConsistencyError({ attempts: 1 }),
  SchemaErrorSchema: () => schemaError,
  SimulationSaveErrorSchema: () => new SaveDecodeError({ format: 'sample', version: 3, reason: 'invalid save' }),
  SimPhysicsStagesSchema: () => [{ id: PublicApi.SIM_STAGE_IDS.physics, run: () => Effect.void }],
  TntServiceFailureSchema: () => new PublicApi.TntServiceFailure({ reason: 'invalid-input' }),
  WorldCommitCoordinatorErrorSchema: () => construct(PublicApi.WorldRevisionConflict, {
    expected: 0,
    actual: 1,
  }),
  WitherStepFailureSchema: () => brandError,
}

const opaqueDeclarationCandidates: ReadonlyArray<unknown> = [
  brandError,
  schemaError,
  undefined,
  null,
  false,
  true,
  0,
  1,
  -1,
  0.5,
  Number.MAX_SAFE_INTEGER,
  '',
  'a',
  'stone',
  'minecraft:stone',
  'minecraft:air',
  'minecraft:stick',
  'minecraft:book',
  [],
  [undefined],
  {},
  sampleItemStack,
  sampleItemStack.components,
  { ...sampleItemStack, durability: null },
  { ...sampleItemStack, durability: { current: 1, max: 1 } },
  { item: 'stone', count: 1, components: null },
  { item: 'minecraft:stone', count: 1, components: {} },
  { id: 'sample', input: 'stone', ingredient: 'stone', output: 'stone' },
  { id: 'sample', input: 'stone', ingredient: 'stone', result: 'stone' },
  { slots: Array.from({ length: 36 }, () => undefined), selected: 0 },
  { slots: Array.from({ length: 36 }, () => undefined), selectedSlot: 0 },
  ...Object.values(opaqueSchemaInputProviders).map((provider) => provider()),
]

const decodes = (schema: DecodableSchema, value: unknown): boolean => {
  try {
    Schema.decodeUnknownSync(schema)(value)
    return true
  } catch {
    return false
  }
}

const astTag = (ast: unknown): string => String((ast as { readonly _tag?: unknown })._tag)

type ObjectsAst = Extract<SchemaAST.AST, { readonly _tag: 'Objects' }>
type ArraysAst = Extract<SchemaAST.AST, { readonly _tag: 'Arrays' }>
type CandidateGenerator = (ast: SchemaAST.AST, ancestors?: ReadonlySet<SchemaAST.AST>) => ReadonlyArray<unknown>

const filterCandidateValues = (ast: SchemaAST.AST, values: ReadonlyArray<unknown>): ReadonlyArray<unknown> => {
  const schema = Schema.make(ast) as DecodableSchema
  const unique: Array<unknown> = []
  for (const value of values) {
    if (!decodes(schema, value)) continue
    if (!unique.some((previous) => Object.is(previous, value))) unique.push(value)
    if (unique.length === MAX_CANDIDATES) break
  }
  return unique
}

const candidateObjectValues = (
  typeAst: ObjectsAst,
  ast: SchemaAST.AST,
  ancestors: ReadonlySet<SchemaAST.AST>,
  candidate: CandidateGenerator,
): ReadonlyArray<unknown> => {
  const properties = typeAst.propertySignatures.map((property) => ({
    property,
    optional: SchemaAST.isOptional(property.type) || property.type.context?.constructorDefault !== undefined,
    values: candidate(property.type, ancestors),
  }))
  if (properties.some(({ optional, values }) => !optional && values.length === 0)) return []

  const rows: Array<Record<PropertyKey, unknown>> = []
  for (let trial = 0; trial < MAX_CANDIDATES * 4; trial += 1) {
    const row: Record<PropertyKey, unknown> = {}
    let hasRequiredValues = true
    properties.forEach(({ property, optional, values }, propertyIndex) => {
      if (values.length === 0) return
      const propertySeed = [...String(property.name)].reduce(
        (seed, character) => Math.imul(seed ^ character.charCodeAt(0), 16777619),
        2166136261,
      )
      const choiceSeed = (Math.imul(trial + 1, 1103515245) + propertySeed + propertyIndex * 12345) >>> 0
      const choiceIndex = trial < MAX_CANDIDATES ? trial % values.length : choiceSeed % values.length
      if (optional && trial >= MAX_CANDIDATES && choiceSeed % 7 === 0) return
      const value = values[choiceIndex]
      if (value === undefined && !values.includes(undefined)) {
        hasRequiredValues = false
        return
      }
      row[property.name] = value
    })
    if (hasRequiredValues) rows.push(row)
  }
  return filterCandidateValues(ast, rows)
}

const candidateArrayValues = (
  typeAst: ArraysAst,
  ast: SchemaAST.AST,
  ancestors: ReadonlySet<SchemaAST.AST>,
  candidate: CandidateGenerator,
): ReadonlyArray<unknown> => {
  const fixedCandidates = typeAst.elements.map((element) => candidate(element, ancestors))
  const fixed = fixedCandidates.map((candidates) => candidates[0])
  const values: Array<unknown> = []
  if (fixedCandidates.every((candidates) => candidates.length > 0)) values.push(fixed)
  values.push([])
  const rest = typeAst.rest.flatMap((element) => candidate(element, ancestors))
  for (const value of rest.slice(0, 4)) values.push([...fixed, value])
  return filterCandidateValues(ast, values)
}

const candidateLeafValues = (
  typeAst: SchemaAST.AST,
  ast: SchemaAST.AST,
  ancestors: ReadonlySet<SchemaAST.AST>,
  candidate: CandidateGenerator,
): ReadonlyArray<unknown> => {
  const filter = (values: ReadonlyArray<unknown>) => filterCandidateValues(ast, values)
  switch (typeAst._tag) {
    case 'Declaration':
      return filter([
        ...typeAst.typeParameters.flatMap((parameter) => candidate(parameter, ancestors)),
        ...opaqueDeclarationCandidates,
      ])
    case 'Enum':
      return filter(typeAst.enums.map(([, value]) => value))
    case 'TemplateLiteral':
      return filter(['a', 'minecraft:stone', '0'])
    case 'Boolean':
      return filter([false, true])
    case 'Literal':
      return filter([typeAst.literal])
    case 'Number':
      return filter([
        0,
        1,
        -1,
        2,
        0.5,
        64,
        20,
        100,
        6_000,
        12_000,
        24_000,
        100_000,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
      ])
    case 'String':
      return filter(['', 'a', 'stone', 'minecraft:stone', 'minecraft:air', 'minecraft:stick', 'minecraft:book'])
    case 'BigInt':
      return filter([0n, 1n, -1n])
    case 'Symbol':
      return filter([Symbol.for('public-schema-sample')])
    case 'UniqueSymbol':
      return filter([typeAst.symbol])
    case 'Null':
      return [null]
    case 'Undefined':
    case 'Void':
      return filter([undefined, null, false, 0, ''])
    case 'Never':
      return []
    case 'Unknown':
    case 'Any':
      return [undefined, null, false, 0, '', {}, []]
    case 'ObjectKeyword':
      return filter([{}, [], new Date(0)])
    default:
      throw new Error(`Unclassified Schema AST node: ${astTag(typeAst)}`)
  }
}

const candidateValues: CandidateGenerator = (
  ast: SchemaAST.AST,
  ancestors: ReadonlySet<SchemaAST.AST> = new Set(),
): ReadonlyArray<unknown> => {
  const typeAst = SchemaAST.toType(ast)
  if (ancestors.has(typeAst)) return []
  const nextAncestors = new Set(ancestors).add(typeAst)
  if (typeAst._tag === 'Objects') return candidateObjectValues(typeAst, ast, nextAncestors, candidateValues)
  if (typeAst._tag === 'Union') {
    return filterCandidateValues(ast, typeAst.types.flatMap((member) => candidateValues(member, nextAncestors)))
  }
  if (typeAst._tag === 'Arrays') return candidateArrayValues(typeAst, ast, nextAncestors, candidateValues)
  if (typeAst._tag === 'Suspend') return candidateValues(typeAst.thunk(), nextAncestors)
  return candidateLeafValues(typeAst, ast, nextAncestors, candidateValues)
}

const publicSchemas = (): ReadonlyArray<PublicSchema> => {
  const schemaSuffixExports = Object.entries(PublicApi).filter(([name]) => name.endsWith('Schema'))
  const schemas = schemaSuffixExports
    .filter(([, value]) => Schema.isSchema(value))
    .map(([name, schema]) => ({ name, schema: schema as DecodableSchema }))
  const factories = schemaSuffixExports
    .filter(([, value]) => !Schema.isSchema(value))
    .map(([name]) => name)
    .sort()

  expect(factories).toStrictEqual([...schemaFactoryExports].sort())
  for (const { name, schema } of schemas) {
    if (SchemaAST.toType(schema.ast)._tag === 'Declaration') {
      expect(opaqueSchemaInputProviders[name], `${name} opaque public Schema has an explicit sample provider`).toBeDefined()
    }
  }
  for (const name of schemasWithoutValues) {
    const schema = schemas.find((candidate) => candidate.name === name)?.schema
    expect(schema, `${name} classified as an uninhabited public Schema`).toBeDefined()
    expect(SchemaAST.toType(schema!.ast)._tag, `${name} is uninhabited`).toBe('Never')
  }
  expect(schemas.length).toBeGreaterThan(0)
  return schemas
}

const knownLeafAstTags: ReadonlySet<string> = new Set([
  'Boolean',
  'Declaration',
  'Enum',
  'Literal',
  'Never',
  'Null',
  'Number',
  'String',
  'Undefined',
  'Void',
  'Unknown',
  'Any',
  'BigInt',
  'Symbol',
  'UniqueSymbol',
  'ObjectKeyword',
  'TemplateLiteral',
])

const declarationChildren = (typeAst: SchemaAST.AST): ReadonlyArray<SchemaAST.AST> => {
  switch (typeAst._tag) {
    case 'Objects':
      return [
        ...typeAst.propertySignatures.map((property) => property.type),
        ...typeAst.indexSignatures.map((signature) => signature.type),
      ]
    case 'Union':
      return typeAst.types
    case 'Arrays':
      return [...typeAst.elements, ...typeAst.rest]
    case 'Suspend':
      return [typeAst.thunk()]
    default:
      if (knownLeafAstTags.has(typeAst._tag)) return []
      throw new Error(`Unclassified Schema AST node while finding declarations: ${astTag(typeAst)}`)
  }
}

const containsDeclaration = (ast: SchemaAST.AST, ancestors: ReadonlySet<SchemaAST.AST> = new Set()): boolean => {
  const typeAst = SchemaAST.toType(ast)
  if (typeAst._tag === 'Declaration') return true
  if (ancestors.has(typeAst)) return false
  const nextAncestors = new Set(ancestors).add(typeAst)
  return declarationChildren(typeAst).some((child) => containsDeclaration(child, nextAncestors))
}

const arbitrarySamples = (schema: DecodableSchema): ReadonlyArray<unknown> => {
  const arbitrary = Arbitrary.schema(schema, { shrink: () => [] })
  return Effect.runSync(Arbitrary.sampleEffect(arbitrary, {
    count: MAX_ARBITRARY_SAMPLES,
    size: 12,
    seed: 0x51c0,
  }))
}

const rootSamples = (name: string, schema: DecodableSchema): ReadonlyArray<unknown> => {
  const typeAst = SchemaAST.toType(schema.ast)
  if (typeAst._tag === 'Never') {
    expect(schemasWithoutValues, `${name} has no generated value because its Schema is Never`).toContain(name)
    return []
  }
  expect(schemasWithoutValues, `${name} is not unexpectedly uninhabited`).not.toContain(name)

  const provider = opaqueSchemaInputProviders[name]
  const candidates: Array<unknown> = provider === undefined ? [] : [provider()]
  try {
    candidates.push(...arbitrarySamples(schema))
  } catch (error) {
    const isOpaqueDeclarationFailure = error instanceof Error &&
      /unsupported Declaration|finite generation path/.test(error.message)
    const isClassifiedAstFallback = schemasUsingAstFallbackForArbitrary.includes(
      name as typeof schemasUsingAstFallbackForArbitrary[number],
    )
    if (!isOpaqueDeclarationFailure && !isClassifiedAstFallback) throw error
    if (isOpaqueDeclarationFailure && !containsDeclaration(schema.ast)) {
      throw new Error(`${name} Arbitrary reported an opaque Declaration absent from its public Schema AST`, { cause: error })
    }
    if (isClassifiedAstFallback) {
      expect(schemasUsingAstFallbackForArbitrary, `${name} has an explicit AST generator fallback`).toContain(name)
    }
  }
  candidates.push(...candidateValues(schema.ast))
  const valid: Array<unknown> = []
  for (const candidate of candidates) {
    if (!decodes(schema, candidate)) continue
    if (!valid.some((previous) => Object.is(previous, candidate))) valid.push(candidate)
    if (valid.length === MAX_CANDIDATES) break
  }
  if (provider !== undefined && !valid.some((value) => Object.is(value, candidates[0]))) {
    throw new Error(`${name} opaque sample provider returned a value rejected by its public Schema`)
  }
  if (valid.length === 0) {
    throw new Error(`${name} has no valid generated sample; candidates=${candidates.length}:${candidates.slice(0, 8).map(String).join('|')}`)
  }
  return valid
}

type RequiredFieldTraversal = {
  readonly schemaName: string
  readonly rootSchema: DecodableSchema
  readonly rootSample: unknown
  readonly path: string
  readonly inputPath: ReadonlyArray<MutationSegment>
  readonly ancestors: ReadonlySet<SchemaAST.AST>
  readonly cases: Array<RequiredFieldCase>
}

type RequiredFieldCollector = (
  schemaName: string,
  rootSchema: DecodableSchema,
  rootSample: unknown,
  ast: SchemaAST.AST,
  value: unknown,
  path: string,
  inputPath: ReadonlyArray<MutationSegment>,
  ancestors: ReadonlySet<SchemaAST.AST>,
  cases: Array<RequiredFieldCase>,
) => void

const collectObjectRequiredFields = (
  typeAst: ObjectsAst,
  value: unknown,
  context: RequiredFieldTraversal,
  collect: RequiredFieldCollector,
): void => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
  for (const property of typeAst.propertySignatures) {
    if (!Object.prototype.hasOwnProperty.call(value, property.name)) continue
    const fieldValue = Reflect.get(value, property.name)
    const fieldPath = `${context.path}.${String(property.name)}`
    const propertyPath = [...context.inputPath, { kind: 'property' as const, key: property.name }]
    if (!SchemaAST.isOptional(property.type) && property.type.context?.constructorDefault === undefined) {
      context.cases.push({
        path: fieldPath,
        schemaName: context.schemaName,
        rootSchema: context.rootSchema,
        sample: context.rootSample,
        inputPath: propertyPath,
        fieldSchema: Schema.make(property.type) as DecodableSchema,
      })
    }
    collect(
      context.schemaName,
      context.rootSchema,
      context.rootSample,
      property.type,
      fieldValue,
      fieldPath,
      propertyPath,
      context.ancestors,
      context.cases,
    )
  }
}

const collectUnionRequiredFields = (
  typeAst: Extract<SchemaAST.AST, { readonly _tag: 'Union' }>,
  value: unknown,
  context: RequiredFieldTraversal,
  collect: RequiredFieldCollector,
): void => {
  typeAst.types.forEach((member, index) => {
    if (!decodes(Schema.make(member) as DecodableSchema, value)) return
    collect(
      context.schemaName,
      context.rootSchema,
      context.rootSample,
      member,
      value,
      `${context.path}|${index}`,
      context.inputPath,
      context.ancestors,
      context.cases,
    )
  })
}

const collectArrayRequiredFields = (
  typeAst: ArraysAst,
  value: unknown,
  context: RequiredFieldTraversal,
  collect: RequiredFieldCollector,
): void => {
  if (!Array.isArray(value)) return
  value.forEach((item, index) => {
    const member = typeAst.elements[index] ?? typeAst.rest.find((restType) =>
      decodes(Schema.make(restType) as DecodableSchema, item))
    if (member === undefined) return
    collect(
      context.schemaName,
      context.rootSchema,
      context.rootSample,
      member,
      item,
      `${context.path}[${index}]`,
      [...context.inputPath, { kind: 'arrayItem' as const, index }],
      context.ancestors,
      context.cases,
    )
  })
}

const collectRequiredFields: RequiredFieldCollector = (
  schemaName,
  rootSchema,
  rootSample,
  ast,
  value,
  path,
  inputPath,
  ancestors,
  cases,
) => {
  const typeAst = SchemaAST.toType(ast)
  if (ancestors.has(typeAst)) return
  const context: RequiredFieldTraversal = {
    schemaName,
    rootSchema,
    rootSample,
    path,
    inputPath,
    ancestors: new Set(ancestors).add(typeAst),
    cases,
  }

  switch (typeAst._tag) {
    case 'Objects':
      collectObjectRequiredFields(typeAst, value, context, collectRequiredFields)
      return
    case 'Union':
      collectUnionRequiredFields(typeAst, value, context, collectRequiredFields)
      return
    case 'Arrays':
      collectArrayRequiredFields(typeAst, value, context, collectRequiredFields)
      return
    case 'Suspend':
      collectRequiredFields(schemaName, rootSchema, rootSample, typeAst.thunk(), value, path, inputPath, context.ancestors, cases)
      return
    default:
      if (knownLeafAstTags.has(typeAst._tag)) return
      throw new Error(`Unclassified Schema AST node in ${schemaName}: ${astTag(typeAst)}`)
  }
}

const cloneSample = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneSample)
  if (typeof value === 'object' && value !== null) {
    const prototype = Object.getPrototypeOf(value)
    if (
      prototype === Date.prototype ||
      prototype === Map.prototype ||
      prototype === Set.prototype ||
      prototype === WeakMap.prototype ||
      prototype === WeakSet.prototype ||
      prototype === Promise.prototype
    ) return value
    const clone = Object.create(prototype) as Record<PropertyKey, unknown>
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined) continue
      if ('value' in descriptor) descriptor.value = cloneSample(descriptor.value)
      descriptor.configurable = true
      if ('writable' in descriptor) descriptor.writable = true
      Object.defineProperty(clone, key, descriptor)
    }
    return clone
  }
  return value
}

const mutateSample = (
  sample: unknown,
  path: ReadonlyArray<MutationSegment>,
  mutation: 'missing' | 'null',
): unknown => {
  const root = cloneSample(sample)
  let current = root
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index]
    if (segment === undefined) throw new Error('Missing mutation path segment')
    const isTarget = index === path.length - 1
    if (segment.kind === 'property') {
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        throw new Error('Mutation property path does not resolve inside the valid sample')
      }
      if (isTarget) {
        if (mutation === 'missing') Reflect.deleteProperty(current, segment.key)
        else Reflect.set(current, segment.key, null)
      } else {
        current = Reflect.get(current, segment.key)
      }
    } else {
      if (!Array.isArray(current) || segment.index >= current.length) {
        throw new Error('Mutation array path does not resolve inside the valid sample')
      }
      if (isTarget) {
        if (mutation === 'missing') current.splice(segment.index, 1)
        else current[segment.index] = null
      } else {
        current = current[segment.index]
      }
    }
  }
  return root
}

let generatedCasesCache: ReadonlyArray<RequiredFieldCase> | undefined

const generatedCases = (): ReadonlyArray<RequiredFieldCase> => {
  if (generatedCasesCache !== undefined) return generatedCasesCache
  const allCases: Array<RequiredFieldCase> = []
  const usedProviders = new Set<string>()
  for (const { name, schema } of publicSchemas()) {
    const samples = rootSamples(name, schema)
    if (opaqueSchemaInputProviders[name] !== undefined) usedProviders.add(name)
    for (const sample of samples) {
      expect(decodes(schema, sample), `${name} valid sample`).toBe(true)
      collectRequiredFields(name, schema, sample, schema.ast, sample, name, [], new Set(), allCases)
    }
  }
  expect([...usedProviders].sort()).toStrictEqual(Object.keys(opaqueSchemaInputProviders).sort())
  generatedCasesCache = allCases
  return generatedCasesCache
}

const valueAtPath = (root: unknown, path: ReadonlyArray<MutationSegment>): unknown => {
  let current = root
  for (const segment of path) {
    if (segment.kind === 'property') {
      if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
      current = Reflect.get(current, segment.key)
    } else {
      if (!Array.isArray(current)) return undefined
      current = current[segment.index]
    }
  }
  return current
}

const mutationCandidatesBySchema = (mutation: 'missing' | 'null'): ReadonlyMap<string, RequiredFieldCase> => {
  const cases = generatedCases()
  const selected = new Map<string, RequiredFieldCase>()
  const requiredNames = [...new Set(cases.map((field) => field.schemaName))].sort()
  const noNullTargetNames = new Set<string>()

  for (const schemaName of requiredNames) {
    const schemaCases = cases.filter((field) => field.schemaName === schemaName)
    const eligibleCases = mutation === 'missing'
      ? schemaCases
      : schemaCases.filter((field) =>
        valueAtPath(field.sample, field.inputPath) !== null && !decodes(field.fieldSchema, null))

    if (eligibleCases.length === 0) {
      noNullTargetNames.add(schemaName)
      continue
    }

    for (const field of eligibleCases) {
      expect(decodes(field.rootSchema, field.sample), `${schemaName} original sample before ${mutation}`).toBe(true)
      if (!decodes(field.rootSchema, mutateSample(field.sample, field.inputPath, mutation))) {
        selected.set(schemaName, field)
        break
      }
    }
    if (!selected.has(schemaName)) {
      throw new Error(`${schemaName} has eligible required fields but no ${mutation} mutation was rejected`)
    }
  }

  if (mutation === 'missing') {
    expect([...selected.keys()].sort(), 'every Schema with required object fields has an omission case')
      .toStrictEqual(requiredNames)
  } else {
    expect([...selected.keys()].sort(), 'every Schema with a required non-null field has a null case')
      .toStrictEqual(requiredNames.filter((name) => !noNullTargetNames.has(name)))
    expect([...selected.keys(), ...noNullTargetNames].sort(), 'null-target and nullable-only classifications cover required Schemas')
      .toStrictEqual(requiredNames)
  }
  expect(selected.size).toBeGreaterThan(0)
  return selected
}

it('public barrel Schemas reject an omitted required property from a valid sample', () => {
  const selected = mutationCandidatesBySchema('missing')

  for (const field of selected.values()) {
    expect(decodes(field.rootSchema, field.sample), `${field.schemaName} original sample`).toBe(true)
    expect(
      decodes(field.rootSchema, mutateSample(field.sample, field.inputPath, 'missing')),
      `${field.path} missing required field`,
    ).toBe(false)
  }
})

it('public barrel Schemas reject null for a required non-null field from a valid sample', () => {
  const selected = mutationCandidatesBySchema('null')

  for (const field of selected.values()) {
    expect(decodes(field.rootSchema, field.sample), `${field.schemaName} original sample`).toBe(true)
    expect(
      decodes(field.rootSchema, mutateSample(field.sample, field.inputPath, 'null')),
      `${field.path} non-null required field`,
    ).toBe(false)
  }
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

  expect(() => assertResultContract(
    'transfer',
    () => Result.succeed({ _tag: 'Transferred', count: 2, item: 'stone', unexpected: true }),
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
