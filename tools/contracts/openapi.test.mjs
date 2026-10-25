import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenApi, jsonSchema } from './openapi.mjs';
import { v2 } from '../../packages/contracts/dist/index.js';
import { z } from 'zod';

test('OpenAPI binds every registry request and success response without inline permissive fallbacks', () => {
  const doc = buildOpenApi();
  for (const route of v2.ROUTE_REGISTRY) {
    const operation = doc.paths[route.path][route.method.toLowerCase()];
    assert.equal(operation.operationId, route.id);
    assert.equal(operation.responses['200'].content['application/json'].schema.$ref, `#/components/schemas/${route.responseSchema}`);
    if (route.requestSchema) assert.equal(operation.requestBody.content['application/json'].schema.$ref, `#/components/schemas/${route.requestSchema}`);
  }
});

test('provider callbacks never advertise a bearer admin token or client idempotency key', () => {
  const doc = buildOpenApi();
  for (const route of v2.ROUTE_REGISTRY.filter(r => r.authentication === 'PROVIDER_SIGNATURE')) {
    const operation = doc.paths[route.path].post;
    assert.deepEqual(operation.security, [{ providerSignature: [] }]);
    assert.equal(operation.parameters.some(p => p.name === 'Idempotency-Key'), false);
    assert.equal(operation['x-laundry-idempotency'], 'PROVIDER_EVENT');
  }
});

test('OpenAPI exposes strict versioned booking and exact integer money limits', () => {
  const schemas = buildOpenApi().components.schemas;
  assert.ok(schemas.BookingInput.required.includes('expectedVersion'));
  assert.deepEqual(schemas.BookingInput.properties.paymentModel, { const: 'DUE_AT_RETURN', type: 'string' });
  assert.equal(schemas.BookingInput.additionalProperties, false);
  assert.equal(schemas.ManualPaymentConfirmation.properties.amountMinor.maximum, Number.MAX_SAFE_INTEGER);
});

test('JSON commands publish transport size rejection separately from logical input errors', () => {
  const responses = buildOpenApi().paths['/v2/identity/otp'].post.responses;
  assert.equal(responses['413'].content['application/json'].schema.$ref, '#/components/schemas/ErrorEnvelope');
  assert.ok(responses['400']);
  assert.ok(responses['503']);
});

test('slot queries encode multiple service IDs as one comma-separated parameter', () => {
  const params = buildOpenApi().paths['/v2/availability/slots'].get.parameters;
  const ids = params.find(p => p.name === 'serviceIds');
  assert.equal(ids.explode, false);
  assert.equal(ids.schema.items.format, 'uuid');
  assert.equal(params.find(p => p.name === 'from').required, true);
});

test('unrepresentable input types fail instead of silently producing empty schemas', () => {
  assert.throws(() => jsonSchema(z.bigint()));
  assert.throws(() => jsonSchema(z.date()));
});

test('OpenAPI publishes input normalization and does not discard constrained collections', () => {
  const schema = jsonSchema(z.object({ lines: z.array(z.string().min(1)).min(1).max(20) }).strict());
  assert.equal(schema.properties.lines.minItems, 1);
  assert.equal(schema.properties.lines.maxItems, 20);
  assert.equal(schema.properties.lines.items.minLength, 1);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema['x-laundry-runtime-validation'], true);
});
