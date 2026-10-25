import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { v2 } from "@laundry/contracts";
import { createPostgresCommandExecutor } from "../../shared/src/command-executor";
import { assertRateCardPricing, unitPriceMinor } from "../../pricing/src";
import { CatalogFault } from "./errors";

/**
 * Production-v2 catalog and rate-card boundary.
 *
 * Reads expose only published rows to anonymous callers. Writes require an
 * operator session and go through the shared idempotent command executor, so a
 * retry cannot approve a second rate card or rewrite an accepted version.
 *
 * Rate cards are immutable documents: create writes the priced values once,
 * approval and activation only stamp timestamps. `version` identifies the
 * commercial document revision, not the lifecycle stage.
 */
export interface CatalogOptions {
  db: Pool;
  /** Supplied by the identity boundary; catalog never parses tokens itself. */
  authenticate?: (token: string) => Promise<{ actor: v2.Actor }>;
  clock?: () => Date;
}

interface ServiceRow {
  id: string;
  version: number;
  code: string;
  name: string;
  description: string;
  image_url: string;
  billing_unit: v2.Service["billingUnit"];
  turnaround_hours: number;
  features: string[];
  care_exclusions: string[];
  active: boolean;
}

interface GarmentRow {
  id: string;
  name: string;
  eligible_service_codes: v2.ServiceCode[];
  price_minor: number | null;
  active: boolean;
}

interface RateCardRow {
  id: string;
  version: number;
  service_codes: v2.ServiceCode[];
  components: v2.RateCardComponent[];
  weight_increment_grams: number | null;
  minimum_billable_grams: number | null;
  rounding: v2.RateCard["rounding"];
  effective_from: Date;
  approved_at: Date | null;
  activated_at: Date | null;
  synthetic: boolean;
}

const STAFF = new Set(["OPERATOR", "ADMIN"]);

function garment(row: GarmentRow): v2.GarmentEligibility {
  return {
    id: row.id,
    name: row.name,
    eligibleServiceCodes: row.eligible_service_codes,
    ...(row.price_minor === null ? {} : { priceMinor: row.price_minor }),
    active: row.active,
  };
}

function rateCard(row: RateCardRow): v2.RateCard {
  return {
    id: row.id,
    version: row.version,
    serviceCodes: row.service_codes,
    components: row.components,
    ...(row.weight_increment_grams === null ? {} : { weightIncrementGrams: row.weight_increment_grams }),
    ...(row.minimum_billable_grams === null ? {} : { minimumBillableGrams: row.minimum_billable_grams }),
    rounding: row.rounding,
    effectiveFrom: row.effective_from.toISOString(),
    ...(row.approved_at === null ? {} : { approvedAt: row.approved_at.toISOString() }),
    ...(row.activated_at === null ? {} : { activatedAt: row.activated_at.toISOString() }),
    synthetic: row.synthetic,
  };
}

export class CatalogService {
  private readonly executor: ReturnType<typeof createPostgresCommandExecutor>;
  private readonly clock: () => Date;
  constructor(private readonly options: CatalogOptions) {
    this.executor = createPostgresCommandExecutor(options.db);
    this.clock = options.clock ?? (() => new Date());
  }

  private async rows<T extends object>(sql: string, values: unknown[] = []): Promise<T[]> {
    return (await this.options.db.query(sql, values)).rows as T[];
  }

  private async garments(): Promise<GarmentRow[]> {
    return this.rows<GarmentRow>("SELECT * FROM catalog_garments WHERE active ORDER BY name, id");
  }

  private project(row: ServiceRow, garments: GarmentRow[]): v2.Service {
    return v2.serviceSchema.parse({
      id: row.id,
      version: row.version,
      code: row.code,
      name: row.name,
      description: row.description,
      imageUrl: row.image_url,
      billingUnit: row.billing_unit,
      turnaroundHours: row.turnaround_hours,
      garments: garments
        .filter(item => item.eligible_service_codes.includes(row.code as v2.ServiceCode))
        .map(garment),
      features: row.features,
      careExclusions: row.care_exclusions,
      active: row.active,
    });
  }

