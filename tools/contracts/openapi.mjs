import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v2 } from '../../packages/contracts/dist/index.js';

/** Convert only the Zod constructs actually published by Laundry. Unknown
 * constructs fail the build rather than becoming permissive object schemas.
 * Cross-field refinements and UTC normalization remain executable in Zod. */
export function jsonSchema(schema) {
  const def = schema._def;
  let output;
  switch (def.typeName) {
    case 'ZodString': {
      output = { type: 'string' };
      for (const check of def.checks) {
        if (check.kind === 'min') output.minLength = check.value;
        else if (check.kind === 'max') output.maxLength = check.value;
        else if (check.kind === 'uuid') output.format = 'uuid';
        else if (check.kind === 'url') output.format = 'uri';
        else if (check.kind === 'email') output.format = 'email';
        else if (check.kind === 'regex') output.pattern = check.regex.source;
        else if (check.kind === 'trim') output['x-laundry-trim'] = true;
        else throw new Error(`Unmapped string check ${check.kind}`);
      }
      break;
    }
    case 'ZodNumber': {
      output = { type: 'number' };
      for (const check of def.checks) {
        if (check.kind === 'int') output.type = 'integer';
        else if (check.kind === 'min') output[check.inclusive ? 'minimum' : 'exclusiveMinimum'] = check.value;
        else if (check.kind === 'max') output[check.inclusive ? 'maximum' : 'exclusiveMaximum'] = check.value;
        else if (check.kind === 'finite') output['x-laundry-finite'] = true;
        else throw new Error(`Unmapped number check ${check.kind}`);
      }
      break;
    }
    case 'ZodBoolean': output = { type: 'boolean' }; break;
    case 'ZodLiteral': output = { const: def.value, type: typeof def.value }; break;
    case 'ZodEnum': output = { type: 'string', enum: def.values }; break;
    case 'ZodNull': output = { type: 'null' }; break;
    case 'ZodUnknown': output = {}; break;
    case 'ZodArray':
      output = { type: 'array', items: jsonSchema(def.type) };
      if (def.minLength) output.minItems = def.minLength.value;
      if (def.maxLength) output.maxItems = def.maxLength.value;
      break;
    case 'ZodRecord': output = { type: 'object', additionalProperties: jsonSchema(def.valueType) }; break;
    case 'ZodObject': {
      const shape = def.shape();
      output = { type: 'object', properties: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, jsonSchema(value)])) };
      const required = Object.entries(shape).filter(([, value]) => !value.isOptional()).map(([key]) => key);
      if (required.length) output.required = required;
      output.additionalProperties = def.unknownKeys === 'passthrough';
      break;
    }
    case 'ZodOptional': output = jsonSchema(def.innerType); break;
    case 'ZodNullable': output = { anyOf: [jsonSchema(def.innerType), { type: 'null' }] }; break;
    case 'ZodDefault': output = { ...jsonSchema(def.innerType), default: def.defaultValue() }; break;
    case 'ZodUnion': output = { anyOf: def.options.map(jsonSchema) }; break;
    case 'ZodDiscriminatedUnion': output = { oneOf: def.options.map(jsonSchema), discriminator: { propertyName: def.discriminator } }; break;
    case 'ZodEffects': output = { ...jsonSchema(def.schema), 'x-laundry-runtime-validation': true }; break;
    default: throw new Error(`Unmapped Zod schema ${def.typeName}`);
  }
  if (schema.description) output.description = schema.description;
  return output;
}

