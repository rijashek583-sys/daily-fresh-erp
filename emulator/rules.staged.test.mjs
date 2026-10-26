import { test, describe, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rulesPath = resolve(__dirname, '../firestore.staged.rules');
const rulesContent = readFileSync(rulesPath, 'utf8');

const projectId = 'demo-daily-fresh-rules-test';
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8187,
      rules: rulesContent,
    },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (!testEnv) return;
  await testEnv.clearFirestore();

  // Seed baseline users and fixtures using admin context (bypasses security rules)
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // 1. Users
    await setDoc(doc(db, 'users', 'admin_user'), { role: 'admin', status: 'active' });
    await setDoc(doc(db, 'users', 'staff_user'), { role: 'staff', status: 'active' });
    await setDoc(doc(db, 'users', 'inactive_user'), { role: 'admin', status: 'inactive' });

    // 2. Sample Client
    await setDoc(doc(db, 'clients', 'client_1'), {
      id: 'client_1',
      name: 'HOTEL TAJ',
      region: 'Kasaragod',
      phone: '9876543210',
      status: 'active',
      financialRevision: 1,
      totalRevenue: 1000,
      totalPaid: 600,
      outstanding: 400,
      credit: 0,
      availableCredit: 0,
      generalCredit: 0,
      primaryCredit: 0,
      bakeryCredit: 0,
      rawBalance: 400,
      totalOrders: 2,
      openingBalanceAmount: 0,
      primaryTotals: {
        totalRevenue: 600,
        totalPaid: 400,
        outstanding: 200,
        credit: 0,
        generalCredit: 0,
        rawBalance: 200,
        totalOrders: 1,
        openingBalance: 0,
      },
      bakeryTotals: {
        totalRevenue: 400,
        totalPaid: 200,
        outstanding: 200,
        credit: 0,
        generalCredit: 0,
        rawBalance: 200,
        totalOrders: 1,
        openingBalance: 0,
      },
    });

    // 3. Sample Paid Order
    await setDoc(doc(db, 'orders', 'paid_order_1'), {
      id: 'paid_order_1',
      clientId: 'client_1',
      total: 500,
      paidAmount: 500,
      paymentStatus: 'paid',
      deliveryDate: '2026-03-20',
      division: 'primary',
    });

    // 4. Sample Pending Order
    await setDoc(doc(db, 'orders', 'pending_order_1'), {
      id: 'pending_order_1',
      clientId: 'client_1',
      total: 500,
      paidAmount: 0,
      paymentStatus: 'pending',
      deliveryDate: '2026-03-21',
      division: 'bakery',
    });

    // 5. Sample Payment Document
    await setDoc(doc(db, 'payments', 'pay_1'), {
      id: 'pay_1',
      amount: 600,
      clientId: 'client_1',
      idempotencyKey: 'idem_key_001',
      notes: 'Initial cash',
      reference: 'REF-01',
      updatedAt: '2026-03-20T10:00:00.000Z',
    });

    // 6. Sample Ledger Entries
    await setDoc(doc(db, 'ledger', 'led_pay_1'), {
      id: 'led_pay_1',
      type: 'payment',
      paymentId: 'pay_1',
      clientId: 'client_1',
      amount: 600,
      division: 'primary',
    });

    await setDoc(doc(db, 'ledger', 'led_inv_1'), {
      id: 'led_inv_1',
      type: 'invoice',
      invoiceId: 'pending_order_1',
      clientId: 'client_1',
      amount: 500,
      division: 'bakery',
    });

    await setDoc(doc(db, 'ledger', 'led_ob_1'), {
      id: 'led_ob_1',
      type: 'opening_balance',
      clientId: 'client_1',
      amount: 200,
      division: 'primary',
    });
  });
});

function getClientDb(uid) {
  if (!uid) return testEnv.unauthenticatedContext().firestore();
  return testEnv.authenticatedContext(uid).firestore();
}

