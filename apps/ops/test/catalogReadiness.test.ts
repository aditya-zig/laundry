import { describe, it, expect, vi } from 'vitest';
import { v2 } from '@laundry/contracts';
import { loadCatalogReadiness, type CatalogReadClient } from '../src/features/catalogReadiness';

const service = (code: v2.ServiceCode = 'WASH_FOLD') => v2.serviceSchema.parse({
  id: code === 'WASH_FOLD' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222',
  version: 1, code, name: `Synthetic ${code}`, description: 'Test only', imageUrl: 'https://assets.example.test/service.png',
  billingUnit: code === 'WASH_FOLD' ? 'KG' : 'PIECE', turnaroundHours: 48, garments: [], features: [], careExclusions: [], active: true,
});
const rate = (code: v2.ServiceCode = 'WASH_FOLD') => v2.effectiveRateSummarySchema.parse({
  serviceCode: code, billingUnit: code === 'WASH_FOLD' ? 'KG' : 'PIECE', unitPriceMinor: 4000, unitLabel: 'server unit', synthetic: true,
});
const client = (): CatalogReadClient => ({ listServices: vi.fn(async () => [service()]), getEffectiveRates: vi.fn(async () => [rate()]) });

describe('operator catalog read model', () => {
  it('reads actual rates by service code and preserves demo provenance, paise and unit labels', async () => {
    const api = client(); const rows = await loadCatalogReadiness(api);
    expect(api.getEffectiveRates).toHaveBeenCalledExactlyOnceWith({ serviceCode: 'WASH_FOLD' });
    expect(rows).toEqual([{ service: service(), rate: { kind: 'ready', value: rate() } }]);
  });
  it('does not call rates or invent services when the service list is empty', async () => {
    const api = client(); vi.mocked(api.listServices).mockResolvedValue([]);
    expect(await loadCatalogReadiness(api)).toEqual([]); expect(api.getEffectiveRates).not.toHaveBeenCalled();
  });
  it('propagates a failed catalog read instead of presenting an empty catalog', async () => {
    const api = client(); vi.mocked(api.listServices).mockRejectedValue(new Error('unavailable'));
    await expect(loadCatalogReadiness(api)).rejects.toThrow('unavailable');
  });
  it('a failed rate read remains unavailable, not a zero price or unpublished rate', async () => {
    const api = client(); vi.mocked(api.getEffectiveRates).mockRejectedValue(new Error('unavailable'));
    expect((await loadCatalogReadiness(api))[0].rate).toEqual({ kind: 'unavailable' });
  });
  it('empty effective-rate results mean no published rate; mismatched or duplicate records are not authoritative', async () => {
    for (const [values, kind] of [[[], 'unpublished'], [[rate('DRY_CLEAN')], 'unavailable'], [[rate(), rate()], 'unavailable']] as const) {
      const api = client(); vi.mocked(api.getEffectiveRates).mockResolvedValue([...values]);
      expect((await loadCatalogReadiness(api))[0].rate).toEqual({ kind });
    }
  });
  it('one unavailable service rate does not hide another server rate or borrow its price', async () => {
    const api = client(); vi.mocked(api.listServices).mockResolvedValue([service(), service('DRY_CLEAN')]);
    vi.mocked(api.getEffectiveRates).mockImplementation(async q => { if (q?.serviceCode === 'DRY_CLEAN') throw new Error('missing'); return [rate()]; });
    const rows = await loadCatalogReadiness(api);
    expect(rows[0].rate).toEqual({ kind: 'ready', value: rate() }); expect(rows[1].rate).toEqual({ kind: 'unavailable' });
  });
});
