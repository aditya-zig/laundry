import { z } from "zod";

export const idSchema = z.string().uuid();
export type Id = z.infer<typeof idSchema>;

export const currencySchema = z.literal("INR");
export type Currency = z.infer<typeof currencySchema>;

export const moneySchema = z.number().int().nonnegative().safe();
export type Money = z.infer<typeof moneySchema>;

const instantPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/;

const validInstant = (value: string): boolean => {
  if (!instantPattern.test(value)) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;

const datePart = value.slice(0, 10);
  const timePart = value.slice(11, 19);
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);

const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }

return true;
};

export const rawInstantSchema = z.string().refine(validInstant, {
  message: "Expected a valid ISO-8601 instant with Z or a numeric offset",
});
export type RawInstant = z.infer<typeof rawInstantSchema>;

export const instantSchema = rawInstantSchema.transform((value) =>
  new Date(value).toISOString(),
);
export type Instant = z.infer<typeof instantSchema>;

export const ianaTimezoneSchema = z
  .string()
  .min(1)
  .refine(
    (timezone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Expected a valid IANA timezone" },
  );
export type IanaTimezone = z.infer<typeof ianaTimezoneSchema>;

const windowBaseSchema = z.object({
  start: rawInstantSchema,
  end: rawInstantSchema,
  timezone: ianaTimezoneSchema,
});

export const windowSchema = windowBaseSchema
  .refine(
    (window) => Date.parse(window.end) > Date.parse(window.start),
    {
      message: "Window end must be strictly after start",
      path: ["end"],
    },
  )
  .transform((window) => ({
    ...window,
    start: new Date(window.start).toISOString(),
    end: new Date(window.end).toISOString(),
  }));
export type ScheduleWindow = z.infer<typeof windowSchema>;

export function localDateInZone(
  instant: string,
  timezone: string,
): string {
  const normalizedInstant = instantSchema.parse(instant);
  const validTimezone = ianaTimezoneSchema.parse(timezone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(normalizedInstant));

const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

return `${values.year}-${values.month}-${values.day}`;
}

export const localDateInZoneSchema = z
  .object({
    instant: instantSchema,
    timezone: ianaTimezoneSchema,
  })
  .transform(({ instant, timezone }) => localDateInZone(instant, timezone));
export type LocalDateInZone = z.infer<typeof localDateInZoneSchema>;

export const billingUnitSchema = z.enum(["KG", "PIECE"]);
export type BillingUnit = z.infer<typeof billingUnitSchema>;

export const actorRoleSchema = z.enum([
  "CUSTOMER",
  "RIDER",
  "FACILITY",
  "OPERATOR",
  "SUPPORT",
  "ADMIN",
]);
export type ActorRole = z.infer<typeof actorRoleSchema>;

// These scopes are derived by the server. Request bodies never grant these scopes.
export const actorSchema = z.object({
  id: idSchema,
  role: actorRoleSchema,
  facilityIds: z.array(idSchema),
  scope: z.object({
    assignedOrderIds: z.array(idSchema).optional(),
    assignedLegIds: z.array(idSchema).optional(),
    facilityIds: z.array(idSchema),
  }),
});
export type Actor = z.infer<typeof actorSchema>;

/** Internal service identity. Never parsed from a first-party request body. */
export const systemActorSchema = z.object({
  id: idSchema,
  role: z.literal("SYSTEM"),
  consumerScopes: z.array(z.string().trim().min(1)).min(1),
}).strict();
export type SystemActor = z.infer<typeof systemActorSchema>;

export const errorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_INPUT",
  "OUT_OF_AREA",
  "NO_CAPACITY",
  "DEADLINE_UNAVAILABLE",
  "QUOTE_EXPIRED",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "PAYMENT_PENDING",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_OUTCOME_UNKNOWN",
  "REQUIRES_APPROVAL",
  "RATE_LIMITED",
  "MEDIA_NOT_READY",
  "RETENTION_EXPIRED",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * HTTP statuses follow the API error contract.
 * Retryability describes whether the same operation may be retried safely.
 */
export const errorHttpStatus: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  OUT_OF_AREA: 422,
  NO_CAPACITY: 409,
  DEADLINE_UNAVAILABLE: 422,
  QUOTE_EXPIRED: 409,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PAYMENT_PENDING: 409,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_OUTCOME_UNKNOWN: 503,
  REQUIRES_APPROVAL: 422,
  RATE_LIMITED: 429,
  MEDIA_NOT_READY: 409,
  RETENTION_EXPIRED: 410,
};

export const errorRetryable: Record<ErrorCode, boolean> = {
  UNAUTHENTICATED: false,
  FORBIDDEN: false,
  NOT_FOUND: false,
  INVALID_INPUT: false,
  OUT_OF_AREA: false,
  NO_CAPACITY: true,
  DEADLINE_UNAVAILABLE: false,
  QUOTE_EXPIRED: false,
  VERSION_CONFLICT: true,
  IDEMPOTENCY_CONFLICT: false,
  PAYMENT_PENDING: true,
  PROVIDER_UNAVAILABLE: true,
  PROVIDER_OUTCOME_UNKNOWN: true,
  REQUIRES_APPROVAL: false,
  RATE_LIMITED: true,
  MEDIA_NOT_READY: true,
  RETENTION_EXPIRED: false,
};

export const errorEnvelopeSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  retryable: z.boolean(),
  traceId: z.string().min(1),
  currentVersion: z.number().int().min(1).optional(),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const idempotencyKeySchema = z.string().min(1).max(200);
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

export const expectedVersionSchema = z.number().int().min(1);
export type ExpectedVersion = z.infer<typeof expectedVersionSchema>;

export const pageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const pageInfoSchema = z.object({
  nextCursor: z.string().min(1).optional(),
  hasMore: z.boolean(),
});
export type PageInfo = z.infer<typeof pageInfoSchema>;

/** A cursor page envelope. The item schema is supplied by the caller so a
 * route can freeze its own item shape. */
export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    pageInfo: pageInfoSchema,
  });
export type Page<T> = {
  items: T[];
  pageInfo: PageInfo;
};
