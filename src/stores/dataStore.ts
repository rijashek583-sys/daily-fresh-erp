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
  /** Set when any Firestore realtime listener fails. Null when syncing normally. */
  listenerError: string | null;
  clearListenerError: () => void;
  initialize: () => () => void;
}

export const useDataStore = create<DataState>((set) => ({
  clients: [],
  products: [],
  orders: [],
  payments: [],
  regions: [],
  clientPricing: {},
  trash: [],
  ledger: [],
  isLoaded: false,
  listenerError: null,

  clearListenerError: () => set({ listenerError: null }),

  initialize: () => {
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

    const unsubPayments = subscribeToCollection(
      COLLECTIONS.PAYMENTS,
      (data) => set({ payments: data as Payment[] }),
      handleListenerError('payments')
    );

    const unsubPricing = subscribeToCollection(
      COLLECTIONS.PRICING,
      (data) => {
        const pricingMap: Record<string, Record<string, number>> = {};
        data.forEach((doc: any) => {
          pricingMap[doc.id] = { ...(doc.all || {}), ...(doc.primary || {}), ...(doc.bakery || {}) };
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
      (data) => set({ ledger: data }),
      handleListenerError('ledger')
    );

    unsubs = [unsubClients, unsubProducts, unsubOrders, unsubPayments, unsubPricing, unsubRegions, unsubTrash, unsubLedger];

    // Mark as loaded (in reality, we might want to wait for all initial payloads, but this is fine for realtime)
    setTimeout(() => set({ isLoaded: true }), 500);

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }
}));
