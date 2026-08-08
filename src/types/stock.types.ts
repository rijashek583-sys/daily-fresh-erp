// ─── Stock & Production Types ─────────────────────────────────────────────────
// These types are additive — they do not modify any existing type.

export type RawMaterialUnit = 'KG' | 'Gram' | 'Litre' | 'Piece' | 'Box';

export interface RawMaterial {
  id: string;
  name: string;
  unit: RawMaterialUnit;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export type RawMaterialTransactionType =
  | 'opening'
  | 'purchase'
  | 'production_usage'
  | 'production_reversal'
  | 'adjustment';

export interface RawMaterialTransaction {
  id: string;
  rawMaterialId: string;
  rawMaterialName: string;
  unit: string;
  type: RawMaterialTransactionType;
  sign: 1 | -1;
  qty: number;
  signedQty: number; // sign × qty — pre-computed for SUM
  productionId: string | null;
  reference: string;
  notes: string | null;
  date: string; // 'yyyy-MM-dd'
  createdAt: string;
  createdBy: string;
}

export interface ProductMaterialItem {
  rawMaterialId: string;
  rawMaterialName: string;
  unit: string;
  defaultQty: number | null; // nullable — never used to override actual entry
}

export interface ProductMaterial {
  productId: string;
  productName: string;
  materials: ProductMaterialItem[];
  updatedAt: string;
  updatedBy: string;
}

export interface ProductionMaterialUsed {
  rawMaterialId: string;
  rawMaterialName: string;
  usedQty: number;
  unit: string;
}

export interface Production {
  id: string;
  date: string; // 'yyyy-MM-dd'
  productId: string;
  productName: string;
  division: string;
  producedQty: number;
  producedUnit: string;
  materialsUsed: ProductionMaterialUsed[];
  notes: string | null;
  status: 'active' | 'deleted';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export type FinishedStockTransactionType =
  | 'opening'
  | 'production'
  | 'production_reversal'
  | 'order_deduction'
  | 'order_reversal'
  | 'adjustment';

export interface FinishedStockTransaction {
  id: string;
  productId: string;
  productName: string;
  division: string;
  type: FinishedStockTransactionType;
  sign: 1 | -1;
  qty: number;
  signedQty: number; // sign × qty
  productionId: string | null;
  orderId: string | null;
  orderUpdatedAt: string | null; // version discriminator for idempotency
  clientId: string | null;
  clientName: string | null;
  idempotencyKey: string;
  reference: string;
  date: string; // 'yyyy-MM-dd'
  createdAt: string;
  createdBy: string;
}

export interface StockSyncStatus {
  orderId: string;
  synced: boolean;
  syncedAt: string | null;
  lastAttemptAt: string;
  attemptCount: number;
  error: string | null;
}
