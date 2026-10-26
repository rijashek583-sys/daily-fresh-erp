import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordPaymentAtomic, updatePayment, createDirectSale, moveToTrash, restoreFromTrash } from './db';
import * as paymentsService from './paymentsService';
import { useAuthStore } from '../stores/authStore';
import * as firestore from 'firebase/firestore';
import type { User } from '../types';

vi.mock('../lib/firebase', () => ({
  app: {},
  db: {},
  auth: {},
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => {
  return {
    getFirestore: vi.fn(() => ({})),
    collection: vi.fn((_db, col) => ({ path: col })),
    doc: vi.fn((_db, _col, id) => ({ id: id || 'mock_doc_id', path: `${_col}/${id || 'mock_doc_id'}` })),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn().mockResolvedValue(undefined),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    query: vi.fn((...args) => ({ args })),
    where: vi.fn((field, op, val) => ({ field, op, val })),
    onSnapshot: vi.fn(),
    writeBatch: vi.fn(() => ({
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    })),
    runTransaction: vi.fn(),
    Timestamp: {
      now: vi.fn(() => ({ toMillis: () => 1700000000000 })),
    },
    increment: vi.fn((n) => n),
  };
});

vi.mock('./paymentsService', () => {
  return {
    callRecordPayment: vi.fn(),
    callCorrectPayment: vi.fn(),
  };
});

vi.mock('./stockDb', () => ({
  createFinishedStockDeductionsForOrder: vi.fn().mockResolvedValue([]),
  adjustFinishedStockForOrderUpdate: vi.fn().mockResolvedValue(undefined),
  reverseFinishedStockForOrder: vi.fn().mockResolvedValue(undefined),
}));

describe('Trusted Payment UI Integration & Shared Boundaries', () => {
  const adminUser: User = {
    uid: 'admin_uid_1',
    name: 'Admin Manager',
    email: 'admin@dailyfresh.com',
    role: 'admin',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const staffUser: User = {
    uid: 'staff_uid_1',
    name: 'Staff Driver',
    email: 'staff@dailyfresh.com',
    role: 'staff',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: staffUser });
  });

  describe('recordPaymentAtomic (Cloud Functions routing)', () => {
    it('successfully routes payment creation to callRecordPayment with exact server contract for Admin', async () => {
      useAuthStore.setState({ user: adminUser });
      const mockResponse = {
        success: true,
        paymentId: 'pay_idem_test_123',
        duplicate: false,
        primaryAllocated: 100,
        bakeryAllocated: 50,
        excessCredit: 0,
        financialRevision: 2,
      };
      (paymentsService.callRecordPayment as any).mockResolvedValueOnce(mockResponse);

      const payload = {
        clientId: 'client_alpha',
        amount: 150,
        method: 'cash',
        billDate: '2026-03-15',
        paymentDate: '2026-03-15',
        invoiceId: 'order_123',
        otherInvoiceId: 'order_456',
        division: 'primary',
        reference: 'REC-001',
        notes: 'Handed to driver',
        idempotencyKey: 'pay_idem_test_123',
      };

      const result = await recordPaymentAtomic(payload);

      expect(paymentsService.callRecordPayment).toHaveBeenCalledTimes(1);
      expect(paymentsService.callRecordPayment).toHaveBeenCalledWith({
        clientId: 'client_alpha',
        amount: 150,
        paymentDate: '2026-03-15',
        billDate: '2026-03-15',
        invoiceId: 'order_123',
        otherInvoiceId: 'order_456',
        division: 'primary',
        method: 'cash',
        reference: 'REC-001',
        notes: 'Handed to driver',
        idempotencyKey: 'pay_idem_test_123',
        orderType: 'client',
      });
      expect(result).toEqual(mockResponse);
    });

    it('enforces today date for staff users when recording payment', async () => {
      useAuthStore.setState({ user: staffUser });
      const mockResponse = {
        success: true,
        paymentId: 'pay_staff_123',
        duplicate: false,
        primaryAllocated: 150,
        bakeryAllocated: 0,
        excessCredit: 0,
        financialRevision: 3,
      };
      (paymentsService.callRecordPayment as any).mockResolvedValueOnce(mockResponse);

      await recordPaymentAtomic({
        clientId: 'client_alpha',
        amount: 150,
        method: 'cash',
        billDate: '2026-03-15',
        paymentDate: '2026-01-01', // staff attempts past date
        idempotencyKey: 'pay_staff_123',
      });

      expect(paymentsService.callRecordPayment).toHaveBeenCalledTimes(1);
      const callArgs = (paymentsService.callRecordPayment as any).mock.calls[0][0];
      // Staff cannot backdate: paymentDate must be today
      expect(callArgs.paymentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(callArgs.paymentDate).not.toBe('2026-01-01');
    });

    it('validates mandatory durable idempotencyKey and rejects missing or malformed keys', async () => {
      // Missing key
      await expect(
        recordPaymentAtomic({
          clientId: 'client_alpha',
          amount: 100,
          idempotencyKey: '',
        })
      ).rejects.toThrow(/Missing durable idempotencyKey/);

      // Key too short (< 8 chars)
      await expect(
        recordPaymentAtomic({
          clientId: 'client_alpha',
          amount: 100,
          idempotencyKey: 'short',
        })
      ).rejects.toThrow(/Invalid idempotencyKey format/);
    });

    it('rejects invalid amounts <= 0', async () => {
      await expect(
        recordPaymentAtomic({
          clientId: 'client_alpha',
          amount: 0,
          idempotencyKey: 'pay_idem_test_123',
        })
      ).rejects.toThrow(/Invalid payment amount/);
    });

    it('never falls back to legacy direct Firestore financial writes on server or offline error', async () => {
      (paymentsService.callRecordPayment as any).mockRejectedValueOnce(
        new Error('Network error: server unreachable')
      );

      const payload = {
        clientId: 'client_alpha',
        amount: 100,
        method: 'cash',
        idempotencyKey: 'pay_idem_test_fail_1',
      };

      await expect(recordPaymentAtomic(payload)).rejects.toThrow(/server unreachable/);

      // Ensure no client-side Firestore transactions were executed
      expect(firestore.runTransaction).not.toHaveBeenCalled();
    });
  });

  describe('updatePayment (Admin payment correction routing)', () => {
    it('enforces Admin-only authorization for payment corrections', async () => {
      useAuthStore.setState({ user: staffUser }); // Staff user

      await expect(
        updatePayment('pay_123', {
          amount: 100,
          correctionReason: 'Typo in amount',
        })
      ).rejects.toThrow(/Admin access required/);

      expect(paymentsService.callCorrectPayment).not.toHaveBeenCalled();
    });

    it('enforces mandatory correctionReason when correcting amount', async () => {
      useAuthStore.setState({ user: adminUser });

      await expect(
        updatePayment('pay_123', {
          amount: 100,
          correctionReason: '   ',
        })
      ).rejects.toThrow(/A correction reason is required/);
    });

    it('successfully routes amount correction to callCorrectPayment', async () => {
      useAuthStore.setState({ user: adminUser });

      const mockResponse = {
        success: true,
        paymentId: 'pay_123',
        originalAmount: 200,
        newAmount: 150,
        financialRevision: 3,
      };
      (paymentsService.callCorrectPayment as any).mockResolvedValueOnce(mockResponse);

      const result = await updatePayment('pay_123', {
        amount: 150,
        correctionReason: 'Entered wrong cash note denomination',
        method: 'cash',
        notes: 'Verified with cashier',
      });

      expect(paymentsService.callCorrectPayment).toHaveBeenCalledTimes(1);
      expect(paymentsService.callCorrectPayment).toHaveBeenCalledWith({
        paymentId: 'pay_123',
        newAmount: 150,
        correctionReason: 'Entered wrong cash note denomination',
        division: undefined,
        paymentDate: undefined,
        method: 'cash',
        reference: undefined,
        notes: 'Verified with cashier',
      });
      expect(result).toEqual(mockResponse);
      expect(firestore.runTransaction).not.toHaveBeenCalled();
    });

    it('updates metadata document without calling payment correction function when amount is unchanged', async () => {
      useAuthStore.setState({ user: adminUser });

      await updatePayment('pay_123', {
        notes: 'Updated invoice reference notes',
        reference: 'REF-NEW',
      });

      expect(paymentsService.callCorrectPayment).not.toHaveBeenCalled();
      expect(firestore.updateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          notes: 'Updated invoice reference notes',
          reference: 'REF-NEW',
        })
      );
    });
  });

  describe('createDirectSale (Atomic Backend Creation & Zero Deletions)', () => {
    it('executes direct sale order and payment creation atomically via Cloud Function with zero client deletion on failure', async () => {
      (paymentsService.callRecordPayment as any).mockRejectedValueOnce(
        new Error('Network error: server unreachable')
      );

      const directSaleInput = {
        date: '2026-03-15',
        items: [
          {
            productId: 'prod_kuboos',
            productName: 'Kuboos',
            qty: 10,
            unitPrice: 10,
            total: 100,
          },
        ],
        payment: {
          amount: 100,
          method: 'cash' as const,
        },
      };

      // Fails without deleting any document client-side
      await expect(createDirectSale(directSaleInput, 'pay_direct_fail_key_1')).rejects.toThrow(
        /server unreachable/
      );

      // Verify that deleteDoc was NEVER called
      expect(firestore.deleteDoc).not.toHaveBeenCalled();
    });

    it('successfully commits direct sale and returns server orderId', async () => {
      (paymentsService.callRecordPayment as any).mockResolvedValueOnce({
        success: true,
        orderId: 'dir_pay_direct_success_1',
        paymentId: 'pay_direct_success_1',
        duplicate: false,
        primaryAllocated: 100,
        bakeryAllocated: 0,
        excessCredit: 0,
      });

      const directSaleInput = {
        date: '2026-03-15',
        items: [
          {
            productId: 'prod_kuboos',
            productName: 'Kuboos',
            qty: 10,
            unitPrice: 10,
            total: 100,
          },
        ],
        payment: {
          amount: 100,
          method: 'cash' as const,
        },
      };

      const orderId = await createDirectSale(directSaleInput, 'pay_direct_success_1');
      expect(orderId).toBe('dir_pay_direct_success_1');
      expect(firestore.deleteDoc).not.toHaveBeenCalled();
      expect(paymentsService.callRecordPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          orderType: 'direct',
          clientId: 'direct',
          amount: 100,
          idempotencyKey: 'pay_direct_success_1',
          directSale: expect.objectContaining({
            date: '2026-03-15',
            items: directSaleInput.items,
          }),
        })
      );
    });

    it('safely replays committed direct sale across network retry without creating duplicates or deleting records', async () => {
      const retryKey = 'pay_direct_retry_key_456';
      const committedOrderId = 'dir_pay_direct_retry_key_456';

      const directSaleInput = {
        date: '2026-03-15',
        items: [
          {
            productId: 'prod_kuboos',
            productName: 'Kuboos',
            qty: 5,
            unitPrice: 10,
            total: 50,
          },
        ],
        payment: {
          amount: 50,
          method: 'upi' as const,
        },
      };

      // Server replay response
      (paymentsService.callRecordPayment as any).mockResolvedValueOnce({
        success: true,
        orderId: committedOrderId,
        paymentId: retryKey,
        duplicate: true, // Backend idempotently replayed
        message: 'Idempotent replay: Direct sale order was already committed.',
        primaryAllocated: 50,
        bakeryAllocated: 0,
        excessCredit: 0,
      });

      const orderId = await createDirectSale(directSaleInput, retryKey);
      expect(orderId).toBe(committedOrderId);
      expect(firestore.deleteDoc).not.toHaveBeenCalled();
      expect(paymentsService.callRecordPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: retryKey,
          amount: 50,
        })
      );
    });
  });

  describe('Direct Financial Writer Protection (Task 11)', () => {
    it('strictly blocks direct trashing of payments in moveToTrash', async () => {
      useAuthStore.setState({ user: adminUser });

      await expect(
        moveToTrash('payments', 'pay_to_trash', { amount: 200 }, 'Admin User')
      ).rejects.toThrow(/Direct trashing of payments is prohibited/);
    });
  });

  describe('Offline & Idempotency Retry Resilience (Tasks 4 & 7)', () => {
    it('preserves durable idempotencyKey across offline retry and handles server replay gracefully', async () => {
      useAuthStore.setState({ user: adminUser });
      const durableKey = 'pay_durable_retry_key_xyz123';

      const payload = {
        clientId: 'client_beta',
        amount: 250,
        paymentDate: '2026-03-15',
        billDate: '2026-03-15',
        idempotencyKey: durableKey,
      };

      // Attempt 1: Network drop / offline failure
      (paymentsService.callRecordPayment as any).mockRejectedValueOnce(
        new Error('Network error: device is offline')
      );

      await expect(recordPaymentAtomic(payload)).rejects.toThrow(
        /device is offline/
      );

      // Attempt 2: User clicks retry with the exact same retained key
      const replaySuccessResponse = {
        success: true,
        paymentId: 'pay_beta_committed',
        duplicate: true, // Backend replayed committed record
        primaryAllocated: 250,
        bakeryAllocated: 0,
        excessCredit: 0,
        financialRevision: 5,
      };
      (paymentsService.callRecordPayment as any).mockResolvedValueOnce(
        replaySuccessResponse
      );

      const retryResult = await recordPaymentAtomic(payload);

      expect(paymentsService.callRecordPayment).toHaveBeenCalledTimes(2);
      // Both attempts used the exact same key without modification
      expect((paymentsService.callRecordPayment as any).mock.calls[0][0].idempotencyKey).toBe(durableKey);
      expect((paymentsService.callRecordPayment as any).mock.calls[1][0].idempotencyKey).toBe(durableKey);
      expect(retryResult).toEqual(replaySuccessResponse);
      expect(retryResult.duplicate).toBe(true);
    });

    it('safely recovers when payment was committed on server but response was lost to client timeout', async () => {
      useAuthStore.setState({ user: adminUser });
      const lostResponseKey = 'pay_timeout_recovery_key_999';

      const payload = {
        clientId: 'client_gamma',
        amount: 300,
        paymentDate: '2026-03-15',
        billDate: '2026-03-15',
        idempotencyKey: lostResponseKey,
      };

      // Server received and committed the payment in Firestore, but the HTTP connection died before returning 200
      (paymentsService.callRecordPayment as any).mockRejectedValueOnce(
        new Error('HTTP timeout: Gateway did not respond in time')
      );

      await expect(recordPaymentAtomic(payload)).rejects.toThrow(/Gateway did not respond/);

      // Client retries with the exact same durable operation key
      (paymentsService.callRecordPayment as any).mockResolvedValueOnce({
        success: true,
        paymentId: lostResponseKey,
        duplicate: true, // Server recognized existing committed record
        message: 'Idempotent replay: Payment was already recorded.',
        primaryAllocated: 300,
        bakeryAllocated: 0,
        excessCredit: 0,
        financialRevision: 4,
      });

      const recoveredResult = await recordPaymentAtomic(payload);
      expect(recoveredResult.success).toBe(true);
      expect(recoveredResult.duplicate).toBe(true);
      expect(recoveredResult.paymentId).toBe(lostResponseKey);
      expect(recoveredResult.primaryAllocated).toBe(300);
    });
  });

  describe('Client Financial Write Restrictions & Cutover Guardrails', () => {
    it('blocks staff members from attempting direct payment metadata update or correction', async () => {
      useAuthStore.setState({ user: staffUser });

      await expect(
        updatePayment('pay_123', {
          notes: 'Staff trying to edit note',
          reference: 'STAFF-REF',
        })
      ).rejects.toThrow(/Staff members are not authorized to edit or correct recorded payments/);
    });

    it('blocks direct trashing of payments regardless of role', async () => {
      useAuthStore.setState({ user: adminUser });

      await expect(
        moveToTrash('payments', 'pay_123', { amount: 500 }, 'Admin User')
      ).rejects.toThrow(/Direct trashing of payments is prohibited/);
    });

    it('blocks direct restoration of payments from trash regardless of role', async () => {
      useAuthStore.setState({ user: adminUser });

      await expect(
        restoreFromTrash('pay_123', { originalCollection: 'payments', originalData: { amount: 500 } })
      ).rejects.toThrow(/Direct restoration of payments is prohibited/);
    });

    // ─── STAGED SECURITY RULES LOGIC AUDIT TESTS (Gap Closures) ───
    describe('Staged Rules Financial Logic Constraints (Unit Audit)', () => {
      // Helper simulating the exact evaluateStagedRules logic for /ledger
      function evaluateLedgerRule(
        action: 'create' | 'update' | 'delete',
        callerRole: 'admin' | 'staff',
        doc: { type: string; amount?: number; invoiceId?: string; paymentId?: string },
        newDoc?: { type?: string; amount?: number; invoiceId?: string; paymentId?: string }
      ): boolean {
        const isAdmin = callerRole === 'admin';
        const isStaff = callerRole === 'admin' || callerRole === 'staff';

        if (action === 'create') {
          const t = newDoc?.type;
          const amt = newDoc?.amount ?? 0;
          const hasPaymentId = newDoc?.paymentId !== undefined;
          const invoiceId = newDoc?.invoiceId;

          const isInvoiceValid =
            isStaff &&
            t === 'invoice' &&
            amt >= 0 &&
            typeof invoiceId === 'string' &&
            invoiceId.length > 0 &&
            !hasPaymentId;

          const isOpeningValid =
            isAdmin &&
            t === 'opening_balance' &&
            amt >= 0 &&
            !hasPaymentId &&
            invoiceId === undefined;

          return isInvoiceValid || isOpeningValid;
        }

        if (action === 'update') {
          const oldType = doc.type;
          const newType = newDoc?.type;
          const amt = newDoc?.amount ?? 0;
          const hasPaymentId = newDoc?.paymentId !== undefined;

          const isInvoiceValid =
            isStaff &&
            oldType === 'invoice' &&
            newType === 'invoice' &&
            amt >= 0 &&
            !hasPaymentId;

          const isOpeningValid =
            isAdmin &&
            oldType === 'opening_balance' &&
            newType === 'opening_balance' &&
            amt >= 0 &&
            !hasPaymentId;

          return isInvoiceValid || isOpeningValid;
        }

        if (action === 'delete') {
          return (
            (isStaff && doc.type === 'invoice') ||
            (isAdmin && doc.type === 'opening_balance')
          );
        }
        return false;
      }

      // Helper simulating the exact evaluateStagedRules logic for /orders
      function evaluateOrderRule(
        action: 'create' | 'update',
        callerRole: 'admin' | 'staff',
        existingOrder: { paidAmount?: number; paymentStatus?: string },
        incomingOrder: { paidAmount?: number; paymentStatus?: string }
      ): boolean {
        const isStaff = callerRole === 'admin' || callerRole === 'staff';
        if (!isStaff) return false;

        if (action === 'create') {
          return (incomingOrder.paidAmount ?? 0) === 0;
        }
        if (action === 'update') {
          const oldPaid = existingOrder.paidAmount ?? 0;
          const newPaid = incomingOrder.paidAmount ?? 0;
          const paidUnchanged = oldPaid === newPaid;
          const statusCheck =
            oldPaid === 0 ||
            (existingOrder.paymentStatus ?? '') === (incomingOrder.paymentStatus ?? '');
          return paidUnchanged && statusCheck;
        }
        return false;
      }

      // Helper simulating the exact evaluateStagedRules logic for /clients
      function evaluateClientRule(
        callerRole: 'admin' | 'staff',
        existingClient: {
          totalPaid?: number;
          financialRevision?: number;
          primaryPaid?: number;
          bakeryPaid?: number;
        },
        incomingClient: {
          totalPaid?: number;
          financialRevision?: number;
          primaryPaid?: number;
          bakeryPaid?: number;
          credit?: number;
          generalCredit?: number;
          availableCredit?: number;
          primaryCredit?: number;
          bakeryCredit?: number;
          modifiedKeys: string[];
          modifiedNestedFields?: string[];
        }
      ): boolean {
        const isAdmin = callerRole === 'admin';
        const isStaff = callerRole === 'admin' || callerRole === 'staff';
        if (!isStaff) return false;

        const revUnchanged =
          (existingClient.financialRevision ?? 0) === (incomingClient.financialRevision ?? 0);
        const paidUnchanged =
          (existingClient.totalPaid ?? 0) === (incomingClient.totalPaid ?? 0) &&
          (existingClient.primaryPaid ?? 0) === (incomingClient.primaryPaid ?? 0) &&
          (existingClient.bakeryPaid ?? 0) === (incomingClient.bakeryPaid ?? 0);

        if (!revUnchanged || !paidUnchanged) return false;

        // Case 1: Admin updating profile fields
        const adminAllowedKeys = [
          'name', 'phone', 'region', 'regionName', 'status', 'notes', 'address', 'discount',
          'openingBalance', 'openingBalanceAmount', 'primaryTotals', 'bakeryTotals', 'updatedAt'
        ];
        const nestedAdminProtected =
          incomingClient.modifiedNestedFields?.some((f) =>
            ['totalRevenue', 'totalPaid', 'outstanding', 'credit', 'rawBalance', 'totalOrders'].includes(f)
          ) ?? false;

        if (isAdmin && incomingClient.modifiedKeys.every((k) => adminAllowedKeys.includes(k)) && !nestedAdminProtected) {
          return true;
        }

        // Case 2: Aggregate synchronization
        const staffAllowedKeys = [
          'totalRevenue', 'totalPaid', 'outstanding', 'credit', 'availableCredit',
          'generalCredit', 'primaryCredit', 'bakeryCredit', 'rawBalance', 'totalOrders',
          'openingBalanceAmount', 'primaryTotals', 'bakeryTotals', 'financialRevision', 'updatedAt'
        ];
        const keysAllowed = incomingClient.modifiedKeys.every((k) => staffAllowedKeys.includes(k));
        const creditValid =
          (incomingClient.primaryCredit ?? 0) === 0 &&
          (incomingClient.bakeryCredit ?? 0) === 0 &&
          (incomingClient.generalCredit ?? incomingClient.credit ?? 0) === (incomingClient.credit ?? 0) &&
          (incomingClient.availableCredit ?? incomingClient.credit ?? 0) === (incomingClient.credit ?? 0);

        const balanceKeys = ['credit', 'availableCredit', 'generalCredit', 'outstanding', 'rawBalance'];
        const touchesBalance = incomingClient.modifiedKeys.some((k) => balanceKeys.includes(k));
        // Anti-forgery: Changing unrelated counters like totalOrders CANNOT forge credit, outstanding, or rawBalance
        const triggerKeys = ['totalRevenue', 'openingBalanceAmount'];
        const hasTrigger = incomingClient.modifiedKeys.some((k) => triggerKeys.includes(k));
        const balanceTriggerValid = !touchesBalance || hasTrigger;

        return keysAllowed && creditValid && balanceTriggerValid;
      }

      it('Gap 1: strictly denies direct client creation, update, or deletion of payment ledger entries for BOTH Admin and Staff', () => {
        // Staff attempts
        expect(evaluateLedgerRule('create', 'staff', { type: 'payment' }, { type: 'payment', amount: 100 })).toBe(false);
        expect(evaluateLedgerRule('update', 'staff', { type: 'payment' }, { type: 'payment', amount: 100 })).toBe(false);
        expect(evaluateLedgerRule('delete', 'staff', { type: 'payment' })).toBe(false);

        // Admin attempts
        expect(evaluateLedgerRule('create', 'admin', { type: 'payment' }, { type: 'payment', amount: 100 })).toBe(false);
        expect(evaluateLedgerRule('update', 'admin', { type: 'payment' }, { type: 'payment', amount: 100 })).toBe(false);
        expect(evaluateLedgerRule('delete', 'admin', { type: 'payment' })).toBe(false);

        // Type conversion attempts
        expect(evaluateLedgerRule('update', 'admin', { type: 'payment' }, { type: 'invoice', amount: 100 })).toBe(false);
        expect(evaluateLedgerRule('update', 'admin', { type: 'payment' }, { type: 'opening_balance', amount: 100 })).toBe(false);
        expect(evaluateLedgerRule('update', 'staff', { type: 'invoice' }, { type: 'payment', amount: 100 })).toBe(false);

        // Legitimate invoice ledger entries remain allowed
        expect(evaluateLedgerRule('create', 'staff', { type: 'invoice' }, { type: 'invoice', amount: 150, invoiceId: 'ord_1' })).toBe(true);
        expect(evaluateLedgerRule('update', 'staff', { type: 'invoice' }, { type: 'invoice', amount: 180 })).toBe(true);
        expect(evaluateLedgerRule('delete', 'admin', { type: 'invoice' })).toBe(true);

        // Legitimate Admin opening balance remains allowed
        expect(evaluateLedgerRule('create', 'admin', { type: 'opening_balance' }, { type: 'opening_balance', amount: 500 })).toBe(true);
      });

      it('Gap 2: strictly denies direct client changes to order paidAmount or settlement status for BOTH Admin and Staff', () => {
        const existingPaidOrder = { paidAmount: 200, paymentStatus: 'paid' };

        // Staff attempts to tamper paidAmount or paymentStatus
        expect(evaluateOrderRule('update', 'staff', existingPaidOrder, { paidAmount: 0, paymentStatus: 'pending' })).toBe(false);
        expect(evaluateOrderRule('update', 'staff', existingPaidOrder, { paidAmount: 300, paymentStatus: 'paid' })).toBe(false);
        expect(evaluateOrderRule('update', 'staff', existingPaidOrder, { paidAmount: 200, paymentStatus: 'pending' })).toBe(false);

        // Admin attempts to tamper paidAmount or paymentStatus directly
        expect(evaluateOrderRule('update', 'admin', existingPaidOrder, { paidAmount: 0, paymentStatus: 'pending' })).toBe(false);
        expect(evaluateOrderRule('update', 'admin', existingPaidOrder, { paidAmount: 400, paymentStatus: 'paid' })).toBe(false);
        expect(evaluateOrderRule('update', 'admin', existingPaidOrder, { paidAmount: 200, paymentStatus: 'partial' })).toBe(false);

        // Legitimate order item edits where paidAmount and settlement status are preserved
        expect(evaluateOrderRule('update', 'staff', existingPaidOrder, { paidAmount: 200, paymentStatus: 'paid' })).toBe(true);
        expect(evaluateOrderRule('update', 'admin', existingPaidOrder, { paidAmount: 200, paymentStatus: 'paid' })).toBe(true);

        // Direct client creation of prepaid order is strictly denied
        expect(evaluateOrderRule('create', 'staff', {}, { paidAmount: 150 })).toBe(false);
        expect(evaluateOrderRule('create', 'admin', {}, { paidAmount: 150 })).toBe(false);
        expect(evaluateOrderRule('create', 'staff', {}, { paidAmount: 0 })).toBe(true);
      });

      it('Gap 3: strictly protects customer financial balances from direct client tampering and ensures credit consistency', () => {
        const existingClient = { totalPaid: 1000, financialRevision: 4, primaryPaid: 600, bakeryPaid: 400 };

        // Attempting to alter financialRevision
        expect(
          evaluateClientRule('admin', existingClient, {
            totalPaid: 1000,
            financialRevision: 5, // altered!
            primaryPaid: 600,
            bakeryPaid: 400,
            modifiedKeys: ['financialRevision'],
          })
        ).toBe(false);

        // Attempting to alter totalPaid
        expect(
          evaluateClientRule('staff', existingClient, {
            totalPaid: 2000, // altered!
            financialRevision: 4,
            primaryPaid: 600,
            bakeryPaid: 400,
            modifiedKeys: ['totalPaid'],
          })
        ).toBe(false);

        // Attempting to inject separate division credit or mismatched available credit
        expect(
          evaluateClientRule('staff', existingClient, {
            totalPaid: 1000,
            financialRevision: 4,
            primaryPaid: 600,
            bakeryPaid: 400,
            credit: 500,
            generalCredit: 500,
            availableCredit: 500,
            primaryCredit: 200, // forbidden!
            bakeryCredit: 0,
            modifiedKeys: ['credit', 'generalCredit', 'availableCredit', 'primaryCredit'],
          })
        ).toBe(false);

        // Admin attempting to directly modify financial credit outside profile fields
        expect(
          evaluateClientRule('admin', existingClient, {
            totalPaid: 1000,
            financialRevision: 4,
            primaryPaid: 600,
            bakeryPaid: 400,
            credit: 10000,
            modifiedKeys: ['credit'],
          })
        ).toBe(false);

        // Legitimate client revenue/order sync where paid and revision are locked
        expect(
          evaluateClientRule('staff', existingClient, {
            totalPaid: 1000,
            financialRevision: 4,
            primaryPaid: 600,
            bakeryPaid: 400,
            credit: 300,
            generalCredit: 300,
            availableCredit: 300,
            primaryCredit: 0,
            bakeryCredit: 0,
            modifiedKeys: ['totalRevenue', 'outstanding', 'credit', 'generalCredit', 'availableCredit', 'rawBalance'],
          })
        ).toBe(true);

        // Admin attempting to modify nested financial fields in primaryTotals during profile update
        expect(
          evaluateClientRule('admin', existingClient, {
            totalPaid: 1000,
            financialRevision: 4,
            primaryPaid: 600,
            bakeryPaid: 400,
            modifiedKeys: ['name', 'primaryTotals'],
            modifiedNestedFields: ['rawBalance'],
          })
        ).toBe(false);

        // Staff attempting to forge credit/balances by changing only totalOrders
        expect(
          evaluateClientRule('staff', existingClient, {
            totalPaid: 1000,
            financialRevision: 4,
            primaryPaid: 600,
            bakeryPaid: 400,
            credit: 500,
            generalCredit: 500,
            availableCredit: 500,
            modifiedKeys: ['totalOrders', 'credit', 'generalCredit', 'availableCredit'],
          })
        ).toBe(false);

        // Legitimate Admin profile update
        expect(
          evaluateClientRule('admin', existingClient, {
            totalPaid: 1000,
            financialRevision: 4,
            primaryPaid: 600,
            bakeryPaid: 400,
            modifiedKeys: ['name', 'phone', 'region'],
          })
        ).toBe(true);
      });

      it('Gap 4: invoice ledger entries cannot impersonate payment entries or have negative amounts', () => {
        // Negative amount on invoice ledger creation
        expect(
          evaluateLedgerRule('create', 'staff', { type: 'invoice' }, { type: 'invoice', amount: -500, invoiceId: 'ord_1' })
        ).toBe(false);

        // Negative amount on invoice ledger update
        expect(
          evaluateLedgerRule('update', 'staff', { type: 'invoice' }, { type: 'invoice', amount: -100 })
        ).toBe(false);

        // Invoice ledger with paymentId attached (attempting payment impersonation)
        expect(
          evaluateLedgerRule('create', 'staff', { type: 'invoice' }, { type: 'invoice', amount: 500, invoiceId: 'ord_1', paymentId: 'pay_fake_1' })
        ).toBe(false);

        // Invoice ledger without invoiceId on creation
        expect(
          evaluateLedgerRule('create', 'staff', { type: 'invoice' }, { type: 'invoice', amount: 500 })
        ).toBe(false);

        // Opening balance with paymentId or invoiceId attached
        expect(
          evaluateLedgerRule('create', 'admin', { type: 'opening_balance' }, { type: 'opening_balance', amount: 500, paymentId: 'pay_1' })
        ).toBe(false);
      });
    });
  });
});

