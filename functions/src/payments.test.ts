import { describe, it, expect } from 'vitest';
import {
  handleRecordPayment,
  handleCorrectPayment,
  type RecordPaymentPayload,
  type CorrectPaymentPayload,
} from './payments';
import { type AuthenticatedUser } from './authValidation';

interface MockStore {
  clients: Record<string, any>;
  orders: Record<string, any>;
  payments: Record<string, any>;
  ledger: Record<string, any>;
}

function createMockPaymentsFirestore(initialData: Partial<MockStore> = {}) {
  const store: MockStore = {
    clients: { ...(initialData.clients || {}) },
    orders: { ...(initialData.orders || {}) },
    payments: { ...(initialData.payments || {}) },
    ledger: { ...(initialData.ledger || {}) },
  };

  const firestore = {
    _store: store,
    collection: (colName: string) => {
      const colStore = (store as any)[colName] || {};
      return {
        doc: (id?: string) => {
          const docId = id || `generated_${Math.random().toString(36).substring(2, 9)}`;
          return {
            id: docId,
            get: async () => {
              if (docId in colStore) {
                return { exists: true, id: docId, ref: { id: docId }, data: () => ({ ...colStore[docId] }) };
              }
              return { exists: false, id: docId, ref: { id: docId }, data: () => undefined };
            },
            set: async (data: any) => {
              colStore[docId] = { ...data };
            },
            update: async (data: any) => {
              if (!(docId in colStore)) throw new Error(`Document ${colName}/${docId} not found`);
              colStore[docId] = { ...colStore[docId], ...data };
            },
          };
        },
        where: (field: string, op: string, val: any) => {
          let docs = Object.entries(colStore).map(([id, data]: [string, any]) => ({
            id,
            ref: { id },
            data: () => ({ ...data }),
          }));

          const applyFilter = (f: string, o: string, v: any) => {
            if (o === '==') {
              docs = docs.filter((d) => d.data()[f] === v);
            } else if (o === 'in') {
              docs = docs.filter((d) => Array.isArray(v) && v.includes(d.data()[f]));
            }
          };

          applyFilter(field, op, val);

          return {
            where: (f2: string, o2: string, v2: any) => {
              applyFilter(f2, o2, v2);
              return {
                get: async () => ({ docs }),
              };
            },
            get: async () => ({ docs }),
          };
        },
      };
    },
    runTransaction: async (updateFunction: (transaction: any) => Promise<any>) => {
      const transaction = {
        get: async (target: any) => {
          if (typeof target.get === 'function') {
            return await target.get();
          }
          throw new Error('Unsupported transaction.get target');
        },
        set: (docRef: any, data: any) => {
          const colName = docRef.id.startsWith('pay_') ? 'payments' : (docRef.id.startsWith('client_') ? 'clients' : 'ledger');
          // Fallback to storing in appropriate collection
          if (docRef.id in store.payments || 'amount' in data && 'appliedAmount' in data && !('type' in data)) {
            store.payments[docRef.id] = { ...data };
          } else if ('type' in data && data.type === 'payment') {
            store.ledger[docRef.id] = { ...data };
          } else {
            store.orders[docRef.id] = { ...data };
          }
        },
        update: (docRef: any, data: any) => {
          const id = docRef.id;
          if (id in store.clients) {
            store.clients[id] = { ...store.clients[id], ...data };
          } else if (id in store.orders) {
            store.orders[id] = { ...store.orders[id], ...data };
          } else if (id in store.payments) {
            store.payments[id] = { ...store.payments[id], ...data };
          } else if (id in store.ledger) {
            store.ledger[id] = { ...store.ledger[id], ...data };
          } else {
            throw new Error(`Transaction update document ${id} not found in store`);
          }
        },
      };
      return await updateFunction(transaction);
    },
  } as any;

  return firestore;
}

const adminUser: AuthenticatedUser = {
  uid: 'admin_123',
  email: 'admin@dailyfresh.com',
  displayName: 'Admin Manager',
  role: 'admin',
  isActive: true,
};

const staffUser: AuthenticatedUser = {
  uid: 'staff_456',
  email: 'staff@dailyfresh.com',
  displayName: 'Delivery Staff',
  role: 'staff',
  isActive: true,
};