  async listServices(): Promise<v2.Service[]> {
    const services = await this.rows<ServiceRow>("SELECT * FROM catalog_services WHERE active ORDER BY name, id");
    const garments = await this.garments();
    return services.map(row => this.project(row, garments));
  }

  /**
   * Anonymous callers see published services only. An optional valid staff
   * session may read an unpublished service so an operator can prepare it;
   * invalid or customer tokens deliberately fall back to the public view.
   */
  async getService(serviceId: string, token?: string): Promise<v2.Service> {
    v2.idSchema.parse(serviceId);
    const rows = await this.rows<ServiceRow>("SELECT * FROM catalog_services WHERE id=$1", [serviceId]);
    const row = rows[0];
    if (!row) throw new CatalogFault("NOT_FOUND", "Service not found");
    if (!row.active && !(await this.staffOrUndefined(token))) throw new CatalogFault("NOT_FOUND", "Service not found");
    return this.project(row, await this.garments());
  }

  async listGarmentEligibility(): Promise<v2.GarmentEligibility[]> {
    return (await this.garments()).map(garment);
  }

  /** Effective means published service, approved card, already activated and
   * already effective. Unpriced services are omitted rather than fabricated;
   * ordering by version means exactly one card wins per service. */
  async effectiveRates(serviceCode?: v2.ServiceCode): Promise<v2.EffectiveRateSummary[]> {
    if (serviceCode !== undefined) v2.serviceCodeSchema.parse(serviceCode);
    const services = await this.rows<ServiceRow>(
      serviceCode === undefined
        ? "SELECT * FROM catalog_services WHERE active ORDER BY code"
        : "SELECT * FROM catalog_services WHERE active AND code=$1 ORDER BY code",
      serviceCode === undefined ? [] : [serviceCode],
    );
    if (serviceCode !== undefined && services.length === 0) {
      throw new CatalogFault("NOT_FOUND", "Service is not published");
    }
    const cards = await this.rows<RateCardRow>(`SELECT * FROM catalog_rate_cards
      WHERE approved_at IS NOT NULL AND activated_at IS NOT NULL
        AND activated_at <= $1 AND effective_from <= $1
      ORDER BY version DESC`, [this.clock()]);
    const summaries: v2.EffectiveRateSummary[] = [];
    for (const service of services) {
      const card = cards.find(item => item.service_codes.includes(service.code as v2.ServiceCode));
      if (!card) continue;
      const document = rateCard(card);
      const unit = unitPriceMinor(document, service.billing_unit);
      summaries.push(v2.effectiveRateSummarySchema.parse({
        serviceCode: service.code,
        billingUnit: service.billing_unit,
        unitPriceMinor: unit.amountMinor,
        unitLabel: unit.label,
        ...(document.weightIncrementGrams === undefined ? {} : { weightIncrementGrams: document.weightIncrementGrams }),
        ...(document.minimumBillableGrams === undefined ? {} : { minimumBillableGrams: document.minimumBillableGrams }),
        rateCardVersion: document.version,
        synthetic: document.synthetic,
      }));
    }
    return summaries;
  }

  private async staffOrUndefined(token: string | undefined): Promise<v2.Actor | undefined> {
    if (!token || !this.options.authenticate) return undefined;
    try {
      const { actor } = await this.options.authenticate(token);
      return STAFF.has(actor.role) ? actor : undefined;
    } catch {
      return undefined;
    }
  }

  private async staff(token: string): Promise<v2.Actor> {
    if (!this.options.authenticate) throw new CatalogFault("UNAUTHENTICATED", "Sign in again to continue");
    const { actor } = await this.options.authenticate(token);
    if (!STAFF.has(actor.role)) throw new CatalogFault("FORBIDDEN", "Catalog administration requires an operator");
    return actor;
  }

