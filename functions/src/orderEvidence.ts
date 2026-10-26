import type * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { validateAndFetchActiveUser } from './authValidation';
import { validateOrderQuantity } from './financialContracts';

type Data = Record<string, unknown>;
export interface OrderEvidenceRequest { clientId: string; items: readonly { productId: string; quantity: number; overrideId?: string }[] }
export interface EvidenceDocument { id: string; data: Data; updateTime: string | null }
export interface OrderEvidenceSources { client: EvidenceDocument | null; pricing: EvidenceDocument | null; products: EvidenceDocument[]; stock: EvidenceDocument[] }
export interface OrderEvidenceResult {
  status: 'review-required';
  items: { productId: string; quantity: number; division: 'primary' | 'bakery'; unitPricePaise: number; priceSource: 'customer' | 'product' }[];
  findings: string[];
  fingerprint: string;
}
const validId = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.trim() === s && !s.includes('/');
const object = (v: unknown): Data | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Data : null;
const pricePaise = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v > 0 && Number.isSafeInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6 ? Math.round(v * 100) : null;
const sorted = (docs: EvidenceDocument[]) => [...docs].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Snapshot evidence only: no approval, total, stock sufficiency or transaction authorization.
 * Existing stock has transaction history but no authoritative complete revisioned balance;
 * override approval has no established persisted schema. Both remain review blockers.
 * Transaction fit is unproven: order, credit, invoice and per-item stock writes must
 * be bounded against Firestore request/transaction limits and tested with actual data;
 * unbounded stock-history reads cannot be assumed to fit or establish completeness.
 */
export function buildOrderEvidence(request: OrderEvidenceRequest, sources: OrderEvidenceSources): OrderEvidenceResult {
  if (!request || !validId(request.clientId) || !Array.isArray(request.items) || request.items.length === 0) throw new HttpsError('invalid-argument', 'Customer and items are required');
  const ids = new Set<string>();
  for (const item of request.items) {
    if (!item || !validId(item.productId) || ids.has(item.productId)) throw new HttpsError('invalid-argument', 'Invalid or duplicate product ID');
    ids.add(item.productId); validateOrderQuantity(item.quantity);
  }
  const findings: string[] = [];
  if (!sources.client || sources.client.id !== request.clientId || (sources.client.data.id !== undefined && sources.client.data.id !== request.clientId) || sources.client.data.status !== 'active' || sources.client.data.deletedAt) findings.push('CUSTOMER_EVIDENCE_INVALID');
  if (sources.client && !sources.client.updateTime) findings.push('CUSTOMER_REVISION_MISSING');
  if (sources.pricing && sources.pricing.id !== request.clientId) findings.push('PRICING_CUSTOMER_MISMATCH');
  const products = sorted(sources.products), stock = sorted(sources.stock);
  const items: OrderEvidenceResult['items'] = [];
  for (const item of [...request.items].sort((a, b) => a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0)) {
    const matches = products.filter(p => p.id === item.productId);
    if (matches.length !== 1) { findings.push(`PRODUCT_EVIDENCE_MISSING:${item.productId}`); continue; }
    const p = matches[0]!;
    if ((p.data.id !== undefined && p.data.id !== p.id) || p.data.status !== 'active' || p.data.deletedAt || !p.updateTime) { findings.push(`PRODUCT_EVIDENCE_INVALID:${item.productId}`); continue; }
    if (p.data.division !== 'primary' && p.data.division !== 'bakery') { findings.push(`DIVISION_UNRESOLVED:${item.productId}`); continue; }
    const primary = object(sources.pricing?.data.primary), bakery = object(sources.pricing?.data.bakery);
    const pPrice = primary?.[item.productId], bPrice = bakery?.[item.productId];
    if ((p.data.division === 'primary' && bPrice !== undefined) || (p.data.division === 'bakery' && pPrice !== undefined)) { findings.push(`PRICING_DIVISION_CONFLICT:${item.productId}`); continue; }
    const custom = p.data.division === 'primary' ? pPrice : bPrice;
    if (sources.pricing && !sources.pricing.updateTime) { findings.push(`PRICING_REVISION_MISSING:${item.productId}`); continue; }
    if (item.overrideId !== undefined) { findings.push(`OVERRIDE_EVIDENCE_UNAVAILABLE:${item.productId}`); continue; }
    const price = pricePaise(custom === undefined ? p.data.price : custom);
    if (price === null) { findings.push(`PRICE_EVIDENCE_INVALID:${item.productId}`); continue; }
    if (!stock.some(s => s.data.productId === item.productId)) findings.push(`STOCK_HISTORY_MISSING:${item.productId}`);
    items.push({ productId: item.productId, quantity: item.quantity, division: p.data.division, unitPricePaise: price, priceSource: custom === undefined ? 'product' : 'customer' });
  }
  findings.push('STOCK_COMPLETENESS_AND_REVISION_UNVERIFIED');
  // Fingerprint only the deterministic, validated facts and source update times; it is not a write precondition.
  const revision = { client: sources.client?.updateTime ?? null, pricing: sources.pricing?.updateTime ?? null, products: products.map(p => [p.id, p.updateTime]), stock: stock.map(s => [s.id, s.updateTime]) };
  const requestedItems = [...request.items].map(i => ({ productId: i.productId, quantity: i.quantity, overrideId: i.overrideId ?? null })).sort((a, b) => a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0);
  const fingerprint = `sha256:${createHash('sha256').update(JSON.stringify({ clientId: request.clientId, requestedItems, items, findings: [...findings].sort(), revision })).digest('hex')}`;
  return { status: 'review-required', items, findings: findings.sort(), fingerprint };
}

/** Unregistered read-only loader. Output must be re-read inside any future write transaction. */
export async function readOrderEvidence(db: admin.firestore.Firestore, authUid: string | undefined, request: OrderEvidenceRequest): Promise<OrderEvidenceResult> {
  await validateAndFetchActiveUser(db, authUid);
  if (!request || !validId(request.clientId) || !Array.isArray(request.items) || !request.items.length || request.items.some(i => !i || !validId(i.productId))) throw new HttpsError('invalid-argument', 'Invalid order evidence request');
  return db.runTransaction(async tx => {
    const convert = (s: admin.firestore.DocumentSnapshot): EvidenceDocument | null => s.exists ? { id: s.id, data: s.data()!, updateTime: s.updateTime?.toDate().toISOString() ?? null } : null;
    const client = convert(await tx.get(db.collection('clients').doc(request.clientId)));
    const pricing = convert(await tx.get(db.collection('clientPricing').doc(request.clientId)));
    const products: EvidenceDocument[] = [], stock: EvidenceDocument[] = [];
    for (const item of request.items) {
      const p = convert(await tx.get(db.collection('products').doc(item.productId))); if (p) products.push(p);
      const rows = await tx.get(db.collection('finishedStockTransactions').where('productId', '==', item.productId));
      for (const row of rows.docs) { const s = convert(row); if (s) stock.push(s); }
    }
    return buildOrderEvidence(request, { client, pricing, products, stock });
  }, { readOnly: true });
}
