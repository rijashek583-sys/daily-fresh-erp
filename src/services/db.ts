import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  getDoc,
  Timestamp,
  addDoc,
  writeBatch,
  runTransaction,
  increment,
  type FirestoreError
} from 'firebase/firestore';
import {
  createFinishedStockDeductionsForOrder,
  adjustFinishedStockForOrderUpdate,
  reverseFinishedStockForOrder,
} from './stockDb';
import { db } from '../lib/firebase';
import { toast } from 'sonner';
import { useAuthStore } from '../stores/authStore';
import { getProductDivision, getTodayLocalDateString } from '../lib/utils';
import { useDataStore } from '../stores/dataStore';
import { type Division, type PaymentMethod, type ClientOpeningBalance, type Order, type PaymentCorrectionRecord } from '../types';
import { allocateOrderCredit, allocatePayment, round2, calculateUnifiedMetrics } from '../lib/billing';
import { callRecordPayment, callCorrectPayment } from './paymentsService';

function enforceAdmin() {
  const user = useAuthStore.getState().user;
  if (!user || user.role !== 'admin') {
    throw new Error('Unauthorized: Admin access required');
  }
}

function enforceStaffOrAdmin() {
  const user = useAuthStore.getState().user;
  if (!user || (user.role !== 'admin' && user.role !== 'staff')) {
    throw new Error('Unauthorized: Staff or Admin access required');
  }
}

// Re-export standard types from our models if we create them, but for now we'll rely on any or local interfaces
export const COLLECTIONS = {
  CLIENTS: 'clients',
  PRODUCTS: 'products',
  ORDERS: 'orders',
  PAYMENTS: 'payments',
  REGIONS: 'regions', // This could be a document or a collection
  PRICING: 'clientPricing',
};

// Generic subscribe function
export function subscribeToCollection(
  collectionName: string,
  callback: (data: any[]) => void,
  onError?: (error: FirestoreError) => void
) {
  const q = query(collection(db, collectionName));
  return onSnapshot(q, (snapshot) => {
    const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    callback(data);
  }, (error) => {
    console.error(`Error subscribing to ${collectionName}:`, error);
    onError?.(error);
  });
}

// Integrity Verification
export async function verifyAndSyncClientTotals(clientId: string) {
  try {
    const clientRef = doc(db, COLLECTIONS.CLIENTS, clientId);
    const clientSnap = await getDoc(clientRef);
    const clientData = clientSnap.exists() ? (clientSnap.data() as any) : null;

    const ordersQuery = query(collection(db, 'orders'), where('clientId', '==', clientId));
    const ledgerQuery = query(collection(db, 'ledger'), where('clientId', '==', clientId));
    
    const [ordersSnap, ledgerSnap] = await Promise.all([
      getDocs(ordersQuery),
      getDocs(ledgerQuery)
    ]);

    const validOrderIds = new Set<string>();
    ordersSnap.forEach(doc => validOrderIds.add(doc.id));

    const batch = writeBatch(db);
    let hasWrites = false;

    const primaryTotals = { totalInvoiced: 0, totalPaid: 0, totalOrders: 0, openingBalance: 0 };
    const bakeryTotals = { totalInvoiced: 0, totalPaid: 0, totalOrders: 0, openingBalance: 0 };

    // Process Ledger & Clean Orphan Invoice Ledger Entries
    // Payment entries represent valid financial records and must NEVER be purged as orphans.
    ledgerSnap.forEach(doc => {
      const data = doc.data();
      
      let isOrphan = false;
      // Only delete invoice debits whose corresponding order was permanently removed.
      if (data.type === 'invoice' && (!data.invoiceId || !validOrderIds.has(data.invoiceId))) {
        isOrphan = true;
      }

      if (isOrphan) {
        console.warn(`[Integrity] Deleting orphan invoice ledger entry ${doc.id}`);
        batch.delete(doc.ref);
        hasWrites = true;
      } else {
        const isBakery = data.division === 'bakery';
        const target = isBakery ? bakeryTotals : primaryTotals;
        
        if (data.type === 'invoice') {
          target.totalInvoiced = round2(target.totalInvoiced + (data.amount || 0));
          target.totalOrders += 1;
        } else if (data.type === 'payment') {
          target.totalPaid = round2(target.totalPaid + (data.amount || 0));
        } else if (data.type === 'opening_balance') {
          target.openingBalance = round2(target.openingBalance + (data.amount || 0));
        }
      }
    });

    // Historical opening balances must be supported by authentic ledger entries or approved reconciliation.
    // Unapproved automatic reconstruction with fabricated timestamps is prohibited (Blocker 6 & Rule F).
    const hasPrimaryLedgerOB = ledgerSnap.docs.some(d => d.data().type === 'opening_balance' && d.data().division !== 'bakery');
    const hasBakeryLedgerOB = ledgerSnap.docs.some(d => d.data().type === 'opening_balance' && d.data().division === 'bakery');

    if (!hasPrimaryLedgerOB && clientData) {
      const legacyPrimaryOB = round2(
        clientData.primaryTotals?.openingBalance ?? 
        (clientData.openingBalance?.division !== 'bakery' ? (clientData.openingBalance?.amount || clientData.openingBalanceAmount || 0) : 0)
      );
      if (legacyPrimaryOB > 0) {
        console.warn(`[Integrity] Client ${clientId} has legacy Primary opening balance (₹${legacyPrimaryOB}) without verified ledger entry. Approved reconciliation required.`);
      }
    }

    if (!hasBakeryLedgerOB && clientData) {
      const legacyBakeryOB = round2(
        clientData.bakeryTotals?.openingBalance ?? 
        (clientData.openingBalance?.division === 'bakery' ? (clientData.openingBalance?.amount || 0) : 0)
      );
      if (legacyBakeryOB > 0) {
        console.warn(`[Integrity] Client ${clientId} has legacy Bakery opening balance (₹${legacyBakeryOB}) without verified ledger entry. Approved reconciliation required.`);
      }
    }

    if (hasWrites) {
      await batch.commit();
      console.log(`[Integrity] Committed ledger corrections for client ${clientId}`);
    }

    // Authoritative Unified Calculation
    const metrics = calculateUnifiedMetrics({
      primaryOpening: primaryTotals.openingBalance,
      bakeryOpening: bakeryTotals.openingBalance,
      primaryInvoiced: primaryTotals.totalInvoiced,
      bakeryInvoiced: bakeryTotals.totalInvoiced,
      primaryPaid: primaryTotals.totalPaid,
      bakeryPaid: bakeryTotals.totalPaid,
      primaryOrders: primaryTotals.totalOrders,
      bakeryOrders: bakeryTotals.totalOrders,
      division: 'all',
    });

    await updateDoc(clientRef, {
      totalRevenue: metrics.totalInvoiced,
      totalPaid: metrics.totalPaid,
      outstanding: metrics.combinedOutstanding,
      credit: metrics.generalCredit,
      availableCredit: metrics.generalCredit,
      generalCredit: metrics.generalCredit,
      primaryCredit: 0,
      bakeryCredit: 0,
      rawBalance: metrics.combinedRaw,
      totalOrders: metrics.totalOrders,
      openingBalanceAmount: metrics.openingBalance,
      financialRevision: Number(clientData?.financialRevision) || 0,
      primaryTotals: {
        totalRevenue: primaryTotals.totalInvoiced,
        totalPaid: primaryTotals.totalPaid,
        outstanding: metrics.primaryOutstanding,
        credit: 0,
        generalCredit: metrics.generalCredit,
        rawBalance: metrics.primaryRawBalance,
        totalOrders: primaryTotals.totalOrders,
        openingBalance: primaryTotals.openingBalance,
      },
      bakeryTotals: {
        totalRevenue: bakeryTotals.totalInvoiced,
        totalPaid: bakeryTotals.totalPaid,
        outstanding: metrics.bakeryOutstanding,
        credit: 0,
        generalCredit: metrics.generalCredit,
        rawBalance: metrics.bakeryRawBalance,
        totalOrders: bakeryTotals.totalOrders,
        openingBalance: bakeryTotals.openingBalance,
      }
    });
    
    console.log(`[Integrity] Client ${clientId} synced. Raw: ${metrics.combinedRaw}, Outstanding: ${metrics.combinedOutstanding}, General Credit: ${metrics.generalCredit}`);
  } catch (err) {
    console.error(`[Integrity] Failed to sync client ${clientId}:`, err);
  }
}