  private guardSynthetic(synthetic: boolean): void {
    if (process.env.NODE_ENV === "production" && synthetic) {
      throw new CatalogFault("INVALID_INPUT", "Synthetic rate cards cannot be published in production");
    }
  }

  async updateService(token: string, serviceId: string, input: v2.ServiceUpdate, key: string): Promise<v2.Service> {
    v2.idSchema.parse(serviceId);
    const parsed = v2.serviceUpdateSchema.parse(input);
    if (parsed.garments !== undefined) {
      throw new CatalogFault("INVALID_INPUT", "Garment eligibility is not editable through a service update");
    }
    const actor = await this.staff(token);
    const { expectedVersion, reason, ...changes } = parsed;
    const result = await this.executor.execute(
      {
        actor,
        operation: "catalog.services.write",
        idempotencyKey: key,
        payload: parsed as unknown as v2.JsonValue,
        traceId: randomUUID(),
      },
      async () => { await this.staff(token); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const row = (await tx.query<ServiceRow>("SELECT * FROM catalog_services WHERE id=$1 FOR UPDATE", [serviceId])).rows[0];
        if (!row) throw new CatalogFault("NOT_FOUND", "Service not found");
        if (row.version !== expectedVersion) {
          throw new CatalogFault("VERSION_CONFLICT", "Service changed since it was read", row.version);
        }
        let updated: ServiceRow;
        try {
          updated = (await tx.query<ServiceRow>(`UPDATE catalog_services SET
            code=$2, name=$3, description=$4, image_url=$5, billing_unit=$6, turnaround_hours=$7,
            features=$8, care_exclusions=$9, active=$10, version=version+1, updated_at=$11
            WHERE id=$1 RETURNING *`, [
            serviceId,
            changes.code ?? row.code,
            changes.name ?? row.name,
            changes.description ?? row.description,
            changes.imageUrl ?? row.image_url,
            changes.billingUnit ?? row.billing_unit,
            changes.turnaroundHours ?? row.turnaround_hours,
            JSON.stringify(changes.features ?? row.features),
            JSON.stringify(changes.careExclusions ?? row.care_exclusions),
            changes.active ?? row.active,
            this.clock(),
          ])).rows[0];
        } catch (error) {
          if ((error as { code?: string }).code === "23505") {
            throw new CatalogFault("INVALID_INPUT", "Another service already uses this code");
          }
          throw error;
        }
        const facts = (value: ServiceRow) => ({
          version: value.version, code: value.code, name: value.name,
          billingUnit: value.billing_unit, turnaroundHours: value.turnaround_hours, active: value.active,
        });
        await scope.audit({
          aggregateId: serviceId,
          action: "CATALOG_SERVICE_UPDATED",
          reason,
          before: facts(row),
          after: facts(updated),
        });
        return this.project(updated, await this.garments()) as unknown as v2.JsonValue;
      },
    );
    return v2.serviceSchema.parse(result);
  }

