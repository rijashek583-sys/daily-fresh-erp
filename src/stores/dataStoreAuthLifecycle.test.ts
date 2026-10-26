import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FirestoreError } from 'firebase/firestore';

// Mock the db service layer before importing dataStore
const mockUnsubscribes: Record<string, ReturnType<typeof vi.fn>> = {};
const capturedErrorHandlers: Record<string, ((error: FirestoreError) => void) | undefined> = {};
const capturedDataCallbacks: Record<string, ((data: any) => void) | undefined> = {};

vi.mock('../services/db', () => ({
  COLLECTIONS: {
    CLIENTS: 'clients',
    PRODUCTS: 'products',
    ORDERS: 'orders',
    PAYMENTS: 'payments',
    REGIONS: 'regions',
    PRICING: 'clientPricing',
  },
  subscribeToCollection: vi.fn((collectionName: string, callback: (data: any[]) => void, onError?: (error: FirestoreError) => void) => {
    const unsub = vi.fn();
    mockUnsubscribes[collectionName] = unsub;
    capturedErrorHandlers[collectionName] = onError;
    capturedDataCallbacks[collectionName] = callback;
    return unsub;
  }),
  subscribeToRegions: vi.fn((callback: (regions: string[]) => void, onError?: (error: FirestoreError) => void) => {
    const unsub = vi.fn();
    mockUnsubscribes['regions'] = unsub;
    capturedErrorHandlers['regions'] = onError;
    capturedDataCallbacks['regions'] = callback;
    return unsub;
  }),
}));

// Import after mocking
import { useDataStore } from './dataStore';
import { subscribeToCollection, subscribeToRegions } from '../services/db';

describe('DataStore Startup & Authentication Lifecycle Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockUnsubscribes).forEach((k) => delete mockUnsubscribes[k]);
    Object.keys(capturedErrorHandlers).forEach((k) => delete capturedErrorHandlers[k]);
    Object.keys(capturedDataCallbacks).forEach((k) => delete capturedDataCallbacks[k]);

    // Reset store state
    useDataStore.setState({
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
    });
  });

  // ---------------------------------------------------------------------------
  // 1. Initial State / Before Authentication
  // ---------------------------------------------------------------------------
  it('does not have active data subscriptions before initialize() is called', () => {
    const state = useDataStore.getState();
    expect(state.isInitialized).toBe(false);
    expect(state.isLoaded).toBe(false);
    expect(state.listenerError).toBeNull();
    expect(subscribeToCollection).not.toHaveBeenCalled();
    expect(subscribeToRegions).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 2. Authorized Initialization
  // ---------------------------------------------------------------------------
  it('initializes all core subscriptions and marks isInitialized as true for authorized users', () => {
    const cleanup = useDataStore.getState().initialize();

    expect(useDataStore.getState().isInitialized).toBe(true);
    expect(subscribeToRegions).toHaveBeenCalledTimes(1);
    expect(subscribeToCollection).toHaveBeenCalledTimes(7); // clients, products, orders, payments, pricing, trash, ledger

    expect(mockUnsubscribes['clients']).toBeDefined();
    expect(mockUnsubscribes['products']).toBeDefined();
    expect(mockUnsubscribes['orders']).toBeDefined();
    expect(mockUnsubscribes['payments']).toBeDefined();
    expect(mockUnsubscribes['clientPricing']).toBeDefined();
    expect(mockUnsubscribes['regions']).toBeDefined();
    expect(mockUnsubscribes['trash']).toBeDefined();
    expect(mockUnsubscribes['ledger']).toBeDefined();

    cleanup();
  });

  // ---------------------------------------------------------------------------
  // 3. Logout / Account Change Cleanup
  // ---------------------------------------------------------------------------
  it('unsubscribes all listeners and resets isInitialized when cleanup is invoked', () => {
    const cleanup = useDataStore.getState().initialize();
    expect(useDataStore.getState().isInitialized).toBe(true);

    const clientUnsub = mockUnsubscribes['clients'];
    const regionsUnsub = mockUnsubscribes['regions'];
    const ordersUnsub = mockUnsubscribes['orders'];

    // Simulate logout / user change triggering useEffect cleanup
    cleanup();

    expect(clientUnsub).toHaveBeenCalledTimes(1);
    expect(regionsUnsub).toHaveBeenCalledTimes(1);
    expect(ordersUnsub).toHaveBeenCalledTimes(1);
    expect(useDataStore.getState().isInitialized).toBe(false);
    expect(useDataStore.getState().isLoaded).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 4. Duplicate Subscription Prevention
  // ---------------------------------------------------------------------------
  it('prevents duplicate listener subscriptions when initialize() is called multiple times', () => {
    const cleanup1 = useDataStore.getState().initialize();
    expect(subscribeToRegions).toHaveBeenCalledTimes(1);
    expect(subscribeToCollection).toHaveBeenCalledTimes(7);

    // Call initialize again without cleaning up first
    const cleanup2 = useDataStore.getState().initialize();

    // Call counts must NOT increase
    expect(subscribeToRegions).toHaveBeenCalledTimes(1);
    expect(subscribeToCollection).toHaveBeenCalledTimes(7);

    // Calling cleanup2 is safe and does not double-unsubscribe
    cleanup2();
    cleanup1();
  });

  // ---------------------------------------------------------------------------
  // 5. Error Reporting & Stale Error Clearing
  // ---------------------------------------------------------------------------
  it('captures genuine listener permission-denied errors and surfaces them in listenerError', () => {
    const cleanup = useDataStore.getState().initialize();

    // Simulate Firestore emitting a permission-denied error on the regions listener
    const regionsErrorHandler = capturedErrorHandlers['regions'];
    expect(regionsErrorHandler).toBeDefined();

    const mockFirestoreError = {
      code: 'permission-denied',
      message: 'Missing or insufficient permissions.',
      name: 'FirebaseError',
    } as FirestoreError;

    regionsErrorHandler!(mockFirestoreError);

    expect(useDataStore.getState().listenerError).toBe(
      'Data sync failed for "regions" (permission-denied). Please refresh the page.'
    );

    cleanup();
  });

  it('clears stale listenerError when a fresh authorized initialization begins', () => {
    // 1. Trigger an error
    const cleanup1 = useDataStore.getState().initialize();
    const regionsErrorHandler = capturedErrorHandlers['regions'];
    regionsErrorHandler!({
      code: 'permission-denied',
      message: 'Denied',
      name: 'FirebaseError',
    } as FirestoreError);

    expect(useDataStore.getState().listenerError).not.toBeNull();
    cleanup1();

    // 2. Fresh login / re-initialization
    const cleanup2 = useDataStore.getState().initialize();
    expect(useDataStore.getState().listenerError).toBeNull();

    cleanup2();
  });

  it('allows manual dismissal via clearListenerError', () => {
    const cleanup = useDataStore.getState().initialize();
    capturedErrorHandlers['clients']!({
      code: 'unavailable',
      message: 'Network down',
      name: 'FirebaseError',
    } as FirestoreError);

    expect(useDataStore.getState().listenerError).toContain('clients');

    useDataStore.getState().clearListenerError();
    expect(useDataStore.getState().listenerError).toBeNull();

    cleanup();
  });
});
