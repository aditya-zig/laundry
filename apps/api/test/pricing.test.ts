import { describe, expect, it } from 'vitest';
import { v2 } from '@laundry/contracts';
import { assertRateCardPricing, billableWeightGrams, priceBasket, priceLine } from '../../../modules/pricing/src';

const now = new Date('2026-10-25T06:00:00.000Z');
const id = '00000000-0000-4000-8000-000000000001';

function card(overrides: Partial<v2.RateCard> = {}): v2.RateCard {
  return {
    id,
    version: 1,
    serviceCodes: ['WASH_FOLD'],
    components: [{ label: 'Synthetic per kg', kind: 'PER_KG', amountMinor: 4000, synthetic: true }],
    weightIncrementGrams: 500,
    rounding: 'CEIL',
    effectiveFrom: '2026-10-01T00:00:00.000Z',
    approvedAt: '2026-10-01T00:00:00.000Z',
    activatedAt: '2026-10-01T00:00:00.000Z',
    synthetic: true,
    ...overrides,
  };
}

describe('B02 integer pricing from an approved rate snapshot', () => {
  it('bills KG through the increment with explicit CEIL rounding', () => {
    expect(billableWeightGrams(card(), 1201)).toBe(1500);
    expect(priceLine({ rateCard: card(), billingUnit: 'KG', estimatedWeightGrams: 1201 }, now)).toMatchObject({
      unitPriceMinor: 4000,
      billableWeightGrams: 1500,
      lineTotalMinor: 6000,
      provisional: true,
    });
  });

  it('honours FLOOR and NONE rounding without inventing a unit', () => {
    expect(billableWeightGrams(card({ rounding: 'FLOOR' }), 1201)).toBe(1000);
    expect(billableWeightGrams(card({ rounding: 'NONE' }), 1201)).toBe(1201);
  });

  it('applies the minimum billable weight before the increment', () => {
    const priced = priceLine({ rateCard: card({ minimumBillableGrams: 1000 }), billingUnit: 'KG', estimatedWeightGrams: 400 }, now);
    expect(priced.billableWeightGrams).toBe(1000);
    expect(priced.lineTotalMinor).toBe(4000);
  });

  it('prices PIECE lines by quantity with BASE and a MINIMUM delta', () => {
    const priced = priceLine({
      rateCard: card({
        components: [
          { label: 'Synthetic base', kind: 'BASE', amountMinor: 1000, synthetic: true },
          { label: 'Synthetic per piece', kind: 'PER_PIECE', amountMinor: 500, synthetic: true },
          { label: 'Synthetic minimum', kind: 'MINIMUM', amountMinor: 3000, synthetic: true },
        ],
        weightIncrementGrams: undefined,
      }),
      billingUnit: 'PIECE',
      pieceQuantity: 3,
    }, now);
    expect(priced.lineTotalMinor).toBe(3000);
    expect(priced.provisional).toBe(false);
    expect(priced.components).toEqual([
      { label: 'Synthetic per piece', kind: 'PER_PIECE', amountMinor: 1500 },
      { label: 'Synthetic base', kind: 'BASE', amountMinor: 1000 },
      { label: 'Synthetic minimum', kind: 'MINIMUM', amountMinor: 500 },
    ]);
  });

  it('adds tax and fee components once per basket, not per line', () => {
    const priced = priceBasket(card({
      components: [
        { label: 'Synthetic per piece', kind: 'PER_PIECE', amountMinor: 5000, synthetic: true },
        { label: 'Synthetic tax', kind: 'TAX', amountMinor: 900, synthetic: true },
        { label: 'Synthetic fee', kind: 'FEE', amountMinor: 100, synthetic: true },
      ],
      weightIncrementGrams: undefined,
    }), [
      { billingUnit: 'PIECE', pieceQuantity: 1 },
      { billingUnit: 'PIECE', pieceQuantity: 2 },
    ], now);
    expect(priced.lines.map(line => line.lineTotalMinor)).toEqual([5000, 10000]);
    expect(priced.totalMinor).toBe(16000);
    expect(priced.provisional).toBe(false);
    expect(priced.breakdown.filter(item => item.kind === 'TAX' || item.kind === 'FEE')).toHaveLength(2);
  });

  it('refuses an unapproved, inactive, or not-yet-effective rate card', () => {
    expect(() => priceLine({ rateCard: card({ approvedAt: undefined }), billingUnit: 'KG', estimatedWeightGrams: 1000 }, now))
      .toThrowError(/approved active rate card/);
    expect(() => priceLine({ rateCard: card({ activatedAt: undefined }), billingUnit: 'KG', estimatedWeightGrams: 1000 }, now))
      .toThrowError(/approved active rate card/);
    expect(() => priceLine({ rateCard: card({ effectiveFrom: '2026-11-01T00:00:00.000Z' }), billingUnit: 'KG', estimatedWeightGrams: 1000 }, now))
      .toThrowError(/not yet effective/);
  });

  it('refuses contract shapes that cannot be priced deterministically', () => {
    expect(() => assertRateCardPricing(card({
      components: [{ label: 'Mystery increment', kind: 'INCREMENT', amountMinor: 100, synthetic: true }],
    }))).toThrowError(/no defined pricing unit/);
    expect(() => assertRateCardPricing(card({ weightIncrementGrams: undefined })))
      .toThrowError(/explicit weightIncrementGrams/);
    expect(() => assertRateCardPricing(card({
      components: [
        { label: 'A', kind: 'PER_KG', amountMinor: 1000, synthetic: true },
        { label: 'B', kind: 'PER_KG', amountMinor: 2000, synthetic: true },
      ],
    }))).toThrowError(/Duplicate PER_KG/);
    expect(() => priceLine({ rateCard: card(), billingUnit: 'KG' }, now)).toThrowError(/estimatedWeightGrams/);
    expect(() => priceLine({ rateCard: card({ components: [{ label: 'Piece only', kind: 'PER_PIECE', amountMinor: 1000, synthetic: true }], weightIncrementGrams: undefined }), billingUnit: 'KG', estimatedWeightGrams: 500 }, now))
      .toThrowError(/does not price KG/);
  });
});
