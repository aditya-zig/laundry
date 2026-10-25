import { v2 } from "@laundry/contracts";
import { rateHeadline, unitHeadline } from "./presenters";

export interface ServiceCard {
  service: v2.Service;
  /** server-published rate only; null when no rate card is active */
  rate: { title: string; sub: string | null } | null;
  unitTitle: string;
  paused: boolean;
  synthetic: boolean;
}

export function indexPublishedRates(rates: v2.EffectiveRateSummary[]): Partial<Record<v2.ServiceCode, v2.EffectiveRateSummary>> {
  const indexed: Partial<Record<v2.ServiceCode, v2.EffectiveRateSummary>> = {};
  for (const rate of rates) indexed[rate.serviceCode] = rate;
  return indexed;
}

export function serviceCards(
  services: v2.Service[],
  rateForService?: (code: v2.ServiceCode) => v2.EffectiveRateSummary | undefined,
): ServiceCard[] {
  return services.map((service) => {
    const rate = rateForService?.(service.code);
    const headline = rate ? rateHeadline(rate) : null;
    return { service, rate: headline, unitTitle: unitHeadline(service), paused: !service.active, synthetic: rate?.synthetic ?? false };
  });
}

export function catalogCardBookable(card: ServiceCard): boolean {
  return !card.paused;
}

export type CatalogEmptyReason = "NO_CATALOG" | "ALL_PAUSED";

export function catalogEmptyReason(services: v2.Service[]): CatalogEmptyReason | null {
  if (services.length === 0) return "NO_CATALOG";
  if (services.every((service) => !service.active)) return "ALL_PAUSED";
  return null;
}
