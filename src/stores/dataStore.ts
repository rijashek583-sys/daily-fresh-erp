import { create } from 'zustand';
import { Client, Product, Order, Payment, Region } from '../types';
import { subscribeToCollection, subscribeToRegions, COLLECTIONS } from '../services/db';
import { Unsubscribe } from 'firebase/firestore';

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

  initialize: () => {
    let unsubs: Unsubscribe[] = [];

    const unsubClients = subscribeToCollection(COLLECTIONS.CLIENTS, (data) => {
      set({ clients: data as Client[] });
    });
    
    const unsubProducts = subscribeToCollection(COLLECTIONS.PRODUCTS, (data) => {
      set({ products: data as Product[] });
    });

    const unsubOrders = subscribeToCollection(COLLECTIONS.ORDERS, (data) => {
      set({ orders: data as Order[] });
    });

    const unsubPayments = subscribeToCollection(COLLECTIONS.PAYMENTS, (data) => {
      set({ payments: data as Payment[] });
    });

    const unsubPricing = subscribeToCollection(COLLECTIONS.PRICING, (data) => {
      const pricingMap: Record<string, Record<string, number>> = {};
      data.forEach((doc: any) => {
        pricingMap[doc.id] = doc.pricing || {};
      });
      set({ clientPricing: pricingMap });
    });

    const unsubRegions = subscribeToRegions((data) => {
      set({ regions: data });
    });

    const unsubTrash = subscribeToCollection('trash', (data) => {
      set({ trash: data });
    });

    const unsubLedger = subscribeToCollection('ledger', (data) => {
      set({ ledger: data });
    });

    unsubs = [unsubClients, unsubProducts, unsubOrders, unsubPayments, unsubPricing, unsubRegions, unsubTrash, unsubLedger];

    // Mark as loaded (in reality, we might want to wait for all initial payloads, but this is fine for realtime)
    setTimeout(() => set({ isLoaded: true }), 500);

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }
}));
