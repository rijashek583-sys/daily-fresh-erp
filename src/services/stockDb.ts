import {
  collection, doc, setDoc, updateDoc, onSnapshot, query, where,
  getDocs, writeBatch, runTransaction, type FirestoreError, limit
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { toast } from 'sonner';
import { useAuthStore } from '../stores/authStore';
import { useDataStore } from '../stores/dataStore';
import { getProductDivision } from '../lib/utils';
import type {
  RawMaterial, RawMaterialTransaction, RawMaterialTransactionType,
  ProductMaterial, Production, ProductionMaterialUsed,
  FinishedStockTransaction, FinishedStockTransactionType, StockSyncStatus
} from '../types/stock.types';

// ─── Collection names ─────────────────────────────────────────────────────────
export const STOCK_COLLECTIONS = {
  RAW_MATERIALS: 'rawMaterials',
  RAW_MATERIAL_TRANSACTIONS: 'rawMaterialTransactions',
  PRODUCT_MATERIALS: 'productMaterials',
  PRODUCTIONS: 'productions',
  FINISHED_STOCK_TRANSACTIONS: 'finishedStockTransactions',
  STOCK_SYNC_STATUS: 'stockSyncStatus',
};

function enforceAdmin() {
  const user = useAuthStore.getState().user;
  if (!user || user.role !== 'admin') throw new Error('Unauthorized: Admin access required');
}

function currentUid(): string {
  return useAuthStore.getState().user?.uid || 'system';
}

function todayStr(): string {
  return new Date().toISOString().substring(0, 10);
}

// ─── Subscribe helpers ────────────────────────────────────────────────────────

export function subscribeToStockCollection(
  collectionName: string,
  callback: (data: any[]) => void,
  onError?: (e: FirestoreError) => void
) {
  return onSnapshot(
    query(collection(db, collectionName)),
    snap => callback(snap.docs.map(d => ({ ...d.data(), id: d.id }))),
    err => { console.error(`[Stock] ${collectionName}:`, err); onError?.(err); }
  );
}

// ─── Raw Material CRUD ────────────────────────────────────────────────────────

export async function addRawMaterial(data: Omit<RawMaterial, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>): Promise<string> {
  enforceAdmin();
  const ref = doc(collection(db, STOCK_COLLECTIONS.RAW_MATERIALS));
  const now = new Date().toISOString();
  await setDoc(ref, { ...data, id: ref.id, createdAt: now, updatedAt: now, createdBy: currentUid() });
  return ref.id;
}

export async function updateRawMaterial(id: string, updates: Partial<Pick<RawMaterial, 'name' | 'unit' | 'status'>>): Promise<void> {
  enforceAdmin();
  await updateDoc(doc(db, STOCK_COLLECTIONS.RAW_MATERIALS, id), { ...updates, updatedAt: new Date().toISOString() });
}

// ─── Raw Material Stock Transactions ─────────────────────────────────────────

export async function addRawMaterialStock(params: {
  rawMaterialId: string;
  rawMaterialName: string;
  unit: string;
  type: 'opening' | 'purchase' | 'adjustment';
  sign: 1 | -1;
  qty: number;
  reference: string;
  notes?: string;
  date?: string;
}): Promise<void> {
  enforceAdmin();
  const ref = doc(collection(db, STOCK_COLLECTIONS.RAW_MATERIAL_TRANSACTIONS));
  const now = new Date().toISOString();
  const record: RawMaterialTransaction = {
    id: ref.id,
    rawMaterialId: params.rawMaterialId,
    rawMaterialName: params.rawMaterialName,
    unit: params.unit,
    type: params.type,
    sign: params.sign,
    qty: params.qty,
    signedQty: params.sign * params.qty,
    productionId: null,
    reference: params.reference,
    notes: params.notes || null,
    date: params.date || todayStr(),
    createdAt: now,
    createdBy: currentUid(),
  };
  await setDoc(ref, record);
}

// ─── Product Material Mapping ─────────────────────────────────────────────────

export async function saveProductMaterials(productId: string, productName: string, materials: ProductMaterial['materials']): Promise<void> {
  enforceAdmin();
  const ref = doc(db, STOCK_COLLECTIONS.PRODUCT_MATERIALS, productId);
  await setDoc(ref, {
    productId,
    productName,
    materials,
    updatedAt: new Date().toISOString(),
    updatedBy: currentUid(),
  });
}

// ─── Production CRUD ──────────────────────────────────────────────────────────

export async function addProduction(data: {
  date: string;
  productId: string;
  productName: string;
  division: string;
  producedQty: number;
  producedUnit: string;
  materialsUsed: ProductionMaterialUsed[];
  notes: string | null;
}): Promise<string> {
  enforceAdmin();
  const now = new Date().toISOString();
  const prodRef = doc(collection(db, STOCK_COLLECTIONS.PRODUCTIONS));
  const productionId = prodRef.id;

  const batch = writeBatch(db);

  // 1. Write the production document
  batch.set(prodRef, {
    ...data,
    id: productionId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: currentUid(),
  });

  // 2. Deduct raw materials
  for (const mat of data.materialsUsed) {
    if (!mat.usedQty || mat.usedQty <= 0) continue;
    const idKey = `production_usage::${productionId}::${mat.rawMaterialId}`;
    const rmtRef = doc(collection(db, STOCK_COLLECTIONS.RAW_MATERIAL_TRANSACTIONS));
    const rmRecord: RawMaterialTransaction = {
      id: rmtRef.id,
      rawMaterialId: mat.rawMaterialId,
      rawMaterialName: mat.rawMaterialName,
      unit: mat.unit,
      type: 'production_usage',
      sign: -1,
      qty: mat.usedQty,
      signedQty: -mat.usedQty,
      productionId,
      reference: `Production: ${data.productName} (${productionId.slice(-6)})`,
      notes: null,
      date: data.date,
      createdAt: now,
      createdBy: currentUid(),
    };
    // Idempotency key stored as doc id prefix isn't practical with auto-ids.
    // We store the idempotency key as a field and will query it on edit/delete.
    // For initial creation, we trust the batch is atomic.
    batch.set(rmtRef, { ...rmRecord, idempotencyKey: idKey });
  }

  // 3. Add finished stock
  const fstRef = doc(collection(db, STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS));
  const fstRecord: FinishedStockTransaction = {
    id: fstRef.id,
    productId: data.productId,
    productName: data.productName,
    division: data.division,
    type: 'production',
    sign: 1,
    qty: data.producedQty,
    signedQty: data.producedQty,
    productionId,
    orderId: null,
    orderUpdatedAt: null,
    clientId: null,
    clientName: null,
    idempotencyKey: `production::${productionId}::${data.productId}`,
    reference: `Production: ${data.productName} (${productionId.slice(-6)})`,
    date: data.date,
    createdAt: now,
    createdBy: currentUid(),
  };
  batch.set(fstRef, fstRecord);

  await batch.commit();
  return productionId;
}

export async function editProduction(
  productionId: string,
  original: Production,
  updates: {
    date: string;
    producedQty: number;
    materialsUsed: ProductionMaterialUsed[];
    notes: string | null;
  }
): Promise<void> {
  enforceAdmin();
  const now = new Date().toISOString();
  const editTs = now;
  const batch = writeBatch(db);

  // 1. Reverse old finished stock addition
  const fstRevRef = doc(collection(db, STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS));
  batch.set(fstRevRef, {
    id: fstRevRef.id,
    productId: original.productId,
    productName: original.productName,
    division: original.division,
    type: 'production_reversal',
    sign: -1,
    qty: original.producedQty,
    signedQty: -original.producedQty,
    productionId,
    orderId: null,
    orderUpdatedAt: null,
    clientId: null,
    clientName: null,
    idempotencyKey: `production_reversal::${productionId}::${original.productId}::${editTs}`,
    reference: `Edit reversal: ${original.productName} (${productionId.slice(-6)})`,
    date: original.date,
    createdAt: now,
    createdBy: currentUid(),
  });

  // 2. Reverse old raw material deductions
  for (const mat of original.materialsUsed) {
    if (!mat.usedQty || mat.usedQty <= 0) continue;
    const rmtRevRef = doc(collection(db, STOCK_COLLECTIONS.RAW_MATERIAL_TRANSACTIONS));
    batch.set(rmtRevRef, {
      id: rmtRevRef.id,
      rawMaterialId: mat.rawMaterialId,
      rawMaterialName: mat.rawMaterialName,
      unit: mat.unit,
      type: 'production_reversal' as RawMaterialTransactionType,
      sign: 1,
      qty: mat.usedQty,
      signedQty: mat.usedQty,
      productionId,
      reference: `Edit reversal: ${original.productName}`,
      notes: null,
      date: original.date,
      createdAt: now,
      createdBy: currentUid(),
      idempotencyKey: `production_reversal_rm::${productionId}::${mat.rawMaterialId}::${editTs}`,
    });
  }

  // 3. Update the production document
  batch.update(doc(db, STOCK_COLLECTIONS.PRODUCTIONS, productionId), {
    ...updates,
    updatedAt: now,
  });

  // 4. Write new finished stock addition
  const fstNewRef = doc(collection(db, STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS));
  batch.set(fstNewRef, {
    id: fstNewRef.id,
    productId: original.productId,
    productName: original.productName,
    division: original.division,
    type: 'production',
    sign: 1,
    qty: updates.producedQty,
    signedQty: updates.producedQty,
    productionId,
    orderId: null,
    orderUpdatedAt: null,
    clientId: null,
    clientName: null,
    idempotencyKey: `production::${productionId}::${original.productId}::${editTs}`,
    reference: `Production (edited): ${original.productName}`,
    date: updates.date,
    createdAt: now,
    createdBy: currentUid(),
  });

  // 5. Write new raw material deductions
  for (const mat of updates.materialsUsed) {
    if (!mat.usedQty || mat.usedQty <= 0) continue;
    const rmtNewRef = doc(collection(db, STOCK_COLLECTIONS.RAW_MATERIAL_TRANSACTIONS));
    batch.set(rmtNewRef, {
      id: rmtNewRef.id,
      rawMaterialId: mat.rawMaterialId,
      rawMaterialName: mat.rawMaterialName,
      unit: mat.unit,
      type: 'production_usage' as RawMaterialTransactionType,
      sign: -1,
      qty: mat.usedQty,
      signedQty: -mat.usedQty,
      productionId,
      reference: `Production (edited): ${original.productName}`,
      notes: null,
      date: updates.date,
      createdAt: now,
      createdBy: currentUid(),
      idempotencyKey: `production_usage::${productionId}::${mat.rawMaterialId}::${editTs}`,
    });
  }

  await batch.commit();
}

export async function deleteProduction(production: Production, deletedBy: string): Promise<void> {
  enforceAdmin();
  const now = new Date().toISOString();
  const editTs = now;
  const batch = writeBatch(db);

  // 1. Reverse finished stock
  const fstRevRef = doc(collection(db, STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS));
  batch.set(fstRevRef, {
    id: fstRevRef.id,
    productId: production.productId,
    productName: production.productName,
    division: production.division,
    type: 'production_reversal',
    sign: -1,
    qty: production.producedQty,
    signedQty: -production.producedQty,
    productionId: production.id,
    orderId: null, orderUpdatedAt: null, clientId: null, clientName: null,
    idempotencyKey: `production_reversal::${production.id}::${production.productId}::delete::${editTs}`,
    reference: `Delete: ${production.productName} (${production.id.slice(-6)})`,
    date: production.date,
    createdAt: now,
    createdBy: currentUid(),
  });

  // 2. Reverse raw material deductions
  for (const mat of production.materialsUsed) {
    if (!mat.usedQty || mat.usedQty <= 0) continue;
    const rmtRevRef = doc(collection(db, STOCK_COLLECTIONS.RAW_MATERIAL_TRANSACTIONS));
    batch.set(rmtRevRef, {
      id: rmtRevRef.id,
      rawMaterialId: mat.rawMaterialId,
      rawMaterialName: mat.rawMaterialName,
      unit: mat.unit,
      type: 'production_reversal' as RawMaterialTransactionType,
      sign: 1,
      qty: mat.usedQty,
      signedQty: mat.usedQty,
      productionId: production.id,
      reference: `Delete: ${production.productName}`,
      notes: null,
      date: production.date,
      createdAt: now,
      createdBy: currentUid(),
      idempotencyKey: `production_reversal_rm::${production.id}::${mat.rawMaterialId}::delete::${editTs}`,
    });
  }

  // 3. Move production to trash (following existing trash pattern)
  const trashRef = doc(db, 'trash', production.id);
  batch.set(trashRef, {
    originalCollection: STOCK_COLLECTIONS.PRODUCTIONS,
    originalDocumentId: production.id,
    originalData: production,
    deletedAt: now,
    deletedBy,
  });

  // 4. Delete from productions collection
  batch.delete(doc(db, STOCK_COLLECTIONS.PRODUCTIONS, production.id));

  await batch.commit();
}

export async function restoreProduction(trashDocId: string, trashData: any): Promise<void> {
  enforceAdmin();
  if (trashData.originalCollection !== STOCK_COLLECTIONS.PRODUCTIONS) return;
  const production: Production = trashData.originalData;
  const now = new Date().toISOString();
  const restoreTs = now;
  const batch = writeBatch(db);

  // 1. Restore the production document
  batch.set(doc(db, STOCK_COLLECTIONS.PRODUCTIONS, production.id), { ...production, status: 'active', updatedAt: now });
  batch.delete(doc(db, 'trash', trashDocId));

  // 2. Re-write finished stock addition
  const fstRef = doc(collection(db, STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS));
  batch.set(fstRef, {
    id: fstRef.id,
    productId: production.productId,
    productName: production.productName,
    division: production.division,
    type: 'production',
    sign: 1,
    qty: production.producedQty,
    signedQty: production.producedQty,
    productionId: production.id,
    orderId: null, orderUpdatedAt: null, clientId: null, clientName: null,
    idempotencyKey: `production::${production.id}::${production.productId}::restore::${restoreTs}`,
    reference: `Restored: ${production.productName}`,
    date: production.date,
    createdAt: now,
    createdBy: currentUid(),
  });

  // 3. Re-write raw material deductions
  for (const mat of production.materialsUsed) {
    if (!mat.usedQty || mat.usedQty <= 0) continue;
    const rmtRef = doc(collection(db, STOCK_COLLECTIONS.RAW_MATERIAL_TRANSACTIONS));
    batch.set(rmtRef, {
      id: rmtRef.id,
      rawMaterialId: mat.rawMaterialId,
      rawMaterialName: mat.rawMaterialName,
      unit: mat.unit,
      type: 'production_usage' as RawMaterialTransactionType,
      sign: -1,
      qty: mat.usedQty,
      signedQty: -mat.usedQty,
      productionId: production.id,
      reference: `Restored: ${production.productName}`,
      notes: null,
      date: production.date,
      createdAt: now,
      createdBy: currentUid(),
      idempotencyKey: `production_usage::${production.id}::${mat.rawMaterialId}::restore::${restoreTs}`,
    });
  }

  await batch.commit();
  toast.success('Production restored successfully');
}

// ─── Finished Stock — Opening & Adjustment ────────────────────────────────────

export async function addFinishedStockTransaction(params: {
  productId: string;
  productName: string;
  division: string;
  type: 'opening' | 'adjustment';
  sign: 1 | -1;
  qty: number;
  notes?: string;
  date?: string;
}): Promise<void> {
  enforceAdmin();
  const now = new Date().toISOString();
  const ref = doc(collection(db, STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS));
  const record: FinishedStockTransaction = {
    id: ref.id,
    productId: params.productId,
    productName: params.productName,
    division: params.division,
    type: params.type,
    sign: params.sign,
    qty: params.qty,
    signedQty: params.sign * params.qty,
    productionId: null,
    orderId: null,
    orderUpdatedAt: null,
    clientId: null,
    clientName: null,
    idempotencyKey: `${params.type}::${params.productId}::${now}`,
    reference: params.type === 'opening' ? 'Opening Stock' : `Adjustment`,
    date: params.date || todayStr(),
    createdAt: now,
    createdBy: currentUid(),
  };
  await setDoc(ref, { ...record, notes: params.notes || null });
}

// ─── Order Integration Functions ──────────────────────────────────────────────

/**
 * Creates finished stock deductions for an order.
 * Idempotent: checks existing records by idempotencyKey before writing.
 * versionKey = order.createdAt (new order) or restoreTimestamp (restore).
 */
export async function createFinishedStockDeductionsForOrder(params: {
  orderId: string;
  clientId: string;
  clientName: string;
  items: Array<{ productId: string; productName: string; qty: number }>;
  deliveryDate: string;
  division: string; // order-level division
  versionKey: string;
}): Promise<void> {
  const { orderId, clientId, clientName, items, deliveryDate, division, versionKey } = params;
  if (!items || items.length === 0) return;

  const now = new Date().toISOString();
  const { products } = useDataStore.getState();
  const uid = currentUid();

  // Pre-query existing idempotency keys for this order to avoid duplicates
  const existingSnap = await getDocs(
    query(collection(db, STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS), where('orderId', '==', orderId))
  );
  const existingKeys = new Set(existingSnap.docs.map(d => d.data().idempotencyKey as string));

  const batch = writeBatch(db);
  let hasWrites = false;

  for (const item of items) {
    if (!item.qty || item.qty <= 0) continue;

    const idKey = `order_deduction::${orderId}::${item.productId}::${versionKey}`;
    if (existingKeys.has(idKey)) continue; // Already written — idempotent skip

    // Resolve product division
    const product = products.find(p => p.id === item.productId);
    const itemDivision = (division === 'all')
      ? getProductDivision(product || { name: item.productName })
      : (division || 'primary');

    const ref = doc(collection(db, STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS));
    batch.set(ref, {
      id: ref.id,
      productId: item.productId,
      productName: item.productName,
      division: itemDivision,
      type: 'order_deduction' as FinishedStockTransactionType,
      sign: -1,
      qty: item.qty,
      signedQty: -item.qty,
      productionId: null,
      orderId,
      orderUpdatedAt: versionKey,
      clientId,
      clientName,
      idempotencyKey: idKey,
      reference: `Order: ${clientName} (${orderId.slice(-6)})`,
      date: deliveryDate.substring(0, 10),
      createdAt: now,
      createdBy: uid,
    } as FinishedStockTransaction);
    hasWrites = true;
  }

  // Write / update stockSyncStatus
  const syncRef = doc(db, STOCK_COLLECTIONS.STOCK_SYNC_STATUS, orderId);
  const existingSyncSnap = await getDocs(
    query(collection(db, STOCK_COLLECTIONS.STOCK_SYNC_STATUS), where('orderId', '==', orderId), limit(1))
  );
  const attemptCount = existingSyncSnap.empty ? 1 : ((existingSyncSnap.docs[0].data().attemptCount || 0) + 1);

  batch.set(syncRef, {
    orderId,
    synced: true,
    syncedAt: now,
    lastAttemptAt: now,
    attemptCount,
    error: null,
  } as StockSyncStatus, { merge: true });

  await batch.commit();
  console.log(`[Stock] Order ${orderId}: ${hasWrites ? 'deductions written' : 'already synced (idempotent)'}`);
}

/**
 * Adjusts finished stock when an order is edited.
 * Writes reversals for the old version, then new deductions for the new version.
 * Immutable: no records are deleted. All changes are expressed as new signed records.
 */
export async function adjustFinishedStockForOrderUpdate(params: {
  orderId: string;
  clientId: string;
  clientName: string;
  oldItems: Array<{ productId: string; productName: string; qty: number }>;
  oldUpdatedAt: string;
  newItems: Array<{ productId: string; productName: string; qty: number }>;
  newUpdatedAt: string;
  deliveryDate: string;
  division: string;
}): Promise<void> {
  const { orderId, clientId, clientName, oldItems, oldUpdatedAt, newItems, newUpdatedAt, deliveryDate, division } = params;
  const now = new Date().toISOString();
  const uid = currentUid();
  const { products } = useDataStore.getState();

  // Pre-query existing keys for this order
  const existingSnap = await getDocs(
    query(collection(db, STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS), where('orderId', '==', orderId))
  );
  const existingKeys = new Set(existingSnap.docs.map(d => d.data().idempotencyKey as string));

  const batch = writeBatch(db);

  const resolveDiv = (item: { productId: string; productName: string }) => {
    if (division !== 'all') return division || 'primary';
    const product = products.find(p => p.id === item.productId);
    return getProductDivision(product || { name: item.productName });
  };

  // Write reversals for old items
  for (const item of oldItems) {
    if (!item.qty || item.qty <= 0) continue;
    const revKey = `order_reversal::${orderId}::${item.productId}::${oldUpdatedAt}::reversal`;
    if (existingKeys.has(revKey)) continue;
    const ref = doc(collection(db, STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS));
    batch.set(ref, {
      id: ref.id,
      productId: item.productId,
      productName: item.productName,
      division: resolveDiv(item),
      type: 'order_reversal' as FinishedStockTransactionType,
      sign: 1,
      qty: item.qty,
      signedQty: item.qty,
      productionId: null,
      orderId,
      orderUpdatedAt: oldUpdatedAt,
      clientId,
      clientName,
      idempotencyKey: revKey,
      reference: `Edit reversal: ${clientName} (${orderId.slice(-6)})`,
      date: deliveryDate.substring(0, 10),
      createdAt: now,
      createdBy: uid,
    } as FinishedStockTransaction);
  }

  // Write new deductions for new items
  for (const item of newItems) {
    if (!item.qty || item.qty <= 0) continue;
    const dedKey = `order_deduction::${orderId}::${item.productId}::${newUpdatedAt}`;
    if (existingKeys.has(dedKey)) continue;
    const ref = doc(collection(db, STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS));
    batch.set(ref, {
      id: ref.id,
      productId: item.productId,
      productName: item.productName,
      division: resolveDiv(item),
      type: 'order_deduction' as FinishedStockTransactionType,
      sign: -1,
      qty: item.qty,
      signedQty: -item.qty,
      productionId: null,
      orderId,
      orderUpdatedAt: newUpdatedAt,
      clientId,
      clientName,
      idempotencyKey: dedKey,
      reference: `Order (edited): ${clientName} (${orderId.slice(-6)})`,
      date: deliveryDate.substring(0, 10),
      createdAt: now,
      createdBy: uid,
    } as FinishedStockTransaction);
  }

  // Update stockSyncStatus
  const syncRef = doc(db, STOCK_COLLECTIONS.STOCK_SYNC_STATUS, orderId);
  batch.set(syncRef, {
    orderId,
    synced: true,
    syncedAt: now,
    lastAttemptAt: now,
    error: null,
  }, { merge: true });

  await batch.commit();
}

/**
 * Reverses finished stock deductions when an order is trashed.
 * Writes order_reversal records (immutable — no deletes).
 */
export async function reverseFinishedStockForOrder(params: {
  orderId: string;
  clientId: string;
  clientName: string;
  items: Array<{ productId: string; productName: string; qty: number }>;
  orderUpdatedAt: string;
  deliveryDate: string;
  division: string;
}): Promise<void> {
  const { orderId, clientId, clientName, items, orderUpdatedAt, deliveryDate, division } = params;
  if (!items || items.length === 0) return;

  const now = new Date().toISOString();
  const uid = currentUid();
  const { products } = useDataStore.getState();

  const existingSnap = await getDocs(
    query(collection(db, STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS), where('orderId', '==', orderId))
  );
  const existingKeys = new Set(existingSnap.docs.map(d => d.data().idempotencyKey as string));

  const batch = writeBatch(db);

  for (const item of items) {
    if (!item.qty || item.qty <= 0) continue;
    const revKey = `order_reversal::${orderId}::${item.productId}::${orderUpdatedAt}::trash`;
    if (existingKeys.has(revKey)) continue;

    const itemDivision = (division === 'all')
      ? getProductDivision(products.find(p => p.id === item.productId) || { name: item.productName })
      : (division || 'primary');

    const ref = doc(collection(db, STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS));
    batch.set(ref, {
      id: ref.id,
      productId: item.productId,
      productName: item.productName,
      division: itemDivision,
      type: 'order_reversal' as FinishedStockTransactionType,
      sign: 1,
      qty: item.qty,
      signedQty: item.qty,
      productionId: null,
      orderId,
      orderUpdatedAt,
      clientId,
      clientName,
      idempotencyKey: revKey,
      reference: `Order deleted: ${clientName} (${orderId.slice(-6)})`,
      date: deliveryDate.substring(0, 10),
      createdAt: now,
      createdBy: uid,
    } as FinishedStockTransaction);
  }

  // Update stockSyncStatus to reflect trashed state
  batch.set(doc(db, STOCK_COLLECTIONS.STOCK_SYNC_STATUS, orderId), {
    orderId, synced: true, syncedAt: now, lastAttemptAt: now, error: null, type: 'trashed'
  }, { merge: true });

  await batch.commit();
}

// ─── Balance Computation (Pure — reads from Zustand store state) ──────────────

/**
 * Returns current raw material balance from rawMaterialTransactions in the stock store.
 * Call this from the component context after stockStore is initialized.
 */
export function getRawMaterialBalance(
  rawMaterialId: string,
  transactions: RawMaterialTransaction[]
): number {
  return transactions
    .filter(t => t.rawMaterialId === rawMaterialId)
    .reduce((sum, t) => sum + (t.signedQty || 0), 0);
}

/**
 * Returns current finished stock balance for a product.
 */
export function getFinishedStockBalance(
  productId: string,
  transactions: FinishedStockTransaction[]
): number {
  return transactions
    .filter(t => t.productId === productId)
    .reduce((sum, t) => sum + (t.signedQty || 0), 0);
}

/**
 * Returns finished stock balance BEFORE a given date (for production planning).
 */
export function getFinishedStockBalanceBeforeDate(
  productId: string,
  date: string,
  transactions: FinishedStockTransaction[]
): number {
  return transactions
    .filter(t => t.productId === productId && t.date < date)
    .reduce((sum, t) => sum + (t.signedQty || 0), 0);
}

/**
 * Returns total produced qty for a product on a given date.
 */
export function getTodayProductionQty(
  productId: string,
  date: string,
  productions: Production[]
): number {
  return productions
    .filter(p => p.productId === productId && p.date === date && p.status === 'active')
    .reduce((sum, p) => sum + p.producedQty, 0);
}

/**
 * Returns total ordered qty for a product on a given delivery date.
 */
export function getTodayOrderQty(productId: string, date: string): number {
  const { orders } = useDataStore.getState();
  return orders
    .filter(o => o.deliveryDate === date)
    .reduce((sum, o) => {
      const item = o.items.find(i => i.productId === productId);
      return sum + (item?.qty || 0);
    }, 0);
}
