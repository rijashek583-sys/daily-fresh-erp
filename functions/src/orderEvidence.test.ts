import { describe, expect, it } from 'vitest';
import { buildOrderEvidence, type OrderEvidenceSources } from './orderEvidence';

const req = { clientId: 'c', items: [{ productId: 'p', quantity: 2 }] };
const sources = (): OrderEvidenceSources => ({ client: { id: 'c', data: { id: 'c', status: 'active' }, updateTime: '1' }, pricing: null, products: [{ id: 'p', data: { id: 'p', status: 'active', division: 'primary', price: 2 }, updateTime: '2' }], stock: [{ id: 's', data: { productId: 'p', signedQty: 3 }, updateTime: '3' }] });
describe('read-only order evidence', () => {
  it('extracts product price and never declares stock ready', () => {
    const result = buildOrderEvidence(req, sources());
    expect(result.items).toEqual([{ productId: 'p', quantity: 2, division: 'primary', unitPricePaise: 200, priceSource: 'product' }]);
    expect(result.status).toBe('review-required'); expect(result.findings).toContain('STOCK_COMPLETENESS_AND_REVISION_UNVERIFIED');
  });
  it('uses persisted customer-specific price and rejects division conflicts', () => {
    const s = sources(); s.pricing = { id: 'c', data: { primary: { p: 1.5 } }, updateTime: '4' };
    expect(buildOrderEvidence(req, s).items[0]?.unitPricePaise).toBe(150);
    s.pricing.data.bakery = { p: 3 };
    expect(buildOrderEvidence(req, s).findings).toContain('PRICING_DIVISION_CONFLICT:p');
  });
  it('flags missing override, stock and division evidence', () => {
    const s = sources(); s.stock = [];
    expect(buildOrderEvidence(req, s).findings).toContain('STOCK_HISTORY_MISSING:p');
    expect(buildOrderEvidence({ ...req, items: [{ ...req.items[0]!, overrideId: 'approval' }] }, s).findings).toContain('OVERRIDE_EVIDENCE_UNAVAILABLE:p');
    delete s.products[0]!.data.division;
    expect(buildOrderEvidence(req, s).findings).toContain('DIVISION_UNRESOLVED:p');
  });
  it('rejects duplicate IDs and changes fingerprints for request or revision changes', () => {
    const s = sources(); expect(() => buildOrderEvidence({ ...req, items: [...req.items, ...req.items] }, s)).toThrow();
    expect(buildOrderEvidence(req, s).fingerprint).toBe(buildOrderEvidence(req, sources()).fingerprint);
    s.products[0]!.updateTime = 'changed'; expect(buildOrderEvidence(req, s).fingerprint).not.toBe(buildOrderEvidence(req, sources()).fingerprint);
  });
});
