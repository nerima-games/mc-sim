import { Schema } from 'effect'

export const SchemaErrorSchema: Schema.Codec<Schema.SchemaError, unknown> = Schema.instanceOf(Schema.SchemaError)