// Clients
export async function addClient(clientData: any) {
  enforceAdmin();
  try {
    const docRef = doc(collection(db, COLLECTIONS.CLIENTS));
    await setDoc(docRef, { ...clientData, id: docRef.id });
    return docRef.id;
  } catch (error) {
    console.error("Error adding client:", error);
    toast.error('Failed to add client');
    throw error;
  }
}

export async function updateClient(clientId: string, updates: any) {
  enforceAdmin();
  try {
    const docRef = doc(db, COLLECTIONS.CLIENTS, clientId);
    await updateDoc(docRef, updates);
  } catch (error) {
    console.error("Error updating client:", error);
    toast.error('Failed to update client');
    throw error;
  }
}

export interface ClientOpeningBalanceInput {
  amount: number;
  asOfDate: string;
  notes?: string;
  division?: Division;
}

export async function saveClientOpeningBalance(clientId: string, input: ClientOpeningBalanceInput) {
  enforceAdmin();
  const currentUser = useAuthStore.getState().user;
  const adminName = currentUser?.name || currentUser?.displayName || 'Admin';

  try {
    const clientRef = doc(db, COLLECTIONS.CLIENTS, clientId);
    const clientSnap = await getDoc(clientRef);
    if (!clientSnap.exists()) throw new Error('Client not found');
    const clientData = clientSnap.data() as any;

    const amount = round2(Number(input.amount) || 0);
    if (amount < 0) throw new Error('Opening balance amount cannot be negative');

    const asOfDate = input.asOfDate || new Date().toISOString().split('T')[0];
    const notes = input.notes?.trim() || '';
    const division: Division = input.division === 'bakery' ? 'bakery' : 'primary';

    // Business Rule 10: Saving a Primary opening balance must never overwrite or delete a Bakery opening balance, and vice versa.
    // Query only opening_balance ledger entries for THIS specific division.
    const ledgerQuery = query(
      collection(db, 'ledger'),
      where('clientId', '==', clientId),
      where('type', '==', 'opening_balance'),
      where('division', '==', division)
    );
    const ledgerSnap = await getDocs(ledgerQuery);

    const otherOB = round2(
      division === 'bakery'
        ? (clientData.primaryTotals?.openingBalance ?? 
           (clientData.openingBalance?.division !== 'bakery' ? (clientData.openingBalance?.amount || clientData.openingBalanceAmount || 0) : 0))
        : (clientData.bakeryTotals?.openingBalance ?? 
           (clientData.openingBalance?.division === 'bakery' ? (clientData.openingBalance?.amount || 0) : 0))
    );
    const totalOpening = round2(amount + otherOB);

    const batch = writeBatch(db);

    if (amount > 0) {
      const ledgerDocRef = ledgerSnap.empty
        ? doc(collection(db, 'ledger'))
        : ledgerSnap.docs[0].ref;

      // Remove any duplicate opening_balance entries for this division if present
      if (ledgerSnap.docs.length > 1) {
        for (let i = 1; i < ledgerSnap.docs.length; i++) {
          batch.delete(ledgerSnap.docs[i].ref);
        }
      }

      const ledgerData: any = {
        id: ledgerDocRef.id,
        type: 'opening_balance',
        clientId,
        clientName: clientData.name || '',
        region: clientData.region || '',
        amount,
        billDate: asOfDate,
        createdAt: `${asOfDate}T00:00:00.000Z`,
        description: notes ? `Opening Balance (${division === 'bakery' ? 'Bakery' : 'Primary'}) - ${notes}` : `Opening Balance (${division === 'bakery' ? 'Bakery' : 'Primary'})`,
        division,
        updatedBy: adminName,
      };
      batch.set(ledgerDocRef, ledgerData);

      const openingRecord: ClientOpeningBalance = {
        amount,
        asOfDate,
        notes,
        division,
        updatedAt: new Date().toISOString(),
        updatedBy: adminName,
      };

      const clientUpdates: any = {
        openingBalanceAmount: totalOpening,
        [`${division}Totals.openingBalance`]: amount,
      };
      if (clientData.openingBalance?.division === division || !clientData.openingBalance || division === 'primary') {
        clientUpdates.openingBalance = openingRecord;
      }
      batch.update(clientRef, clientUpdates);
    } else {
      // If amount is 0, delete existing opening balance ledger entries for THIS division only
      ledgerSnap.forEach(d => batch.delete(d.ref));
      const clientUpdates: any = {
        openingBalanceAmount: totalOpening,
        [`${division}Totals.openingBalance`]: 0,
      };
      if (clientData.openingBalance?.division === division) {
        clientUpdates.openingBalance = null;
      }
      batch.update(clientRef, clientUpdates);
    }

    await batch.commit();

    await verifyAndSyncClientTotals(clientId);
    toast.success('Opening balance updated successfully');
  } catch (error: any) {
    console.error('Error saving opening balance:', error);
    toast.error(error.message || 'Failed to update opening balance');
    throw error;
  }
}

