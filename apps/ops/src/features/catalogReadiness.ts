import type { V2Client } from '@laundry/api-client';
import type { v2 } from '@laundry/contracts';

export type CatalogReadClient = Pick<V2Client, 'listServices' | 'getEffectiveRates'>;
export interface CatalogReadinessRow {
  service: v2.Service;
  rate: { kind: 'ready'; value: v2.EffectiveRateSummary } | { kind: 'unpublished' | 'unavailable' };
}

// Read-only: never derive publication, licensing or launch approval from a price.
export async function loadCatalogReadiness(client: CatalogReadClient): Promise<CatalogReadinessRow[]> {
  const services = await client.listServices();
  return Promise.all(services.map(async service => {
    try {
      const rates = await client.getEffectiveRates({ serviceCode: service.code });
      if (!rates.length) return { service, rate: { kind: 'unpublished' as const } };
      if (rates.length !== 1 || rates[0].serviceCode !== service.code || rates[0].billingUnit !== service.billingUnit) {
        return { service, rate: { kind: 'unavailable' as const } };
      }
      return { service, rate: { kind: 'ready' as const, value: rates[0] } };
    } catch { return { service, rate: { kind: 'unavailable' as const } }; }
  }));
}