describe('Daily Fresh ERP — Comprehensive Firestore Staged Rules Unit Test Suite', () => {
  // ─── SUITE 1: FORBIDDEN FINANCIAL MUTATIONS ───
  describe('Forbidden Financial Mutations (Anti-Tampering & Security Gaps)', () => {
    test('Denies direct payment creation to both Admin and Staff', async () => {
      const adminDb = getClientDb('admin_user');
      const staffDb = getClientDb('staff_user');

      await assertFails(
        setDoc(doc(adminDb, 'payments', 'pay_forged_admin'), {
          amount: 500,
          clientId: 'client_1',
          idempotencyKey: 'key_12345678',
        })
      );

      await assertFails(
        setDoc(doc(staffDb, 'payments', 'pay_forged_staff'), {
          amount: 500,
          clientId: 'client_1',
          idempotencyKey: 'key_12345678',
        })
      );
    });

    test('Denies direct payment deletion to both Admin and Staff', async () => {
      const adminDb = getClientDb('admin_user');
      const staffDb = getClientDb('staff_user');

      await assertFails(deleteDoc(doc(adminDb, 'payments', 'pay_1')));
      await assertFails(deleteDoc(doc(staffDb, 'payments', 'pay_1')));
    });

    test('Denies payment amount or idempotencyKey modification to Admin', async () => {
      const adminDb = getClientDb('admin_user');

      // Attempting to change financial amount
      await assertFails(
        updateDoc(doc(adminDb, 'payments', 'pay_1'), {
          amount: 1000,
        })
      );

      // Attempting to change idempotencyKey
      await assertFails(
        updateDoc(doc(adminDb, 'payments', 'pay_1'), {
          idempotencyKey: 'changed_key_12345',
        })
      );
    });

    test('Denies direct creation, modification, or deletion of payment ledger entries to both Admin and Staff', async () => {
      const adminDb = getClientDb('admin_user');
      const staffDb = getClientDb('staff_user');

      // Create payment ledger entry
      await assertFails(
        setDoc(doc(staffDb, 'ledger', 'led_new_pay'), {
          type: 'payment',
          amount: 200,
          clientId: 'client_1',
        })
      );
      await assertFails(
        setDoc(doc(adminDb, 'ledger', 'led_new_pay'), {
          type: 'payment',
          amount: 200,
          clientId: 'client_1',
        })
      );

      // Update existing payment ledger entry
      await assertFails(
        updateDoc(doc(adminDb, 'ledger', 'led_pay_1'), {
          amount: 800,
        })
      );
      await assertFails(
        updateDoc(doc(staffDb, 'ledger', 'led_pay_1'), {
          amount: 800,
        })
      );

      // Delete payment ledger entry
      await assertFails(deleteDoc(doc(adminDb, 'ledger', 'led_pay_1')));
      await assertFails(deleteDoc(doc(staffDb, 'ledger', 'led_pay_1')));

      // Type conversion attempts
      await assertFails(
        updateDoc(doc(adminDb, 'ledger', 'led_pay_1'), {
          type: 'invoice',
        })
      );
      await assertFails(
        updateDoc(doc(staffDb, 'ledger', 'led_inv_1'), {
          type: 'payment',
        })
      );
    });

    test('Denies invoice ledger impersonation (negative amount, paymentId attachment, missing invoiceId)', async () => {
      const staffDb = getClientDb('staff_user');

      // Negative amount
      await assertFails(
        setDoc(doc(staffDb, 'ledger', 'led_inv_neg'), {
          type: 'invoice',
          amount: -500,
          invoiceId: 'pending_order_1',
          clientId: 'client_1',
        })
      );

      // With paymentId attached (trying to impersonate payment)
      await assertFails(
        setDoc(doc(staffDb, 'ledger', 'led_inv_fake_pay'), {
          type: 'invoice',
          amount: 500,
          invoiceId: 'pending_order_1',
          clientId: 'client_1',
          paymentId: 'pay_1',
        })
      );

      // Missing invoiceId on creation
      await assertFails(
        setDoc(doc(staffDb, 'ledger', 'led_inv_no_order'), {
          type: 'invoice',
          amount: 500,
          clientId: 'client_1',
        })
      );
    });

    test('Denies direct client creation of order with paidAmount > 0', async () => {
      const staffDb = getClientDb('staff_user');
      const adminDb = getClientDb('admin_user');

      await assertFails(
        setDoc(doc(staffDb, 'orders', 'order_prepaid_staff'), {
          clientId: 'client_1',
          total: 300,
          paidAmount: 300,
          paymentStatus: 'paid',
        })
      );

      await assertFails(
        setDoc(doc(adminDb, 'orders', 'order_prepaid_admin'), {
          clientId: 'client_1',
          total: 300,
          paidAmount: 300,
          paymentStatus: 'paid',
        })
      );
    });

    test('Denies client tampering with order paidAmount or settlement status', async () => {
      const staffDb = getClientDb('staff_user');
      const adminDb = getClientDb('admin_user');

      // Modifying paidAmount on paid order
      await assertFails(
        updateDoc(doc(staffDb, 'orders', 'paid_order_1'), {
          paidAmount: 0,
        })
      );
      await assertFails(
        updateDoc(doc(adminDb, 'orders', 'paid_order_1'), {
          paidAmount: 200,
        })
      );

      // Modifying paymentStatus on paid order
      await assertFails(
        updateDoc(doc(staffDb, 'orders', 'paid_order_1'), {
          paymentStatus: 'pending',
        })
      );
    });

    test('Denies client tampering with financialRevision, totalPaid, or division totalPaid', async () => {
      const adminDb = getClientDb('admin_user');
      const staffDb = getClientDb('staff_user');

      // Bump financialRevision
      await assertFails(
        updateDoc(doc(adminDb, 'clients', 'client_1'), {
          financialRevision: 2,
        })
      );

      // Alter totalPaid directly
      await assertFails(
        updateDoc(doc(staffDb, 'clients', 'client_1'), {
          totalPaid: 1000,
        })
      );

      // Alter primaryTotals.totalPaid directly
      await assertFails(
        updateDoc(doc(staffDb, 'clients', 'client_1'), {
          'primaryTotals.totalPaid': 600,
        })
      );
    });

    test('Denies Admin profile edits from modifying nested financial fields in primaryTotals or bakeryTotals', async () => {
      const adminDb = getClientDb('admin_user');

      // Attempting to modify nested rawBalance during profile edit
      await assertFails(
        updateDoc(doc(adminDb, 'clients', 'client_1'), {
          name: 'HOTEL TAJ UPDATED',
          'primaryTotals.rawBalance': 0,
        })
      );

      // Attempting to modify nested credit during profile edit
      await assertFails(
        updateDoc(doc(adminDb, 'clients', 'client_1'), {
          'bakeryTotals.credit': 500,
        })
      );

      // Attempting to modify nested totalRevenue during profile edit
      await assertFails(
        updateDoc(doc(adminDb, 'clients', 'client_1'), {
          'primaryTotals.totalRevenue': 0,
        })
      );
    });

    test('Denies aggregate synchronization from forging credit or balances by changing only totalOrders', async () => {
      const staffDb = getClientDb('staff_user');

      // Attempting to forge generalCredit by just incrementing totalOrders without totalRevenue/opening change
      await assertFails(
        updateDoc(doc(staffDb, 'clients', 'client_1'), {
          totalOrders: 3,
          credit: 1000,
          generalCredit: 1000,
          availableCredit: 1000,
          rawBalance: -1000,
          outstanding: 0,
        })
      );
    });

    test('Denies aggregate synchronization with mismatched subtotal division reconciliation', async () => {
      const staffDb = getClientDb('staff_user');

      // Total revenue doesn't match primaryTotals.totalRevenue + bakeryTotals.totalRevenue
      await assertFails(
        updateDoc(doc(staffDb, 'clients', 'client_1'), {
          totalRevenue: 1500, // primary 600 + bakery 400 = 1000 != 1500
          'primaryTotals.totalRevenue': 600,
          'bakeryTotals.totalRevenue': 400,
        })
      );
    });
  });

  // ─── SUITE 2: LEGITIMATE APPLICATION WORKFLOWS ───
  describe('Legitimate Application Workflows (Functional Preservation)', () => {
    test('Staff creating legitimate order with paidAmount: 0 succeeds', async () => {
      const staffDb = getClientDb('staff_user');

      await assertSucceeds(
        setDoc(doc(staffDb, 'orders', 'order_valid_new'), {
          clientId: 'client_1',
          total: 250,
          paidAmount: 0,
          paymentStatus: 'pending',
          deliveryDate: '2026-03-25',
          division: 'primary',
          items: [{ productName: 'Kuboos', quantity: 25, price: 10, total: 250 }],
        })
      );
    });

    test('Staff updating order items/deliveryDate preserving paidAmount succeeds', async () => {
      const staffDb = getClientDb('staff_user');

      await assertSucceeds(
        updateDoc(doc(staffDb, 'orders', 'paid_order_1'), {
          deliveryDate: '2026-03-22',
          notes: 'Updated delivery slot',
        })
      );
    });

    test('Staff creating and deleting legitimate invoice ledger entries succeeds', async () => {
      const staffDb = getClientDb('staff_user');

      // Create legitimate invoice debit
      await assertSucceeds(
        setDoc(doc(staffDb, 'ledger', 'led_inv_valid_new'), {
          type: 'invoice',
          amount: 250,
          invoiceId: 'pending_order_1',
          clientId: 'client_1',
          division: 'primary',
        })
      );

      // Delete invoice debit during order edit/cancellation
      await assertSucceeds(deleteDoc(doc(staffDb, 'ledger', 'led_inv_1')));
    });

    test('Admin creating, updating, and deleting opening_balance ledger entries succeeds', async () => {
      const adminDb = getClientDb('admin_user');

      // Create opening balance
      await assertSucceeds(
        setDoc(doc(adminDb, 'ledger', 'led_ob_new'), {
          type: 'opening_balance',
          amount: 350,
          clientId: 'client_1',
          division: 'bakery',
        })
      );

      // Update opening balance
      await assertSucceeds(
        updateDoc(doc(adminDb, 'ledger', 'led_ob_1'), {
          amount: 250,
        })
      );

      // Delete opening balance
      await assertSucceeds(deleteDoc(doc(adminDb, 'ledger', 'led_ob_1')));
    });

    test('Admin updating customer profile fields succeeds', async () => {
      const adminDb = getClientDb('admin_user');

      await assertSucceeds(
        updateDoc(doc(adminDb, 'clients', 'client_1'), {
          name: 'HOTEL TAJ DELUXE',
          phone: '9123456789',
          region: 'Bekal',
          status: 'active',
          updatedAt: '2026-03-25T12:00:00.000Z',
        })
      );
    });

    test('Admin updating opening balance on customer doc succeeds', async () => {
      const adminDb = getClientDb('admin_user');

      await assertSucceeds(
        updateDoc(doc(adminDb, 'clients', 'client_1'), {
          openingBalanceAmount: 300,
          'primaryTotals.openingBalance': 300,
        })
      );
    });

    test('Admin updating payment metadata (notes, reference) succeeds', async () => {
      const adminDb = getClientDb('admin_user');

      await assertSucceeds(
        updateDoc(doc(adminDb, 'payments', 'pay_1'), {
          notes: 'Customer verified cash bill',
          reference: 'REF-VERIFIED-99',
          updatedAt: '2026-03-25T14:00:00.000Z',
        })
      );
    });
  });
});
