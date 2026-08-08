import { create } from 'zustand';
import { type Unsubscribe, type FirestoreError } from 'firebase/firestore';
import { subscribeToStockCollection, STOCK_COLLECTIONS } from '../services/stockDb';
import type {
  RawMaterial, RawMaterialTransaction, ProductMaterial,
  Production, FinishedStockTransaction, StockSyncStatus
} from '../types/stock.types';

interface StockState {
  rawMaterials: RawMaterial[];
  rawMaterialTransactions: RawMaterialTransaction[];
  productMaterials: ProductMaterial[];
  productions: Production[];
  finishedStockTransactions: FinishedStockTransaction[];
  stockSyncStatus: StockSyncStatus[];
  isInitialized: boolean;
  listenerError: string | null;
  clearListenerError: () => void;
  initialize: () => () => void;
}

export const useStockStore = create<StockState>((set, get) => ({
  rawMaterials: [],
  rawMaterialTransactions: [],
  productMaterials: [],
  productions: [],
  finishedStockTransactions: [],
  stockSyncStatus: [],
  isInitialized: false,
  listenerError: null,

  clearListenerError: () => set({ listenerError: null }),

  initialize: () => {
    // Prevent duplicate initialization
    if (get().isInitialized) return () => {};

    let unsubs: Unsubscribe[] = [];

    const handleError = (col: string) => (err: FirestoreError) => {
      console.error(`[StockStore] ${col}:`, err.code, err.message);
      set({ listenerError: `Stock data sync failed for "${col}" (${err.code}). Please refresh.` });
    };

    const unsubRM = subscribeToStockCollection(
      STOCK_COLLECTIONS.RAW_MATERIALS,
      (data) => set({ rawMaterials: data as RawMaterial[] }),
      handleError('rawMaterials')
    );
    const unsubRMT = subscribeToStockCollection(
      STOCK_COLLECTIONS.RAW_MATERIAL_TRANSACTIONS,
      (data) => set({ rawMaterialTransactions: data as RawMaterialTransaction[] }),
      handleError('rawMaterialTransactions')
    );
    const unsubPM = subscribeToStockCollection(
      STOCK_COLLECTIONS.PRODUCT_MATERIALS,
      (data) => set({ productMaterials: data as ProductMaterial[] }),
      handleError('productMaterials')
    );
    const unsubProd = subscribeToStockCollection(
      STOCK_COLLECTIONS.PRODUCTIONS,
      (data) => set({ productions: data as Production[] }),
      handleError('productions')
    );
    const unsubFST = subscribeToStockCollection(
      STOCK_COLLECTIONS.FINISHED_STOCK_TRANSACTIONS,
      (data) => set({ finishedStockTransactions: data as FinishedStockTransaction[] }),
      handleError('finishedStockTransactions')
    );
    const unsubSync = subscribeToStockCollection(
      STOCK_COLLECTIONS.STOCK_SYNC_STATUS,
      (data) => set({ stockSyncStatus: data as StockSyncStatus[] }),
      handleError('stockSyncStatus')
    );

    unsubs = [unsubRM, unsubRMT, unsubPM, unsubProd, unsubFST, unsubSync];
    set({ isInitialized: true });

    return () => unsubs.forEach(u => u());
  },
}));