export function buildOpenApi() {
  const ref = name => ({ $ref: `#/components/schemas/${name}` });
  const schemas = Object.fromEntries(Object.entries(v2.WIRE_SCHEMAS).map(([name, schema]) => [name, jsonSchema(schema)]));
  schemas.DomainEvent = jsonSchema(v2.domainEventSchema);
  const paths = {};
  for (const route of v2.ROUTE_REGISTRY) {
    const operation = {
      operationId: route.id,
      summary: route.summary,
      tags: [route.ownerTask],
      security: route.authentication === 'PUBLIC' ? [] : route.authentication === 'PROVIDER_SIGNATURE' ? [{ providerSignature: [] }] : [{ bearerSession: [] }],
      parameters: [...route.path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: name === 'provider' ? { type: 'string', minLength: 1 } : name === 'postalCode' ? { type: 'string', pattern: '^\\d{6}$' } : { type: 'string', format: 'uuid' } })),
      responses: {
        '200': { description: 'Contract-valid result. The runtime validates cross-field invariants and normalizes instants to UTC.', content: { 'application/json': { schema: ref(route.responseSchema) } } },
      },
      'x-laundry-roles': route.roles,
      'x-laundry-idempotency': route.idempotency,
      'x-laundry-owner': route.ownerTask,
      'x-laundry-backend-acceptance': 'NOT_VERIFIED',
    };
    if (route.idempotency === 'REQUIRED') operation.parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 1, maxLength: 200 }, description: 'Persist with original intent. Same actor/key/payload replays; changed intent conflicts.' });
    if (route.requestSchema) operation.requestBody = { required: true, content: { 'application/json': { schema: ref(route.requestSchema) } } };
    const codes = new Set([...route.errorCodes, 'INVALID_INPUT', ...(route.authentication === 'SESSION' ? ['UNAUTHENTICATED', 'NOT_FOUND'] : []), ...(route.idempotency === 'REQUIRED' ? ['IDEMPOTENCY_CONFLICT'] : [])]);
    for (const code of codes) {
      const status = String(v2.errorHttpStatus[code]);
      if (!operation.responses[status]) operation.responses[status] = { description: '', content: { 'application/json': { schema: ref('ErrorEnvelope') } } };
      operation.responses[status].description += `${code}. `;
    }
    if (route.id === 'availability.slots') {
      operation.parameters.push(
        { name: 'areaId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        ...['from', 'to'].map(name => ({ name, in: 'query', required: true, schema: { type: 'string', format: 'date-time' } })),
        { name: 'serviceIds', in: 'query', required: true, style: 'form', explode: false, schema: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', format: 'uuid' } } },
        { name: 'requestedReturnBy', in: 'query', required: false, schema: { type: 'string', format: 'date-time' } },
      );
    }
    const responseSchema = v2.getWireSchema(route.responseSchema);
    if (route.method === 'GET' && responseSchema._def.typeName === 'ZodObject' && responseSchema.shape.pageInfo) {
      operation.parameters.push(
        { name: 'cursor', in: 'query', required: false, schema: { type: 'string', minLength: 1 } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
      );
    }
    paths[route.path] ??= {};
    paths[route.path][route.method.toLowerCase()] = operation;
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Laundry v2 contract candidate', version: 'laundry-wire-v2.0.0-candidate', description: 'Not frozen. Generated from executable Zod schemas and registry. Does not assert route implementation, provider integration or production acceptance. Cross-field refinements marked x-laundry-runtime-validation are enforced by the shared contracts package.' },
    servers: [{ url: 'http://localhost:4100', description: 'Explicit local development only' }],
    paths,
    components: { schemas, securitySchemes: { bearerSession: { type: 'http', scheme: 'bearer' }, providerSignature: { type: 'apiKey', in: 'header', name: 'X-Provider-Signature', description: 'Adapter-specific raw-body signature verification. This is not a universal vendor header; configured provider adapters define their exact headers and verification rules. No client idempotency key.' } } },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dest = new URL('../../packages/contracts/openapi-v2.json', import.meta.url);
  const content = JSON.stringify(buildOpenApi(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (await readFile(dest, 'utf8') !== content) throw new Error('OpenAPI is stale. Build contracts then run node tools/contracts/openapi.mjs');
    console.log('OpenAPI matches the executable registry.');
  } else {
    await writeFile(dest, content);
    console.log(`Wrote ${Object.keys(buildOpenApi().paths).length} paths.`);
  }
}
