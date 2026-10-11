// Versioned domain event envelope + event type constants from contracts.md.
export const SCHEMA_VERSION = 1;
export function makeEnvelope(eventType, aggregateId, aggregateVersion, payload, traceId) {
    return {
        eventId: crypto.randomUUID(),
        eventType,
        schemaVersion: SCHEMA_VERSION,
        aggregateId,
        aggregateVersion,
        occurredAt: new Date().toISOString(),
        traceId,
        payload,
    };
}
//# sourceMappingURL=events.js.map