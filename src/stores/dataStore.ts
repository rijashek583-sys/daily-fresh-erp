import { create } from 'zustand';
import { Client, Product, Order, Payment, Region } from '../types';
import { subscribeToCollection, subscribeToRegions, COLLECTIONS } from '../services/db';
import { type Unsubscribe, type FirestoreError } from 'firebase/firestore';

interface DataState {
  clients: Client[];
  products: Product[];
  orders: Order[];
  payments: Payment[];
  regions: Region[];
  clientPricing: Record<string, Record<string, number>>;
  trash: any[];
  ledger: any[];
  isLoaded: boolean;
  isInitialized: boolean;
  /** Set when any Firestore realtime listener fails. Null when syncing normally. */
  listenerError: string | null;
  clearListenerError: () => void;
  initialize: () => () => void;
}

export const useDataStore = create<DataState>((set, get) => ({
  clients: [],
  products: [],
  orders: [],
  payments: [],
  regions: [],
  clientPricing: {},
  trash: [],
  ledger: [],
  isLoaded: false,
  isInitialized: false,
  listenerError: null,

  clearListenerError: () => set({ listenerError: null }),

  initialize: () => {
    // Prevent duplicate subscriptions if already initialized
    if (get().isInitialized) {
      return () => {};
    }

    // Reset any stale listener error on a fresh authorized initialization
    set({ listenerError: null, isInitialized: true });

    let unsubs: Unsubscribe[] = [];

    /**
     * Shared error handler for all Firestore realtime listeners.
     * Surfaces the first failure in the UI via listenerError instead of
     * silently swallowing errors and showing stale / empty data.
     */
    const handleListenerError = (collectionName: string) => (error: FirestoreError) => {
      console.error(`Firestore listener error [${collectionName}]:`, error.code, error.message);
      set({
        listenerError: `Data sync failed for "${collectionName}" (${error.code}). Please refresh the page.`
      });
    };

    const unsubClients = subscribeToCollection(
      COLLECTIONS.CLIENTS,
      (data) => set({ clients: data as Client[] }),
      handleListenerError('clients')
    );

    const unsubProducts = subscribeToCollection(
      COLLECTIONS.PRODUCTS,
      (data) => set({ products: data as Product[] }),
      handleListenerError('products')
    );

    const unsubOrders = subscribeToCollection(
      COLLECTIONS.ORDERS,
      (data) => set({ orders: data as Order[] }),
      handleListenerError('orders')
    );

    let latestPayments: Payment[] = [];
    let latestLedger: any[] = [];

    const reconcilePayments = () => {
      const merged: Payment[] = [...latestPayments];
      const seenIds = new Set(latestPayments.map(p => p.id));

      for (const l of latestLedger) {
        if (l.type !== 'payment') continue;
        const pId = l.paymentId || l.id;
        if (seenIds.has(pId) || seenIds.has(l.id)) continue;
        seenIds.add(pId);
        merged.push({
          id: pId,
          clientId: l.clientId || '',
          clientName: l.clientName || '',
          orderType: l.clientId === 'direct' ? 'direct' : 'client',
          region: l.region || '',
          invoiceId: l.invoiceId || null,
          amount: l.amount || 0,
          appliedAmount: l.appliedAmount,
          appliedToPrevious: l.appliedToPrevious,
          excessCredit: l.excessCredit,
          isAdvance: l.isAdvance,
          method: (l.paymentMethod || 'cash') as any,
          reference: l.reference || null,
          notes: l.description || null,
          billDate: l.billDate || null,
          paymentDate: l.paymentDate || l.createdAt,
          createdAt: l.createdAt || l.paymentDate,
          staffId: l.staffId,
          staffName: l.staffName || l.recordedBy,
          recordedBy: l.recordedBy || l.staffName,
          updatedBy: l.recordedBy || l.staffName,
          division: (l.division === 'bakery' ? 'bakery' : 'primary') as any,
        });
      }
      set({ payments: merged });
    };

    const unsubPayments = subscribeToCollection(
      COLLECTIONS.PAYMENTS,
      (data) => {
        latestPayments = data as Payment[];
        reconcilePayments();
      },
      handleListenerError('payments')
    );

    const unsubPricing = subscribeToCollection(
      COLLECTIONS.PRICING,
      (data) => {
        const pricingMap: Record<string, Record<string, number>> = {};
        data.forEach((doc: any) => {
          // Direct numeric price keys on the document (if any)
          const directPrices: Record<string, number> = {};
          Object.keys(doc).forEach(k => {
            if (!['id', 'clientId', 'createdAt', 'updatedAt', 'pricing', 'all', 'primary', 'bakery'].includes(k) && typeof doc[k] === 'number') {
              directPrices[k] = doc[k];
            }
          });
          // Merge doc.pricing, doc.all, doc.primary, doc.bakery (with division-specific overrides if applicable)
          pricingMap[doc.id] = {
            ...directPrices,
            ...(doc.pricing || {}),
            ...(doc.all || {}),
            ...(doc.primary || {}),
            ...(doc.bakery || {})
          };
        });
        set({ clientPricing: pricingMap });
      },
      handleListenerError('clientPricing')
    );

    const unsubRegions = subscribeToRegions(
      (data) => set({ regions: data }),
      handleListenerError('regions')
    );

    const unsubTrash = subscribeToCollection(
      'trash',
      (data) => set({ trash: data }),
      handleListenerError('trash')
    );

    const unsubLedger = subscribeToCollection(
      'ledger',
      (data) => {
        latestLedger = data;
        set({ ledger: data });
        reconcilePayments();
      },
      handleListenerError('ledger')
    );

    unsubs = [unsubClients, unsubProducts, unsubOrders, unsubPayments, unsubPricing, unsubRegions, unsubTrash, unsubLedger];

    // Mark as loaded (in reality, we might want to wait for all initial payloads, but this is fine for realtime)
    setTimeout(() => set({ isLoaded: true }), 500);

    return () => {
      unsubs.forEach(unsub => unsub());
      unsubs = [];
      set({ isInitialized: false, isLoaded: false });
    };
  }
}));
