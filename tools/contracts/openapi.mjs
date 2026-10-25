import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v2 } from '../../packages/contracts/dist/index.js';
import { z } from 'zod';

/** Publish accepted JSON inputs through Zod's supported converter, not private
 * validator internals. Runtime refinements/normalization still run in the SDK
 * and API; JSON Schema alone is never a substitute for those checks.
 * Unrepresentable inputs throw by default instead of silently becoming {}. */
export function jsonSchema(schema) {
  const { $schema, ...output } = z.toJSONSchema(schema, { io: 'input', cycles: 'throw' });
  return { ...output, 'x-laundry-runtime-validation': true };
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
    if (route.requestSchema) {
      operation.requestBody = { required: true, content: { 'application/json': { schema: ref(route.requestSchema) } } };
      operation.responses['413'] = { description: 'Transport body limit exceeded (INVALID_INPUT); no command was executed.', content: { 'application/json': { schema: ref('ErrorEnvelope') } } };
    }
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
    if (route.method === 'GET' && responseSchema instanceof z.ZodObject && responseSchema.shape.pageInfo) {
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