describe('Trusted Server-Side Payments Engine (payments.ts)', () => {
  it('records payment with proportional Primary and Bakery distribution and oldest-invoice-first attribution', async () => {
    const mockDb = createMockPaymentsFirestore({
      clients: {
        client_1: {
          id: 'client_1',
          name: 'Golden Bakery',
          region: 'North',
          totalPaid: 0,
          outstanding: 300,
          rawBalance: 300,
          financialRevision: 1,
          primaryTotals: { openingBalance: 0, totalRevenue: 100, totalPaid: 0, rawBalance: 100 },
          bakeryTotals: { openingBalance: 0, totalRevenue: 200, totalPaid: 0, rawBalance: 200 },
        },
      },
      orders: {
        order_primary_1: {
          id: 'order_primary_1',
          clientId: 'client_1',
          division: 'primary',
          deliveryDate: '2026-03-10',
          orderedAt: '2026-03-09T10:00:00.000Z',
          total: 100,
          paidAmount: 0,
          creditApplied: 0,
          paymentStatus: 'pending',
        },
        order_bakery_1: {
          id: 'order_bakery_1',
          clientId: 'client_1',
          division: 'bakery',
          deliveryDate: '2026-03-10',
          orderedAt: '2026-03-09T10:05:00.000Z',
          total: 200,
          paidAmount: 0,
          creditApplied: 0,
          paymentStatus: 'pending',
        },
      },
    });

    const payload: RecordPaymentPayload = {
      clientId: 'client_1',
      amount: 150,
      paymentDate: '2026-03-10',
      billDate: '2026-03-10',
      method: 'cash',
      idempotencyKey: 'pay_idem_key_001',
    };

    const result = await handleRecordPayment(mockDb, staffUser, payload);

    expect(result.success).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.paymentId).toBe('pay_idem_key_001');

    // Expected proportional 1:2 split on ₹150: Primary gets ₹50, Bakery gets ₹100
    expect(result.primaryAllocated).toBe(50);
    expect(result.bakeryAllocated).toBe(100);
    expect(result.excessCredit).toBe(0);

    // Verify order paid amounts
    const updatedPrimary = mockDb._store.orders.order_primary_1;
    const updatedBakery = mockDb._store.orders.order_bakery_1;
    expect(updatedPrimary.paidAmount).toBe(50);
    expect(updatedPrimary.paymentStatus).toBe('partial');
    expect(updatedBakery.paidAmount).toBe(100);
    expect(updatedBakery.paymentStatus).toBe('partial');

    // Verify client financial revision and totals
    const updatedClient = mockDb._store.clients.client_1;
    expect(updatedClient.totalPaid).toBe(150);
    expect(updatedClient.outstanding).toBe(150);
    expect(updatedClient.financialRevision).toBe(2);
    expect(updatedClient.primaryTotals.totalPaid).toBe(50);
    expect(updatedClient.bakeryTotals.totalPaid).toBe(100);

    // Verify payment document stored
    const savedPayment = mockDb._store.payments.pay_idem_key_001;
    expect(savedPayment).toBeDefined();
    expect(savedPayment.amount).toBe(150);
    expect(savedPayment.primaryAllocated).toBe(50);
    expect(savedPayment.bakeryAllocated).toBe(100);
    expect(savedPayment.excessCredit).toBe(0);
  });

  it('handles duplicate retry idempotently without double-posting', async () => {
    const mockDb = createMockPaymentsFirestore({
      clients: {
        client_1: {
          id: 'client_1',
          name: 'Golden Bakery',
          financialRevision: 2,
          totalPaid: 150,
          outstanding: 150,
        },
      },
      payments: {
        pay_idem_key_001: {
          id: 'pay_idem_key_001',
          clientId: 'client_1',
          amount: 150,
          primaryAllocated: 50,
          bakeryAllocated: 100,
          excessCredit: 0,
        },
      },
    });

    const payload: RecordPaymentPayload = {
      clientId: 'client_1',
      amount: 150,
      idempotencyKey: 'pay_idem_key_001',
      method: 'cash',
    };

    const result = await handleRecordPayment(mockDb, staffUser, payload);
    expect(result.success).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(result.paymentId).toBe('pay_idem_key_001');
    expect(result.primaryAllocated).toBe(50);
    expect(result.bakeryAllocated).toBe(100);

    // Conflict with different amount throws error
    await expect(
      handleRecordPayment(mockDb, staffUser, {
        ...payload,
        amount: 200,
      })
    ).rejects.toThrow(/Duplicate idempotencyKey/);
  });

  it('correctly handles advance payments where payment exceeds unpaid obligations with integer-paise conservation', async () => {
    const mockDb = createMockPaymentsFirestore({
      clients: {
        client_1: {
          id: 'client_1',
          name: 'Golden Bakery',
          financialRevision: 1,
          totalPaid: 0,
          outstanding: 100,
          rawBalance: 100,
          primaryTotals: { totalRevenue: 100, totalPaid: 0, openingBalance: 0 },
          bakeryTotals: { totalRevenue: 0, totalPaid: 0, openingBalance: 0 },
        },
      },
      orders: {
        order_primary_1: {
          id: 'order_primary_1',
          clientId: 'client_1',
          division: 'primary',
          deliveryDate: '2026-03-10',
          orderedAt: '2026-03-09T10:00:00.000Z',
          total: 100,
          paidAmount: 0,
          paymentStatus: 'pending',
        },
      },
    });

    const payload: RecordPaymentPayload = {
      clientId: 'client_1',
      amount: 250, // ₹100 settles order, ₹150 is excess advance credit
      paymentDate: '2026-03-10',
      idempotencyKey: 'pay_idem_advance_001',
      method: 'upi',
    };

    const result = await handleRecordPayment(mockDb, staffUser, payload);
    expect(result.success).toBe(true);
    expect(result.primaryAllocated).toBe(100);
    expect(result.bakeryAllocated).toBe(0);
    expect(result.excessCredit).toBe(150);

    // Invariant check: primaryAllocated + bakeryAllocated + excessCredit === amount
    expect(result.primaryAllocated + result.bakeryAllocated + result.excessCredit).toBe(250);

    // Client balances
    const client = mockDb._store.clients.client_1;
    expect(client.outstanding).toBe(0);
    expect(client.credit).toBe(150);
    expect(client.generalCredit).toBe(150);
    expect(client.rawBalance).toBe(-150);
    expect(client.financialRevision).toBe(2);
  });

  it('strictly rejects payment allocation when client has unresolved opening balance', async () => {
    const mockDb = createMockPaymentsFirestore({
      clients: {
        client_1: {
          id: 'client_1',
          name: 'Golden Bakery',
          hasUnresolvedOpeningBalance: true, // Requires explicit admin review
          outstanding: 500,
        },
      },
      orders: {
        order_1: {
          id: 'order_1',
          clientId: 'client_1',
          division: 'primary',
          deliveryDate: '2026-03-10',
          orderedAt: '2026-03-09T10:00:00.000Z',
          total: 500,
          paidAmount: 0,
          paymentStatus: 'pending',
        },
      },
    });

    const payload: RecordPaymentPayload = {
      clientId: 'client_1',
      amount: 100,
      paymentDate: '2026-03-10',
      idempotencyKey: 'pay_idem_unresolved_001',
      method: 'cash',
    };

    await expect(handleRecordPayment(mockDb, staffUser, payload)).rejects.toThrow(
      /unresolved legacy opening balances/i
    );
  });

  it('accurately reverses invoice attributions and re-allocates on payment correction (Admin only)', async () => {
    const mockDb = createMockPaymentsFirestore({
      clients: {
        client_1: {
          id: 'client_1',
          name: 'Golden Bakery',
          financialRevision: 2,
          totalPaid: 200,
          outstanding: 100,
          rawBalance: 100,
          primaryTotals: { totalRevenue: 300, totalPaid: 200, openingBalance: 0 },
          bakeryTotals: { totalRevenue: 0, totalPaid: 0, openingBalance: 0 },
        },
      },
      orders: {
        order_1: {
          id: 'order_1',
          clientId: 'client_1',
          division: 'primary',
          deliveryDate: '2026-03-10',
          orderedAt: '2026-03-09T10:00:00.000Z',
          total: 300,
          paidAmount: 200,
          paymentStatus: 'partial',
        },
      },
      payments: {
        pay_to_correct: {
          id: 'pay_to_correct',
          clientId: 'client_1',
          amount: 200,
          primaryAllocated: 200,
          bakeryAllocated: 0,
          excessCredit: 0,
          paymentDate: '2026-03-10',
          attributions: [
            {
              invoiceId: 'order_1',
              division: 'primary',
              deliveryDate: '2026-03-10',
              amountPaise: 20000,
              amount: 200,
            },
          ],
        },
      },
    });

    // Correction: Correct recorded payment down from ₹200 to ₹100
    const correctionPayload: CorrectPaymentPayload = {
      paymentId: 'pay_to_correct',
      newAmount: 100,
      correctionReason: 'Data entry typo: Customer paid 100, not 200.',
    };

    // Non-admin should be rejected
    await expect(
      handleCorrectPayment(mockDb, staffUser, correctionPayload)
    ).rejects.toThrow(/Only Admins are authorized/);

    // Admin should succeed
    const result = await handleCorrectPayment(mockDb, adminUser, correctionPayload);

    expect(result.success).toBe(true);
    expect(result.originalAmount).toBe(200);
    expect(result.newAmount).toBe(100);
    expect(result.financialRevision).toBe(3);

    // Verify order attribution reversed and re-allocated to ₹100
    const updatedOrder = mockDb._store.orders.order_1;
    expect(updatedOrder.paidAmount).toBe(100);
    expect(updatedOrder.paymentStatus).toBe('partial');

    // Verify client total paid decreased by ₹100, outstanding increased to ₹200
    const updatedClient = mockDb._store.clients.client_1;
    expect(updatedClient.totalPaid).toBe(100);
    expect(updatedClient.outstanding).toBe(200);
    expect(updatedClient.financialRevision).toBe(3);

    // Verify audit trail on payment document
    const updatedPayment = mockDb._store.payments.pay_to_correct;
    expect(updatedPayment.amount).toBe(100);
    expect(updatedPayment.isCorrected).toBe(true);
    expect(updatedPayment.originalAmount).toBe(200);
    expect(updatedPayment.correctionReason).toBe('Data entry typo: Customer paid 100, not 200.');
    expect(updatedPayment.correctionHistory).toHaveLength(1);
    expect(updatedPayment.correctionHistory[0].attributionsReversed[0].amountPaise).toBe(20000);
    expect(updatedPayment.correctionHistory[0].newAttributions[0].amountPaise).toBe(10000);
  });

  it('creates direct sale order and required payment atomically in one trusted transaction', async () => {
    const mockDb = createMockPaymentsFirestore();

    const payload: RecordPaymentPayload = {
      orderType: 'direct',
      clientId: 'direct',
      amount: 150,
      method: 'cash',
      paymentDate: '2026-03-15',
      billDate: '2026-03-15',
      idempotencyKey: 'pay_direct_atomicity_test_1',
      directSale: {
        date: '2026-03-15',
        division: 'primary',
        items: [
          {
            productId: 'prod_kuboos',
            productName: 'Kuboos',
            qty: 15,
            unitPrice: 10,
            total: 150,
          },
        ],
        notes: 'Counter retail sale',
      },
    };

    const result = await handleRecordPayment(mockDb, staffUser, payload);

    expect(result.success).toBe(true);
    expect(result.orderId).toBe('dir_pay_direct_atomicity_test_1');
    expect(result.paymentId).toBe('pay_direct_atomicity_test_1');
    expect(result.duplicate).toBe(false);

    // Verify order document created atomically
    const orderDoc = mockDb._store.orders['dir_pay_direct_atomicity_test_1'];
    expect(orderDoc).toBeDefined();
    expect(orderDoc.total).toBe(150);
    expect(orderDoc.paidAmount).toBe(150);
    expect(orderDoc.paymentStatus).toBe('paid');
    expect(orderDoc.orderType).toBe('direct');

    // Verify payment document created atomically in same transaction
    const paymentDoc = mockDb._store.payments['pay_direct_atomicity_test_1'];
    expect(paymentDoc).toBeDefined();
    expect(paymentDoc.amount).toBe(150);
    expect(paymentDoc.invoiceId).toBe('dir_pay_direct_atomicity_test_1');
    expect(paymentDoc.orderType).toBe('direct');

    // Verify idempotent replay: second call with same key returns committed record without recreating
    const replayResult = await handleRecordPayment(mockDb, staffUser, payload);
    expect(replayResult.success).toBe(true);
    expect(replayResult.duplicate).toBe(true);
    expect(replayResult.orderId).toBe('dir_pay_direct_atomicity_test_1');
  });

  it('rejects direct sale when payment exceeds order total', async () => {
    const mockDb = createMockPaymentsFirestore();

    const payload: RecordPaymentPayload = {
      orderType: 'direct',
      clientId: 'direct',
      amount: 200, // exceeds total 150
      method: 'cash',
      idempotencyKey: 'pay_direct_overpay_test',
      directSale: {
        date: '2026-03-15',
        division: 'primary',
        items: [
          {
            productId: 'prod_kuboos',
            productName: 'Kuboos',
            qty: 15,
            unitPrice: 10,
            total: 150,
          },
        ],
      },
    };

    await expect(handleRecordPayment(mockDb, staffUser, payload)).rejects.toThrow(
      /cannot exceed direct sale total/
    );
  });
});