  async createRateCard(token: string, input: v2.RateCardInput, key: string): Promise<v2.RateCard> {
    const parsed = v2.rateCardInputSchema.parse(input);
    this.guardSynthetic(parsed.synthetic);
    assertRateCardPricing({ ...parsed, id: randomUUID(), version: 1 });
    const actor = await this.staff(token);
    const result = await this.executor.execute(
      {
        actor,
        operation: "catalog.rate-cards.create",
        idempotencyKey: key,
        payload: parsed as unknown as v2.JsonValue,
        traceId: randomUUID(),
      },
      async () => { await this.staff(token); },
      async scope => {
        const tx: PoolClient = scope.handle;
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["catalog.rate-card-version"]);
        const next = (await tx.query<{ version: number }>(
          "SELECT COALESCE(MAX(version),0)+1 AS version FROM catalog_rate_cards")).rows[0].version;
        const id = randomUUID();
        const row = (await tx.query<RateCardRow>(`INSERT INTO catalog_rate_cards
          (id, version, service_codes, components, weight_increment_grams, minimum_billable_grams,
           rounding, effective_from, approved_at, activated_at, synthetic, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,$9,$10) RETURNING *`, [
          id, next,
          JSON.stringify(parsed.serviceCodes),
          JSON.stringify(parsed.components),
          parsed.weightIncrementGrams ?? null,
          parsed.minimumBillableGrams ?? null,
          parsed.rounding,
          parsed.effectiveFrom,
          parsed.synthetic,
          this.clock(),
        ])).rows[0];
        await scope.audit({
          aggregateId: id,
          action: "RATE_CARD_DRAFTED",
          reason: `Draft rate card version ${next}`,
          before: {},
          after: { version: next, serviceCodes: parsed.serviceCodes, synthetic: parsed.synthetic },
        });
        return rateCard(row) as unknown as v2.JsonValue;
      },
    );
    return v2.rateCardSchema.parse(result);
  }

  async approveRateCard(token: string, rateCardId: string, input: v2.VersionedReason, key: string): Promise<v2.RateCard> {
    return this.lifecycle(token, rateCardId, input, key, "approve");
  }

  async activateRateCard(token: string, rateCardId: string, input: v2.VersionedReason, key: string): Promise<v2.RateCard> {
    return this.lifecycle(token, rateCardId, input, key, "activate");
  }

  private async lifecycle(
    token: string,
    rateCardId: string,
    input: v2.VersionedReason,
    key: string,
    action: "approve" | "activate",
  ): Promise<v2.RateCard> {
    v2.idSchema.parse(rateCardId);
    const parsed = v2.versionedReasonSchema.parse(input);
    const actor = await this.staff(token);
    const result = await this.executor.execute(
      {
        actor,
        operation: action === "approve" ? "catalog.rate-cards.approve" : "catalog.rate-cards.activate",
        idempotencyKey: key,
        payload: { ...parsed, rateCardId } as unknown as v2.JsonValue,
        traceId: randomUUID(),
      },
      async () => { await this.staff(token); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const row = (await tx.query<RateCardRow>(
          "SELECT * FROM catalog_rate_cards WHERE id=$1 FOR UPDATE", [rateCardId])).rows[0];
        if (!row) throw new CatalogFault("NOT_FOUND", "Rate card not found");
        if (row.version !== parsed.expectedVersion) {
          throw new CatalogFault("VERSION_CONFLICT", "Rate card changed since it was read", row.version);
        }
        this.guardSynthetic(row.synthetic);
        if (action === "approve") {
          if (row.approved_at) throw new CatalogFault("VERSION_CONFLICT", "Rate card is already approved", row.version);
          const updated = (await tx.query<RateCardRow>(
            "UPDATE catalog_rate_cards SET approved_at=$2 WHERE id=$1 RETURNING *", [rateCardId, this.clock()])).rows[0];
          await scope.audit({
            aggregateId: rateCardId,
            action: "RATE_CARD_APPROVED",
            reason: parsed.reason,
            before: { version: row.version, approved: false },
            after: { version: updated.version, approved: true },
          });
          return rateCard(updated) as unknown as v2.JsonValue;
        }
        if (!row.approved_at) throw new CatalogFault("VERSION_CONFLICT", "Rate card must be approved before activation", row.version);
        if (row.activated_at) throw new CatalogFault("VERSION_CONFLICT", "Rate card is already activated", row.version);
        const updated = (await tx.query<RateCardRow>(
          "UPDATE catalog_rate_cards SET activated_at=$2 WHERE id=$1 RETURNING *", [rateCardId, this.clock()])).rows[0];
        await scope.audit({
          aggregateId: rateCardId,
          action: "RATE_CARD_ACTIVATED",
          reason: parsed.reason,
          before: { version: row.version, activated: false },
          after: { version: updated.version, activated: true },
        });
        return rateCard(updated) as unknown as v2.JsonValue;
      },
    );
    return v2.rateCardSchema.parse(result);
  }
}