export async function moveToTrash(
  originalCollection: string,
  docId: string,
  originalData: any,
  deletedBy: string
) {
  enforceAdmin();
  if (originalCollection === 'payments') {
    throw new Error('Direct trashing of payments is prohibited. Use payment correction (callCorrectPayment) with amount 0 to cancel a payment and authoritatively reverse financial ledger entries.');
  }
  try {
    const deletedAt = new Date().toISOString();
    const batch = writeBatch(db);
    
    // Create the trash document for the primary record
    const trashRef = doc(db, 'trash', docId);
    batch.set(trashRef, {
      originalCollection,
      originalDocumentId: docId,
      originalData,
      deletedAt,
      deletedBy
    });

    // Delete from original collection
    const originalRef = doc(db, originalCollection, docId);
    batch.delete(originalRef);

    // When deleting an order or payment:
    //  1. Delete its associated ledger entry (for client orders).
    //  2. Atomically update the client's denormalized aggregates.
    if (originalCollection === 'orders') {
      // Critical Safety: Check for existing payment dependencies in payments OR ledger collection
      const [paymentsSnap, ledgerPaymentsSnap] = await Promise.all([
        getDocs(query(collection(db, 'payments'), where('invoiceId', '==', docId))),
        getDocs(query(collection(db, 'ledger'), where('type', '==', 'payment'), where('invoiceId', '==', docId))),
      ]);
      const activePayments = paymentsSnap.docs.filter(p => !p.data().deletedAt);
      const activeLedgerPayments = ledgerPaymentsSnap.docs;
      const paymentCount = Math.max(activePayments.length, activeLedgerPayments.length);
      if (paymentCount > 0) {
        const totalPaid = activeLedgerPayments.length > 0
          ? activeLedgerPayments.reduce((s, p) => s + (p.data().amount || 0), 0)
          : activePayments.reduce((s, p) => s + (p.data().amount || 0), 0);
        throw new Error(
          `Cannot delete order #${docId.slice(0, 8)}: Order has ${paymentCount} recorded payment(s) totalling ₹${totalPaid.toLocaleString('en-IN')}. Deletion is blocked to protect payment records and client ledger balances.`
        );
      }

      if (originalData?.clientId && originalData.clientId !== 'direct') {
        // Find and trash the associated ledger debit
        const ledgerQuery = query(
          collection(db, 'ledger'), 
          where('type', '==', 'invoice'), 
          where('invoiceId', '==', docId)
        );
        const ledgerSnap = await getDocs(ledgerQuery);
        ledgerSnap.forEach((lDoc) => {
          const lTrashRef = doc(db, 'trash', lDoc.id);
          batch.set(lTrashRef, {
            originalCollection: 'ledger',
            originalDocumentId: lDoc.id,
            originalData: lDoc.data(),
            deletedAt,
            deletedBy
          });
          batch.delete(lDoc.ref);
        });
      }
    } else if (originalCollection === 'payments') {
      if (originalData?.clientId && originalData.clientId !== 'direct') {
        // Find and trash the associated ledger credit
        const ledgerQuery = query(
          collection(db, 'ledger'), 
          where('type', '==', 'payment'), 
          where('paymentId', '==', docId)
        );
        const ledgerSnap = await getDocs(ledgerQuery);
        ledgerSnap.forEach((lDoc) => {
          const lTrashRef = doc(db, 'trash', lDoc.id);
          batch.set(lTrashRef, {
            originalCollection: 'ledger',
            originalDocumentId: lDoc.id,
            originalData: lDoc.data(),
            deletedAt,
            deletedBy
          });
          batch.delete(lDoc.ref);
        });
      }

      // If this payment was applied against a specific order/bill, reverse the order's paidAmount
      if (originalData?.invoiceId) {
        try {
          const orderRef = doc(db, COLLECTIONS.ORDERS, originalData.invoiceId);
          const orderSnap = await getDoc(orderRef);
          if (orderSnap.exists()) {
            const oData = orderSnap.data();
            const revApplied = Number(originalData.appliedAmount !== undefined ? originalData.appliedAmount : (originalData.amount || 0));
            const currentPaid = Number(oData.paidAmount || 0);
            const newPaid = Math.max(0, round2(currentPaid - revApplied));
            const netDue = Number(oData.netDue !== undefined ? oData.netDue : (oData.total || 0));
            const newStatus = newPaid >= netDue - 0.01 ? 'paid' : (newPaid > 0.01 ? 'partial' : 'pending');
            batch.update(orderRef, {
              paidAmount: newPaid,
              paymentStatus: newStatus,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (ordErr) {
          console.warn('[Trash] Could not update order on payment trash:', ordErr);
        }
      }

      // If this payment also settled a counterpart division order, reverse its paidAmount too
      if (originalData?.otherInvoiceId && Number(originalData.appliedToOtherBill) > 0) {
        try {
          const otherRef = doc(db, COLLECTIONS.ORDERS, originalData.otherInvoiceId);
          const otherSnap = await getDoc(otherRef);
          if (otherSnap.exists()) {
            const otherData = otherSnap.data();
            const otherRevApplied = Number(originalData.appliedToOtherBill);
            const otherCurrentPaid = Number(otherData.paidAmount || 0);
            const otherNewPaid = Math.max(0, round2(otherCurrentPaid - otherRevApplied));
            const otherNetDue = Number(otherData.netDue !== undefined ? otherData.netDue : (otherData.total || 0));
            const otherNewStatus = otherNewPaid >= otherNetDue - 0.01 ? 'paid' : (otherNewPaid > 0.01 ? 'partial' : 'pending');
            batch.update(otherRef, {
              paidAmount: otherNewPaid,
              paymentStatus: otherNewStatus,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (otherErr) {
          console.warn('[Trash] Could not update counterpart order on payment trash:', otherErr);
        }
      }
    }

    await batch.commit();
    if (originalData?.clientId && originalData.clientId !== 'direct') {
      await verifyAndSyncClientTotals(originalData.clientId);
    }

    // ── Stock integration — reverse order stock deductions when order is trashed ──
    if (originalCollection === 'orders' && originalData?.items) {
      try {
        await reverseFinishedStockForOrder({
          orderId: docId,
          clientId: originalData.clientId || '',
          clientName: originalData.clientName || '',
          items: originalData.items,
          orderUpdatedAt: originalData.updatedAt || '',
          deliveryDate: originalData.deliveryDate || '',
          division: originalData.division || 'primary',
        });
      } catch (stockErr) {
        console.error('[Stock] Failed to reverse stock for trashed order:', stockErr);
      }
    }
    // ── End stock integration ─────────────────────────────────────────────────
  } catch (error) {
    console.error("Error moving to trash:", error);
    toast.error('Failed to move to trash');
    throw error;
  }
}

export interface BulkDeleteOrderFailure {
  orderId: string;
  clientName?: string;
  reason: string;
}

export interface BulkDeleteOrdersResult {
  totalRequested: number;
  successCount: number;
  failedCount: number;
  deletedOrderIds: string[];
  failures: BulkDeleteOrderFailure[];
}

let isBulkDeleteInProgress = false;

export async function bulkDeleteOrders(
  ordersToDelete: Order[],
  deletedBy: string
): Promise<BulkDeleteOrdersResult> {
  enforceAdmin();

  if (isBulkDeleteInProgress) {
    throw new Error('A deletion operation is already in progress. Please wait.');
  }

  isBulkDeleteInProgress = true;
  try {
    const totalRequested = ordersToDelete.length;
    const deletedOrderIds: string[] = [];
    const failures: BulkDeleteOrderFailure[] = [];

    if (totalRequested === 0) {
      return { totalRequested: 0, successCount: 0, failedCount: 0, deletedOrderIds: [], failures: [] };
    }

    // 1. Build payment lookup from store state (payments and ledger payments)
    const { payments: allPayments, ledger: allLedger } = useDataStore.getState();
    const paymentsByInvoice = new Map<string, any[]>();
    for (const p of allPayments || []) {
      if (!p.deletedAt && p.invoiceId) {
        const list = paymentsByInvoice.get(p.invoiceId) || [];
        list.push(p);
        paymentsByInvoice.set(p.invoiceId, list);
      }
    }
    for (const l of allLedger || []) {
      if (l.type === 'payment' && l.invoiceId) {
        const list = paymentsByInvoice.get(l.invoiceId) || [];
        if (!list.some(p => p.id === (l.paymentId || l.id))) {
          list.push({ id: l.paymentId || l.id, amount: l.amount, invoiceId: l.invoiceId });
          paymentsByInvoice.set(l.invoiceId, list);
        }
      }
    }

    const eligibleOrders: Order[] = [];

    // 2. Pre-filter orders with payments to prevent unsafe deletions
    for (const order of ordersToDelete) {
      const linkedPayments = paymentsByInvoice.get(order.id) || [];
      if (linkedPayments.length > 0) {
        const totalPaid = linkedPayments.reduce((s, p) => s + (p.amount || 0), 0);
        failures.push({
          orderId: order.id,
          clientName: order.clientName || (order.clientId === 'direct' ? 'Direct Sale' : 'Unknown Client'),
          reason: `Has ${linkedPayments.length} recorded payment(s) (₹${totalPaid.toLocaleString('en-IN')}). Deletion blocked to protect payment records and ledger balance.`,
        });
      } else {
        eligibleOrders.push(order);
      }
    }

    // 3. Batch delete eligible orders in chunks of 25 (well within Firestore 500-op limit)
    const BATCH_SIZE = 25;
    const affectedClients = new Set<string>();
    const stockReversalsToRun: Order[] = [];
    const now = new Date().toISOString();

    for (let i = 0; i < eligibleOrders.length; i += BATCH_SIZE) {
      const chunk = eligibleOrders.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      const chunkOrdersToDelete: Order[] = [];

      for (const order of chunk) {
        // Double-check Firestore payments and ledger collections to guarantee no concurrent payments exist
        try {
          const [paymentsSnap, ledgerPaymentsSnap] = await Promise.all([
            getDocs(query(collection(db, 'payments'), where('invoiceId', '==', order.id))),
            getDocs(query(collection(db, 'ledger'), where('type', '==', 'payment'), where('invoiceId', '==', order.id))),
          ]);
          const activePayments = paymentsSnap.docs.filter(d => !d.data().deletedAt);
          const activeLedgerPayments = ledgerPaymentsSnap.docs;
          const paymentCount = Math.max(activePayments.length, activeLedgerPayments.length);
          if (paymentCount > 0) {
            const totalPaid = activeLedgerPayments.length > 0
              ? activeLedgerPayments.reduce((s, d) => s + (d.data().amount || 0), 0)
              : activePayments.reduce((s, d) => s + (d.data().amount || 0), 0);
            failures.push({
              orderId: order.id,
              clientName: order.clientName || 'Direct Sale',
              reason: `Found active payment record in database (${paymentCount} payment(s), ₹${totalPaid.toLocaleString('en-IN')}). Deletion blocked.`,
            });
            continue;
          }
        } catch (checkErr) {
          console.warn(`[BulkDelete] Could not check Firestore payments for order ${order.id}:`, checkErr);
        }

        // Add to trash collection
        const trashRef = doc(db, 'trash', order.id);
        batch.set(trashRef, {
          originalCollection: 'orders',
          originalDocumentId: order.id,
          originalData: order,
          deletedAt: now,
          deletedBy,
        });

        // Delete from orders collection
        const orderRef = doc(db, 'orders', order.id);
        batch.delete(orderRef);

        // Move associated invoice ledger debit to trash if client order
        if (order.clientId && order.clientId !== 'direct') {
          try {
            const ledgerSnap = await getDocs(
              query(
                collection(db, 'ledger'),
                where('type', '==', 'invoice'),
                where('invoiceId', '==', order.id)
              )
            );
            ledgerSnap.forEach(lDoc => {
              const lTrashRef = doc(db, 'trash', lDoc.id);
              batch.set(lTrashRef, {
                originalCollection: 'ledger',
                originalDocumentId: lDoc.id,
                originalData: lDoc.data(),
                deletedAt: now,
                deletedBy,
              });
              batch.delete(lDoc.ref);
            });
            affectedClients.add(order.clientId);
          } catch (ledgerErr) {
            console.error(`[BulkDelete] Error processing ledger for order ${order.id}:`, ledgerErr);
          }
        }

        chunkOrdersToDelete.push(order);
      }

      if (chunkOrdersToDelete.length > 0) {
        try {
          await batch.commit();
          for (const ord of chunkOrdersToDelete) {
            deletedOrderIds.push(ord.id);
            stockReversalsToRun.push(ord);
          }
        } catch (commitErr: any) {
          console.error('[BulkDelete] Batch commit failed:', commitErr);
          for (const ord of chunkOrdersToDelete) {
            failures.push({
              orderId: ord.id,
              clientName: ord.clientName,
              reason: commitErr.message || 'Firestore batch write failed',
            });
          }
        }
      }
    }

    // 4. Reverse finished stock for all successfully deleted orders
    for (const order of stockReversalsToRun) {
      if (order.items && order.items.length > 0) {
        try {
          await reverseFinishedStockForOrder({
            orderId: order.id,
            clientId: order.clientId || '',
            clientName: order.clientName || '',
            items: order.items,
            orderUpdatedAt: order.updatedAt || '',
            deliveryDate: order.deliveryDate || '',
            division: order.division || 'primary',
          });
        } catch (stockErr) {
          console.error(`[BulkDelete] Stock reversal failed for order ${order.id}:`, stockErr);
        }
      }
    }

    // 5. Recalculate client totals once per affected client
    for (const clientId of affectedClients) {
      try {
        await verifyAndSyncClientTotals(clientId);
      } catch (syncErr) {
        console.error(`[BulkDelete] Client total sync failed for client ${clientId}:`, syncErr);
      }
    }

    return {
      totalRequested,
      successCount: deletedOrderIds.length,
      failedCount: failures.length,
      deletedOrderIds,
      failures,
    };
  } finally {
    isBulkDeleteInProgress = false;
  }
}

// Products
export async function addProduct(productData: any) {
  enforceAdmin();
  try {
    const docRef = doc(collection(db, COLLECTIONS.PRODUCTS));
    await setDoc(docRef, { ...productData, id: docRef.id });
    return docRef.id;
  } catch (error) {
    console.error("Error adding product:", error);
    throw error;
  }
}

export async function updateProduct(productId: string, updates: any) {
  enforceAdmin();
  try {
    const docRef = doc(db, COLLECTIONS.PRODUCTS, productId);
    await updateDoc(docRef, updates);
  } catch (error) {
    console.error("Error updating product:", error);
    throw error;
  }
}

// Orders
export async function addOrder(orderData: any) {
  enforceStaffOrAdmin();
  try {
    const isDirectSale = orderData.orderType === 'direct' || orderData.clientId === 'direct';
    const { clientId, total } = orderData;
    if (!isDirectSale && !clientId) throw new Error("Missing client ID");

    let newOrderId = '';

    await runTransaction(db, async (transaction) => {
      let clientSnap = null;
      if (!isDirectSale) {
        // 1. Fetch Client (single document read — safe inside transaction)
        const clientRef = doc(db, 'clients', clientId);
        clientSnap = await transaction.get(clientRef);
        if (!clientSnap.exists()) throw new Error("Client not found");
      }

      // 2. Derive division credit and create Order Document
      const orderRef = doc(collection(db, COLLECTIONS.ORDERS));
      newOrderId = orderRef.id;

      let creditApplied = 0;
      let primaryCreditApplied = 0;
      let bakeryCreditApplied = 0;

      if (!isDirectSale && clientSnap) {
          const clientDoc = clientSnap.data() || {};
          const pRaw = clientDoc.primaryTotals?.rawBalance !== undefined
            ? clientDoc.primaryTotals.rawBalance
            : ((clientDoc.primaryTotals?.openingBalance || 0) + (clientDoc.primaryTotals?.totalRevenue || 0) - (clientDoc.primaryTotals?.totalPaid || 0));
          const bRaw = clientDoc.bakeryTotals?.rawBalance !== undefined
            ? clientDoc.bakeryTotals.rawBalance
            : ((clientDoc.bakeryTotals?.openingBalance || 0) + (clientDoc.bakeryTotals?.totalRevenue || 0) - (clientDoc.bakeryTotals?.totalPaid || 0));
          const combinedRaw = round2(pRaw + bRaw);

          const generalCredit = Math.max(
            0,
            Number(clientDoc.generalCredit ?? clientDoc.availableCredit ?? clientDoc.credit ?? 0),
            combinedRaw < 0 ? Math.abs(combinedRaw) : 0
          );

          const clientPrimaryCredit = Math.max(0, Number(clientDoc.primaryCredit || 0), pRaw < 0 ? Math.abs(pRaw) : 0);
          const clientBakeryCredit = Math.max(0, Number(clientDoc.bakeryCredit || 0), bRaw < 0 ? Math.abs(bRaw) : 0);
          const { products } = useDataStore.getState();
          let primarySubtotal = 0;
          let bakerySubtotal = 0;
          (orderData.items || []).forEach((i: any) => {
            const prod = products.find((p: any) => p.id === i.productId);
            if (getProductDivision(prod || { name: i.productName }) === 'primary') primarySubtotal += i.total;
            else bakerySubtotal += i.total;
          });

          ({ creditApplied, primaryCreditApplied, bakeryCreditApplied } = allocateOrderCredit({
            division: orderData.division,
            total,
            primarySubtotal,
            bakerySubtotal,
            generalCredit,
            primaryCredit: clientPrimaryCredit,
            bakeryCredit: clientBakeryCredit,
            requestedCreditApplied: orderData.creditApplied,
          }));
      }

      const netDue = Math.max(0, round2(total - creditApplied));
      const paymentStatus = netDue <= 0.005 ? 'paid' : (creditApplied > 0 ? 'partial' : 'pending');

      const oData = {
        ...orderData,
        id: orderRef.id,
        orderType: isDirectSale ? 'direct' : 'client',
        clientId: isDirectSale ? 'direct' : clientId,
        clientName: isDirectSale ? 'Direct Sale' : (orderData.clientName || clientSnap?.data()?.name || ''),
        region: isDirectSale ? 'Direct Sale' : (orderData.region || clientSnap?.data()?.region || ''),
        creditApplied,
        primaryCreditApplied,
        bakeryCreditApplied,
        netDue,
        paidAmount: 0,
        paymentStatus,
      };
      transaction.set(orderRef, oData);

      // 3. Create Ledger entries — split by division so every ledger row is division-clean (ONLY for client orders)
      if (!isDirectSale) {
        const { products } = useDataStore.getState();
        const baseLedger = {
          type: 'invoice',
          clientId,
          invoiceId: orderRef.id,
          createdAt: new Date().toISOString(),
          billDate: oData.deliveryDate,
        };

        if (orderData.division === 'all') {
          // Split items into primary and bakery subtotals
          let primaryTotal = 0;
          let bakeryTotal = 0;
          const primaryNames: string[] = [];
          const bakeryNames: string[] = [];

          oData.items.forEach((i: any) => {
            const prod = products.find((p: any) => p.id === i.productId);
            const div = getProductDivision(prod || { name: i.productName });
            if (div === 'primary') {
              primaryTotal += i.total;
              primaryNames.push(i.productName);
            } else {
              bakeryTotal += i.total;
              bakeryNames.push(i.productName);
            }
          });

          if (primaryTotal > 0) {
            const primaryLedgerRef = doc(collection(db, 'ledger'));
            transaction.set(primaryLedgerRef, {
              ...baseLedger,
              id: primaryLedgerRef.id,
              amount: primaryTotal,
              description: `Daily Bill - Primary (${primaryNames.join(', ')})`,
              division: 'primary'
            });
          }
          if (bakeryTotal > 0) {
            const bakeryLedgerRef = doc(collection(db, 'ledger'));
            transaction.set(bakeryLedgerRef, {
              ...baseLedger,
              id: bakeryLedgerRef.id,
              amount: bakeryTotal,
              description: `Daily Bill - Bakery (${bakeryNames.join(', ')})`,
              division: 'bakery'
            });
          }
        } else {
          const ledgerRef = doc(collection(db, 'ledger'));
          transaction.set(ledgerRef, {
            ...baseLedger,
            id: ledgerRef.id,
            amount: total,
            description: `Daily Bill (${oData.items.map((i: any) => i.productName).join(', ')})`,
            division: orderData.division
          });
        }
      }
    });
    
    if (!isDirectSale && clientId) {
      await verifyAndSyncClientTotals(clientId);
    }

    // ── Stock integration (additive — runs after billing transaction) ────────
    try {
      await createFinishedStockDeductionsForOrder({
        orderId: newOrderId,
        clientId: isDirectSale ? 'direct' : orderData.clientId,
        clientName: isDirectSale ? 'Direct Sale' : (orderData.clientName || ''),
        items: orderData.items || [],
        deliveryDate: orderData.deliveryDate,
        division: orderData.division || 'primary',
        versionKey: orderData.createdAt || new Date().toISOString(),
      });
    } catch (stockErr) {
      console.error('[Stock] Failed to write stock deductions for new order:', stockErr);
      // Billing committed successfully — stock sync failure is non-fatal and recoverable
    }
    // ── End stock integration ─────────────────────────────────────────────────

    return newOrderId;
  } catch (error) {
    console.error("Error adding order atomically:", error);
    throw error;
  }
}

export async function updateOrder(orderId: string, updates: any) {
  enforceStaffOrAdmin();
  try {
    const orderRef = doc(db, COLLECTIONS.ORDERS, orderId);

    // Pre-fetch any existing invoice ledger entries before the transaction
    const ledgerQuery = query(
      collection(db, 'ledger'), 
      where('type', '==', 'invoice'), 
      where('invoiceId', '==', orderId)
    );
    const ledgerSnap = await getDocs(ledgerQuery);

    const result = await runTransaction(db, async (transaction) => {
      // ─── PHASE 1: ALL READS ───
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error('Order not found');

      const oldData = orderSnap.data();
      const oldTotal: number = round2(oldData.total || 0);
      const newTotal: number = updates.total !== undefined ? round2(Number(updates.total)) : oldTotal;
      const totalDiff = round2(newTotal - oldTotal);

      // Recalculate netDue and paymentStatus when total or settlements change
      const creditApplied = round2(
        updates.creditApplied !== undefined
          ? Number(updates.creditApplied)
          : (oldData.creditApplied || ((oldData.primaryCreditApplied || 0) + (oldData.bakeryCreditApplied || 0)) || 0)
      );
      const currentPaid = round2(updates.paidAmount !== undefined ? Number(updates.paidAmount) : (oldData.paidAmount || 0));
      const totalSettled = round2(creditApplied + currentPaid);
      const recalculatedNetDue = Math.max(0, round2(newTotal - creditApplied));
      let recalculatedStatus = updates.paymentStatus || oldData.paymentStatus;
      if (updates.paymentStatus === undefined || updates.total !== undefined) {
        if (totalSettled >= newTotal - 0.01) {
          recalculatedStatus = 'paid';
        } else if (totalSettled > 0.01) {
          recalculatedStatus = 'partial';
        } else {
          recalculatedStatus = 'pending';
        }
      }

      const mergedUpdates = {
        ...updates,
        netDue: recalculatedNetDue,
        paymentStatus: recalculatedStatus,
        updatedAt: new Date().toISOString(),
      };

      // ─── PHASE 2: ALL WRITES ───
      // Apply order field updates
      transaction.update(orderRef, mergedUpdates);

      // If the total, items, division, or deliveryDate changed, keep the ledger in sync
      if (
        (updates.total !== undefined && totalDiff !== 0) || 
        updates.deliveryDate !== undefined ||
        updates.division !== undefined ||
        updates.items !== undefined
      ) {
        if (oldData.clientId && oldData.clientId !== 'direct') {
          // Delete all old invoice ledger entries for this order
          ledgerSnap.forEach((lDoc) => {
            transaction.delete(lDoc.ref);
          });

          // Recreate them freshly split
          const { products } = useDataStore.getState();
          const finalDivision = updates.division ?? oldData.division;
          const finalItems = updates.items ?? oldData.items;
          const finalDeliveryDate = updates.deliveryDate ?? oldData.deliveryDate;
          const finalTotal = updates.total ?? oldData.total;
          
          const baseLedger = {
            type: 'invoice',
            clientId: oldData.clientId,
            invoiceId: orderId,
            createdAt: new Date().toISOString(),
            billDate: finalDeliveryDate,
          };

          if (finalDivision === 'all') {
            let primaryTotal = 0;
            let bakeryTotal = 0;
            const primaryNames: string[] = [];
            const bakeryNames: string[] = [];
    
            finalItems.forEach((i: any) => {
              const prod = products.find((p: any) => p.id === i.productId);
              const div = getProductDivision(prod || { name: i.productName });
              if (div === 'primary') {
                primaryTotal += i.total;
                primaryNames.push(i.productName);
              } else {
                bakeryTotal += i.total;
                bakeryNames.push(i.productName);
              }
            });
    
            if (primaryTotal > 0) {
              const primaryLedgerRef = doc(collection(db, 'ledger'));
              transaction.set(primaryLedgerRef, {
                ...baseLedger,
                id: primaryLedgerRef.id,
                amount: primaryTotal,
                description: `Daily Bill - Primary (${primaryNames.join(', ')})`,
                division: 'primary'
              });
            }
            if (bakeryTotal > 0) {
              const bakeryLedgerRef = doc(collection(db, 'ledger'));
              transaction.set(bakeryLedgerRef, {
                ...baseLedger,
                id: bakeryLedgerRef.id,
                amount: bakeryTotal,
                description: `Daily Bill - Bakery (${bakeryNames.join(', ')})`,
                division: 'bakery'
              });
            }
          } else {
            const ledgerRef = doc(collection(db, 'ledger'));
            transaction.set(ledgerRef, {
              ...baseLedger,
              id: ledgerRef.id,
              amount: finalTotal,
              description: `Daily Bill (${finalItems.map((i: any) => i.productName).join(', ')})`,
              division: finalDivision
            });
          }
        }
      }
      return {
        clientIdToSync: oldData.clientId !== 'direct' ? oldData.clientId : null,
        oldItems: oldData.items,
        oldUpdatedAt: oldData.updatedAt,
        oldClientName: oldData.clientName,
      };
    });
    
    if (result.clientIdToSync) {
      await verifyAndSyncClientTotals(result.clientIdToSync);
    }

    // ── Stock integration (additive — runs after billing transaction) ────────
    try {
      await adjustFinishedStockForOrderUpdate({
        orderId,
        clientId: result.clientIdToSync || 'direct',
        clientName: result.oldClientName || '',
        oldItems: result.oldItems || [],
        oldUpdatedAt: result.oldUpdatedAt || '',
        newItems: updates.items ?? result.oldItems ?? [],
        newUpdatedAt: updates.updatedAt || new Date().toISOString(),
        deliveryDate: updates.deliveryDate ?? (result.oldItems?.[0] ? '' : ''),
        division: updates.division ?? 'primary',
      });
    } catch (stockErr) {
      console.error('[Stock] Failed to adjust stock for order update:', stockErr);
    }
    // ── End stock integration ─────────────────────────────────────────────────
  } catch (error) {
    console.error("Error updating order:", error);
    toast.error('Failed to update order');
    throw error;
  }
}


// Payments
export async function updatePayment(paymentId: string, updates: any) {
  const currentUser = useAuthStore.getState().user;
  if (!currentUser || currentUser.role !== 'admin') {
    throw new Error('Staff members are not authorized to edit or correct recorded payments. Admin access required.');
  }

  if (updates.amount !== undefined) {
    const reason = (updates.correctionReason || '').trim();
    if (!reason) {
      throw new Error('A correction reason is required before submitting a payment correction.');
    }

    try {
      const res = await callCorrectPayment({
        paymentId,
        newAmount: Number(updates.amount),
        correctionReason: reason,
        division: updates.division,
        paymentDate: updates.paymentDate,
        method: updates.method,
        reference: updates.reference,
        notes: updates.notes,
      });
      return res;
    } catch (err: any) {
      console.error('[Payments] Server-side payment correction failed:', err);
      throw new Error(err?.message || 'Failed to correct payment on the trusted server.');
    }
  }

  // Non-amount updates (metadata like reference or notes)
  try {
    const paymentRef = doc(db, COLLECTIONS.PAYMENTS, paymentId);
    const metadataUpdates: any = { updatedAt: new Date().toISOString() };
    if (updates.notes !== undefined) metadataUpdates.notes = updates.notes;
    if (updates.reference !== undefined) metadataUpdates.reference = updates.reference;
    await updateDoc(paymentRef, metadataUpdates);
  } catch (error: any) {
    console.error("Error updating payment metadata:", error);
    toast.error('Failed to update payment');
    throw error;
  }
}

export async function recordPaymentAtomic(paymentData: any) {
  enforceStaffOrAdmin();
  const {
    clientId,
    amount,
    method,
    billDate,
    paymentDate,
    invoiceId,
    otherInvoiceId,
    reference,
    notes,
    division,
    orderType,
    idempotencyKey,
  } = paymentData;

  const isDirectSale = orderType === 'direct' || clientId === 'direct';

  if (!isDirectSale && !clientId) throw new Error("Missing client ID");
  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    throw new Error("Invalid payment amount. Amount must be greater than ₹0.");
  }

  const cleanKey = (idempotencyKey || '').trim();
  if (!cleanKey) {
    throw new Error("Missing durable idempotencyKey. Every payment submission must include a unique operation key.");
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(cleanKey)) {
    throw new Error("Invalid idempotencyKey format. Must be an 8–128 character identifier (letters, digits, underscores, hyphens).");
  }

  const currentUser = useAuthStore.getState().user;
  const isStaff = currentUser?.role === 'staff';
  const todayLocalStr = getTodayLocalDateString();

  const effectivePaymentDate = isStaff ? todayLocalStr : (paymentDate || todayLocalStr);
  const effectiveBillDate = isStaff
    ? (invoiceId ? (billDate || effectivePaymentDate) : effectivePaymentDate)
    : (billDate || effectivePaymentDate);

  try {
    const result = await callRecordPayment({
      clientId: isDirectSale ? 'direct' : clientId,
      amount,
      paymentDate: effectivePaymentDate,
      billDate: effectiveBillDate,
      invoiceId: invoiceId || null,
      otherInvoiceId: otherInvoiceId || null,
      division: division === 'bakery' ? 'bakery' : 'primary',
      method: method || 'cash',
      reference: reference ? String(reference).trim() : null,
      notes: notes ? String(notes).trim() : null,
      idempotencyKey: cleanKey,
      orderType: isDirectSale ? 'direct' : 'client',
    });

    return result;
  } catch (err: any) {
    console.error('[Payments] Server-side payment recording failed:', err);
    // Task 7: Never fall back to legacy direct Firestore financial writes.
    throw new Error(err?.message || 'Failed to record payment on the trusted server.');
  }
}

export interface DirectSaleItem {
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface DirectSaleInput {
  date: string;
  items: DirectSaleItem[];
  division?: Division;
  notes?: string;
  reference?: string;
  payment?: {
    amount: number;
    method: PaymentMethod;
    reference?: string;
  };
}

export async function createDirectSale(input: DirectSaleInput, customIdempotencyKey?: string): Promise<string> {
  enforceStaffOrAdmin();
  const paymentAmount = input.payment && input.payment.amount > 0 ? round2(input.payment.amount) : 0;

  // Derive durable idempotency key: reuse caller key if provided, or generate deterministic key
  const durableKey = customIdempotencyKey || (
    input.payment?.reference && input.payment.reference.startsWith('pay_')
      ? input.payment.reference
      : `pay_direct_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  );

  try {
    const result = await callRecordPayment({
      orderType: 'direct',
      clientId: 'direct',
      amount: paymentAmount,
      method: input.payment?.method || 'cash',
      reference: input.payment?.reference || input.reference || null,
      notes: input.notes || null,
      paymentDate: input.date,
      billDate: input.date,
      division: input.division || 'primary',
      idempotencyKey: durableKey,
      directSale: {
        items: input.items,
        date: input.date,
        division: input.division || 'primary',
        notes: input.notes || null,
        reference: input.reference || null,
      },
    });

    if (!result.orderId) {
      throw new Error('Server committed direct sale without returning an orderId.');
    }

    return result.orderId;
  } catch (err: any) {
    console.error('[DirectSale] Atomic direct sale recording failed:', err);
    throw new Error(err?.message || 'Failed to record direct sale on the trusted server.');
  }
}

// Pricing
export async function saveClientPricing(clientId: string, division: string, pricingData: Record<string, number>) {
  enforceAdmin();
  try {
    const docRef = doc(db, COLLECTIONS.PRICING, clientId);
    await setDoc(docRef, { [division]: pricingData }, { merge: true });
  } catch (error) {
    console.error("Error saving pricing:", error);
    throw error;
  }
}

// Regions - We can store regions as a single document containing an array to keep it simple and match the mock data structure
export async function saveRegions(regions: string[]) {
  enforceAdmin();
  try {
    const docRef = doc(db, 'config', 'regions');
    await setDoc(docRef, { list: regions });
  } catch (error) {
    console.error("Error saving regions:", error);
    throw error;
  }
}

export function subscribeToRegions(
  callback: (regions: string[]) => void,
  onError?: (error: FirestoreError) => void
) {
  return onSnapshot(doc(db, 'config', 'regions'), (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data().list || []);
    } else {
      callback([]);
    }
  }, (error) => {
    console.error('Error subscribing to regions:', error);
    onError?.(error);
  });
}

// Trash System Restoration & Permanent Delete
export async function restoreFromTrash(trashDocId: string, trashData: any) {
  enforceAdmin();
  if (trashData.originalCollection === 'payments') {
    throw new Error('Direct restoration of payments is prohibited. Use payment correction (callCorrectPayment) or record a new payment to maintain authoritative ledger and balance integrity.');
  }
  try {
    const batch = writeBatch(db);

    // Restore to original collection
    const originalRef = doc(db, trashData.originalCollection, trashDocId);
    batch.set(originalRef, trashData.originalData);

    // Remove from trash
    const trashRef = doc(db, 'trash', trashDocId);
    batch.delete(trashRef);

    // If restoring an order or payment, we must also restore the ledger entry and update client
    if (trashData.originalCollection === 'orders') {
      if (trashData.originalData?.clientId && trashData.originalData.clientId !== 'direct') {
        // Find and restore the associated ledger debit from trash
        const lTrashQuery = query(
          collection(db, 'trash'), 
          where('originalCollection', '==', 'ledger'),
          where('originalData.type', '==', 'invoice'),
          where('originalData.invoiceId', '==', trashDocId)
        );
        const lTrashSnap = await getDocs(lTrashQuery);
        lTrashSnap.forEach((lDoc) => {
          const lData = lDoc.data();
          const lRef = doc(db, 'ledger', lData.originalDocumentId);
          batch.set(lRef, lData.originalData);
          batch.delete(lDoc.ref);
        });
      }

      // Find and restore associated payments from trash (for both client orders and direct sales)
      const pTrashQuery = query(
        collection(db, 'trash'),
        where('originalCollection', '==', 'payments'),
        where('originalData.invoiceId', '==', trashDocId)
      );
      const pTrashSnap = await getDocs(pTrashQuery);
      pTrashSnap.forEach((pDoc) => {
        const pData = pDoc.data();
        const pRef = doc(db, 'payments', pData.originalDocumentId);
        batch.set(pRef, pData.originalData);
        batch.delete(pDoc.ref);
      });

      if (trashData.originalData?.clientId && trashData.originalData.clientId !== 'direct') {
        // Find and restore associated payment ledger entries from trash
        const plTrashQuery = query(
          collection(db, 'trash'),
          where('originalCollection', '==', 'ledger'),
          where('originalData.type', '==', 'payment'),
          where('originalData.invoiceId', '==', trashDocId)
        );
        const plTrashSnap = await getDocs(plTrashQuery);
        plTrashSnap.forEach((lDoc) => {
          const lData = lDoc.data();
          const lRef = doc(db, 'ledger', lData.originalDocumentId);
          batch.set(lRef, lData.originalData);
          batch.delete(lDoc.ref);
        });
      }
    } else if (trashData.originalCollection === 'payments') {
      if (trashData.originalData?.clientId && trashData.originalData.clientId !== 'direct') {
        // Find and restore the associated ledger credit from trash
        const lTrashQuery = query(
          collection(db, 'trash'), 
          where('originalCollection', '==', 'ledger'),
          where('originalData.type', '==', 'payment'),
          where('originalData.paymentId', '==', trashDocId)
        );
        const lTrashSnap = await getDocs(lTrashQuery);
        lTrashSnap.forEach((lDoc) => {
          const lData = lDoc.data();
          const lRef = doc(db, 'ledger', lData.originalDocumentId);
          batch.set(lRef, lData.originalData);
          batch.delete(lDoc.ref);
        });
      }

      // If this payment was applied against an invoice/order, re-apply its contribution to the order document
      if (trashData.originalData?.invoiceId) {
        try {
          const orderRef = doc(db, COLLECTIONS.ORDERS, trashData.originalData.invoiceId);
          const orderSnap = await getDoc(orderRef);
          if (orderSnap.exists()) {
            const oData = orderSnap.data();
            const reApplied = Number(trashData.originalData.appliedAmount !== undefined ? trashData.originalData.appliedAmount : (trashData.originalData.amount || 0));
            const currentPaid = Number(oData.paidAmount || 0);
            const newPaid = round2(currentPaid + reApplied);
            const netDue = Number(oData.netDue !== undefined ? oData.netDue : (oData.total || 0));
            const newStatus = newPaid >= netDue - 0.01 ? 'paid' : (newPaid > 0.01 ? 'partial' : 'pending');
            batch.update(orderRef, {
              paidAmount: newPaid,
              paymentStatus: newStatus,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (ordErr) {
          console.warn('[Restore] Could not update order on payment restore:', ordErr);
        }
      }

      // If this payment also settled a counterpart division order, re-apply its contribution too
      if (trashData.originalData?.otherInvoiceId && Number(trashData.originalData.appliedToOtherBill) > 0) {
        try {
          const otherRef = doc(db, COLLECTIONS.ORDERS, trashData.originalData.otherInvoiceId);
          const otherSnap = await getDoc(otherRef);
          if (otherSnap.exists()) {
            const otherData = otherSnap.data();
            const otherReApplied = Number(trashData.originalData.appliedToOtherBill);
            const otherCurrentPaid = Number(otherData.paidAmount || 0);
            const otherNewPaid = round2(otherCurrentPaid + otherReApplied);
            const otherNetDue = Number(otherData.netDue !== undefined ? otherData.netDue : (otherData.total || 0));
            const otherNewStatus = otherNewPaid >= otherNetDue - 0.01 ? 'paid' : (otherNewPaid > 0.01 ? 'partial' : 'pending');
            batch.update(otherRef, {
              paidAmount: otherNewPaid,
              paymentStatus: otherNewStatus,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (otherErr) {
          console.warn('[Restore] Could not update counterpart order on payment restore:', otherErr);
        }
      }
    }

    await batch.commit();
    if (trashData.originalData?.clientId && trashData.originalData.clientId !== 'direct') {
      await verifyAndSyncClientTotals(trashData.originalData.clientId);
    }

    // ── Stock integration — re-apply stock deductions when order is restored ──
    if (trashData.originalCollection === 'orders' && trashData.originalData?.items) {
      try {
        const originalOrderId = trashData.originalData.id; // always the real order ID
        const restoreTimestamp = new Date().toISOString();
        await createFinishedStockDeductionsForOrder({
          orderId: originalOrderId,
          clientId: trashData.originalData.clientId || '',
          clientName: trashData.originalData.clientName || '',
          items: trashData.originalData.items,
          deliveryDate: trashData.originalData.deliveryDate || '',
          division: trashData.originalData.division || 'primary',
          versionKey: restoreTimestamp,
        });
      } catch (stockErr) {
        console.error('[Stock] Failed to re-apply stock for restored order:', stockErr);
      }
    }
    // ── End stock integration ─────────────────────────────────────────────────

    toast.success('Restored successfully');
  } catch (error) {
    console.error("Error restoring:", error);
    toast.error('Failed to restore');
    throw error;
  }
}

export async function permanentlyDeleteFromTrash(trashDocId: string) {
  enforceAdmin();
  try {
    const trashRef = doc(db, 'trash', trashDocId);
    const trashSnap = await getDoc(trashRef);
    
    if (!trashSnap.exists()) throw new Error('Trash document not found');
    const trashData = trashSnap.data();
    
    const batch = writeBatch(db);
    batch.delete(trashRef);

    if (trashData.originalCollection === 'orders' || trashData.originalCollection === 'payments') {
      const type = trashData.originalCollection === 'orders' ? 'invoice' : 'payment';
      const idField = trashData.originalCollection === 'orders' ? 'invoiceId' : 'paymentId';
      
      const lTrashQuery = query(
        collection(db, 'trash'), 
        where('originalCollection', '==', 'ledger'),
        where('originalData.type', '==', type),
        where(`originalData.${idField}`, '==', trashDocId)
      );
      const lTrashSnap = await getDocs(lTrashQuery);
      lTrashSnap.forEach((lDoc) => {
        batch.delete(lDoc.ref);
      });

      if (trashData.originalCollection === 'orders') {
        // Also permanently delete all associated payments from trash
        const pTrashQuery = query(
          collection(db, 'trash'),
          where('originalCollection', '==', 'payments'),
          where('originalData.invoiceId', '==', trashDocId)
        );
        const pTrashSnap = await getDocs(pTrashQuery);
        pTrashSnap.forEach((pDoc) => {
          batch.delete(pDoc.ref);
        });

        // Also permanently delete all associated payment ledger entries from trash
        const plTrashQuery = query(
          collection(db, 'trash'),
          where('originalCollection', '==', 'ledger'),
          where('originalData.type', '==', 'payment'),
          where('originalData.invoiceId', '==', trashDocId)
        );
        const plTrashSnap = await getDocs(plTrashQuery);
        plTrashSnap.forEach((lDoc) => {
          batch.delete(lDoc.ref);
        });
      }
    }

    await batch.commit();
    toast.success('Permanently deleted');
  } catch (error) {
    console.error("Error permanently deleting:", error);
    toast.error('Failed to delete permanently');
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin-Only Test Data Cleanup
// ─────────────────────────────────────────────────────────────────────────────

export interface TestDataSummary {
  ordersCount: number;
  clientOrdersCount: number;
  directOrdersCount: number;
  paymentsCount: number;
  paymentsLinkedToOrdersCount: number;
  standalonePaymentsCount: number;
  ledgerInvoicesCount: number;
  ledgerPaymentsCount: number;
  ledgerOpeningBalancesCount: number;
  affectedClientsCount: number;
  trashCount: number;
  orderStockTransactionsCount: number;
  stockSyncStatusCount: number;
}

export interface TestDataCleanupResult {
  deletedOrdersCount: number;
  deletedPaymentsCount: number;
  deletedLedgerEntriesCount: number;
  recalculatedClientsCount: number;
  deletedTrashCount: number;
  deletedStockTransactionsCount: number;
  deletedStockSyncStatusCount: number;
  preservedStandalonePaymentsCount: number;
  preservedOpeningBalancesCount: number;
}

export async function getTestDataSummary(): Promise<TestDataSummary> {
  enforceAdmin();

  const [ordersSnap, paymentsSnap, ledgerSnap, trashSnap, fstSnap, syncSnap] = await Promise.all([
    getDocs(collection(db, COLLECTIONS.ORDERS)),
    getDocs(collection(db, COLLECTIONS.PAYMENTS)),
    getDocs(collection(db, 'ledger')),
    getDocs(collection(db, 'trash')),
    getDocs(collection(db, 'finishedStockTransactions')),
    getDocs(collection(db, 'stockSyncStatus')),
  ]);

  const orderIds = new Set(ordersSnap.docs.map(d => d.id));
  const clientOrders = ordersSnap.docs.filter(d => d.data().clientId !== 'direct' && d.data().orderType !== 'direct');
  const directOrders = ordersSnap.docs.filter(d => d.data().clientId === 'direct' || d.data().orderType === 'direct');

  const linkedPayments = paymentsSnap.docs.filter(d => d.data().invoiceId && orderIds.has(d.data().invoiceId));
  const standalonePayments = paymentsSnap.docs.filter(d => !d.data().invoiceId || !orderIds.has(d.data().invoiceId));

  const ledgerInvoices = ledgerSnap.docs.filter(d => d.data().type === 'invoice' && d.data().invoiceId && orderIds.has(d.data().invoiceId));
  const ledgerPayments = ledgerSnap.docs.filter(d => d.data().type === 'payment' && ((d.data().invoiceId && orderIds.has(d.data().invoiceId)) || linkedPayments.some(p => p.id === d.data().paymentId)));
  const ledgerOpening = ledgerSnap.docs.filter(d => d.data().type === 'opening_balance');

  const affectedClients = new Set<string>();
  ordersSnap.docs.forEach(d => {
    const cid = d.data().clientId;
    if (cid && cid !== 'direct') affectedClients.add(cid);
  });

  const orderStockTransactions = fstSnap.docs.filter(d => d.data().orderId && orderIds.has(d.data().orderId));
  const syncDocs = syncSnap.docs.filter(d => orderIds.has(d.id) || (d.data().orderId && orderIds.has(d.data().orderId)));

  const testTrash = trashSnap.docs.filter(d => ['orders', 'payments', 'ledger'].includes(d.data().originalCollection));

  return {
    ordersCount: ordersSnap.docs.length,
    clientOrdersCount: clientOrders.length,
    directOrdersCount: directOrders.length,
    paymentsCount: paymentsSnap.docs.length,
    paymentsLinkedToOrdersCount: linkedPayments.length,
    standalonePaymentsCount: standalonePayments.length,
    ledgerInvoicesCount: ledgerInvoices.length,
    ledgerPaymentsCount: ledgerPayments.length,
    ledgerOpeningBalancesCount: ledgerOpening.length,
    affectedClientsCount: affectedClients.size,
    trashCount: testTrash.length,
    orderStockTransactionsCount: orderStockTransactions.length,
    stockSyncStatusCount: syncDocs.length,
  };
}

export async function cleanupTestData(options: {
  preserveStandalonePayments?: boolean;
  purgeTrash?: boolean;
  purgeStockTransactions?: boolean;
} = {}): Promise<TestDataCleanupResult> {
  enforceAdmin();

  const {
    preserveStandalonePayments = true,
    purgeTrash = true,
    purgeStockTransactions = true,
  } = options;

  // 1. Fetch current collections
  const [ordersSnap, paymentsSnap, ledgerSnap, trashSnap, fstSnap, syncSnap] = await Promise.all([
    getDocs(collection(db, COLLECTIONS.ORDERS)),
    getDocs(collection(db, COLLECTIONS.PAYMENTS)),
    getDocs(collection(db, 'ledger')),
    getDocs(collection(db, 'trash')),
    getDocs(collection(db, 'finishedStockTransactions')),
    getDocs(collection(db, 'stockSyncStatus')),
  ]);

  const orderIds = new Set(ordersSnap.docs.map(d => d.id));
  const affectedClientIds = new Set<string>();

  ordersSnap.docs.forEach(d => {
    const data = d.data();
    if (data.clientId && data.clientId !== 'direct') {
      affectedClientIds.add(data.clientId);
    }
  });

  // Identify payments to delete
  const paymentsToDelete: string[] = [];
  let preservedStandaloneCount = 0;

  paymentsSnap.docs.forEach(d => {
    const data = d.data();
    const isLinked = data.invoiceId && orderIds.has(data.invoiceId);
    if (isLinked) {
      paymentsToDelete.push(d.id);
      if (data.clientId && data.clientId !== 'direct') {
        affectedClientIds.add(data.clientId);
      }
    } else {
      if (preserveStandalonePayments) {
        preservedStandaloneCount++;
      } else {
        paymentsToDelete.push(d.id);
        if (data.clientId && data.clientId !== 'direct') {
          affectedClientIds.add(data.clientId);
        }
      }
    }
  });

  const paymentIdsToDeleteSet = new Set(paymentsToDelete);

  // Identify ledger entries to delete
  const ledgerToDelete: string[] = [];
  let preservedOpeningCount = 0;

  ledgerSnap.docs.forEach(d => {
    const data = d.data();
    if (data.type === 'opening_balance') {
      preservedOpeningCount++;
      return; // Never delete opening balances
    }

    if (data.type === 'invoice') {
      if (data.invoiceId && orderIds.has(data.invoiceId)) {
        ledgerToDelete.push(d.id);
        if (data.clientId && data.clientId !== 'direct') {
          affectedClientIds.add(data.clientId);
        }
      }
    } else if (data.type === 'payment') {
      const isOrderLinked = (data.invoiceId && orderIds.has(data.invoiceId)) || (data.paymentId && paymentIdsToDeleteSet.has(data.paymentId));
      if (isOrderLinked) {
        ledgerToDelete.push(d.id);
        if (data.clientId && data.clientId !== 'direct') {
          affectedClientIds.add(data.clientId);
        }
      } else if (!preserveStandalonePayments) {
        ledgerToDelete.push(d.id);
        if (data.clientId && data.clientId !== 'direct') {
          affectedClientIds.add(data.clientId);
        }
      }
    }
  });

  // Identify trash documents to delete (only orders, payments, ledger)
  const trashToDelete: string[] = [];
  if (purgeTrash) {
    trashSnap.docs.forEach(d => {
      const col = d.data().originalCollection;
      if (['orders', 'payments', 'ledger'].includes(col)) {
        trashToDelete.push(d.id);
      }
    });
  }

  // Identify stock transactions and sync status docs to delete
  const stockTxToDelete: string[] = [];
  const syncDocsToDelete: string[] = [];
  if (purgeStockTransactions) {
    fstSnap.docs.forEach(d => {
      if (d.data().orderId && orderIds.has(d.data().orderId)) {
        stockTxToDelete.push(d.id);
      }
    });
    syncSnap.docs.forEach(d => {
      if (orderIds.has(d.id) || (d.data().orderId && orderIds.has(d.data().orderId))) {
        syncDocsToDelete.push(d.id);
      }
    });
  }

  // 2. Safe batch delete execution in chunks of 250 (limit is 500)
  const executeBatchDeletes = async (colName: string, docIds: string[]) => {
    const BATCH_SIZE = 250;
    for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
      const chunk = docIds.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach(id => {
        batch.delete(doc(db, colName, id));
      });
      await batch.commit();
    }
  };

  // Delete orders
  await executeBatchDeletes(COLLECTIONS.ORDERS, Array.from(orderIds));

  // Delete payments
  await executeBatchDeletes(COLLECTIONS.PAYMENTS, paymentsToDelete);

  // Delete ledger entries
  await executeBatchDeletes('ledger', ledgerToDelete);

  // Delete stock transactions & sync status
  if (stockTxToDelete.length > 0) {
    await executeBatchDeletes('finishedStockTransactions', stockTxToDelete);
  }
  if (syncDocsToDelete.length > 0) {
    await executeBatchDeletes('stockSyncStatus', syncDocsToDelete);
  }

  // Delete trash documents
  if (trashToDelete.length > 0) {
    await executeBatchDeletes('trash', trashToDelete);
  }

  // 3. Recalculate client totals atomically for all affected clients
  for (const clientId of affectedClientIds) {
    try {
      await verifyAndSyncClientTotals(clientId);
    } catch (syncErr) {
      console.error(`[Cleanup] Failed to recalculate totals for client ${clientId}:`, syncErr);
    }
  }

  toast.success('Test data cleanup completed successfully');

  return {
    deletedOrdersCount: orderIds.size,
    deletedPaymentsCount: paymentsToDelete.length,
    deletedLedgerEntriesCount: ledgerToDelete.length,
    recalculatedClientsCount: affectedClientIds.size,
    deletedTrashCount: trashToDelete.length,
    deletedStockTransactionsCount: stockTxToDelete.length,
    deletedStockSyncStatusCount: syncDocsToDelete.length,
    preservedStandalonePaymentsCount: preservedStandaloneCount,
    preservedOpeningBalancesCount: preservedOpeningCount,
  };
}
