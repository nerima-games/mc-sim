import { Schema } from 'effect'

export const SchemaErrorSchema: Schema.Schema<Schema.SchemaError> = Schema.instanceOf(Schema.SchemaError)
