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
import { getProductDivision } from '../lib/utils';
import { useDataStore } from '../stores/dataStore';
import { type Division, type PaymentMethod, type ClientOpeningBalance, type Order } from '../types';

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
    const ordersQuery = query(collection(db, 'orders'), where('clientId', '==', clientId));
    const paymentsQuery = query(collection(db, 'payments'), where('clientId', '==', clientId));
    const ledgerQuery = query(collection(db, 'ledger'), where('clientId', '==', clientId));
    
    const [ordersSnap, paymentsSnap, ledgerSnap] = await Promise.all([
      getDocs(ordersQuery),
      getDocs(paymentsQuery),
      getDocs(ledgerQuery)
    ]);

    const validOrderIds = new Set<string>();
    ordersSnap.forEach(doc => validOrderIds.add(doc.id));

    const validPaymentIds = new Set<string>();
    paymentsSnap.forEach(doc => {
      const data = doc.data();
      // Valid if not tied to an order (general/opening-balance payment) OR tied to an existing valid order
      if (!data.invoiceId || validOrderIds.has(data.invoiceId)) {
        validPaymentIds.add(doc.id);
      }
    });

    const batch = writeBatch(db);
    let hasOrphans = false;

    // 1. Delete Orphan Payments
    paymentsSnap.forEach(doc => {
      if (!validPaymentIds.has(doc.id)) {
        console.warn(`[Integrity] Deleting orphan payment ${doc.id}`);
        batch.delete(doc.ref);
        hasOrphans = true;
      }
    });

    const primaryTotals = { totalInvoiced: 0, totalPaid: 0, totalOrders: 0, openingBalance: 0 };
    const bakeryTotals = { totalInvoiced: 0, totalPaid: 0, totalOrders: 0, openingBalance: 0 };

    // 2. Process Ledger & Delete Orphan Ledger Entries
    ledgerSnap.forEach(doc => {
      const data = doc.data();
      
      let isOrphan = false;
      if (data.type === 'invoice' && (!data.invoiceId || !validOrderIds.has(data.invoiceId))) {
        isOrphan = true;
      } else if (data.type === 'payment' && (!data.paymentId || !validPaymentIds.has(data.paymentId))) {
        isOrphan = true;
      }

      if (isOrphan) {
        console.warn(`[Integrity] Deleting orphan ledger entry ${doc.id}`);
        batch.delete(doc.ref);
        hasOrphans = true;
      } else {
        const isBakery = data.division === 'bakery';
        const target = isBakery ? bakeryTotals : primaryTotals;
        
        if (data.type === 'invoice') {
          target.totalInvoiced += (data.amount || 0);
          target.totalOrders += 1;
        } else if (data.type === 'payment') {
          target.totalPaid += (data.amount || 0);
        } else if (data.type === 'opening_balance') {
          target.openingBalance += (data.amount || 0);
        }
      }
    });

    if (hasOrphans) {
      await batch.commit();
      console.log(`[Integrity] Cleaned up orphans for client ${clientId}`);
    }

    const primaryOpening = primaryTotals.openingBalance || 0;
    const bakeryOpening = bakeryTotals.openingBalance || 0;
    const primaryRawBalance = primaryOpening + primaryTotals.totalInvoiced - primaryTotals.totalPaid;
    const bakeryRawBalance = bakeryOpening + bakeryTotals.totalInvoiced - bakeryTotals.totalPaid;

    const primaryOutstanding = Math.max(0, primaryRawBalance);
    const primaryCredit = primaryRawBalance < 0 ? Math.abs(primaryRawBalance) : 0;

    const bakeryOutstanding = Math.max(0, bakeryRawBalance);
    const bakeryCredit = bakeryRawBalance < 0 ? Math.abs(bakeryRawBalance) : 0;
    
    // Cross-division totals for fallback
    const totalOpening = primaryOpening + bakeryOpening;
    const totalInvoiced = primaryTotals.totalInvoiced + bakeryTotals.totalInvoiced;
    const totalPaid = primaryTotals.totalPaid + bakeryTotals.totalPaid;
    const outstanding = primaryOutstanding + bakeryOutstanding;
    const availableCredit = primaryCredit + bakeryCredit;
    const rawBalance = primaryRawBalance + bakeryRawBalance;
    const totalOrders = primaryTotals.totalOrders + bakeryTotals.totalOrders;

    const clientRef = doc(db, COLLECTIONS.CLIENTS, clientId);
    
    // We overwrite the client doc without a transaction to enforce the ledger as the ultimate source of truth
    await updateDoc(clientRef, {
      totalRevenue: totalInvoiced,
      totalPaid,
      outstanding,
      credit: availableCredit,
      availableCredit,
      primaryCredit,
      bakeryCredit,
      rawBalance,
      totalOrders,
      openingBalanceAmount: totalOpening,
      primaryTotals: {
        totalRevenue: primaryTotals.totalInvoiced,
        totalPaid: primaryTotals.totalPaid,
        outstanding: primaryOutstanding,
        credit: primaryCredit,
        rawBalance: primaryRawBalance,
        totalOrders: primaryTotals.totalOrders,
        openingBalance: primaryOpening,
      },
      bakeryTotals: {
        totalRevenue: bakeryTotals.totalInvoiced,
        totalPaid: bakeryTotals.totalPaid,
        outstanding: bakeryOutstanding,
        credit: bakeryCredit,
        rawBalance: bakeryRawBalance,
        totalOrders: bakeryTotals.totalOrders,
        openingBalance: bakeryOpening,
      }
    });
    
    console.log(`[Integrity] Client ${clientId} synced. Opening: ${totalOpening}, Primary Out: ${primaryOutstanding} (Credit: ${primaryCredit}), Bakery Out: ${bakeryOutstanding} (Credit: ${bakeryCredit})`);
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
    const clientData = clientSnap.data();

    const amount = Number(input.amount) || 0;
    if (amount < 0) throw new Error('Opening balance amount cannot be negative');

    const asOfDate = input.asOfDate || new Date().toISOString().split('T')[0];
    const notes = input.notes?.trim() || '';
    const division: Division = input.division === 'bakery' ? 'bakery' : 'primary';

    // Find any existing opening_balance ledger entries for this client
    const ledgerQuery = query(
      collection(db, 'ledger'),
      where('clientId', '==', clientId),
      where('type', '==', 'opening_balance')
    );
    const ledgerSnap = await getDocs(ledgerQuery);

    const batch = writeBatch(db);

    if (amount > 0) {
      const ledgerDocRef = ledgerSnap.empty
        ? doc(collection(db, 'ledger'))
        : ledgerSnap.docs[0].ref;

      // Remove any duplicate opening_balance entries if present
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
        description: notes ? `Opening Balance - ${notes}` : 'Opening Balance',
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

      batch.update(clientRef, {
        openingBalance: openingRecord,
        openingBalanceAmount: amount,
      });
    } else {
      // If amount is 0, delete existing opening balance ledger entries
      ledgerSnap.forEach(d => batch.delete(d.ref));
      batch.update(clientRef, {
        openingBalance: null,
        openingBalanceAmount: 0,
      });
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
      // Critical Safety: Check for existing payment dependencies
      const paymentsQuery = query(
        collection(db, 'payments'),
        where('invoiceId', '==', docId)
      );
      const paymentsSnap = await getDocs(paymentsQuery);
      const activePayments = paymentsSnap.docs.filter(p => !p.data().deletedAt);
      if (activePayments.length > 0) {
        const totalPaid = activePayments.reduce((s, p) => s + (p.data().amount || 0), 0);
        throw new Error(
          `Cannot delete order #${docId.slice(0, 8)}: Order has ${activePayments.length} recorded payment(s) totalling ₹${totalPaid.toLocaleString('en-IN')}. Deletion is blocked to protect payment records and client ledger balances.`
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
    } else if (originalCollection === 'payments' && originalData?.clientId && originalData.clientId !== 'direct') {
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

    // 1. Build payment lookup from store state
    const { payments: allPayments } = useDataStore.getState();
    const paymentsByInvoice = new Map<string, any[]>();
    for (const p of allPayments || []) {
      if (!p.deletedAt && p.invoiceId) {
        const list = paymentsByInvoice.get(p.invoiceId) || [];
        list.push(p);
        paymentsByInvoice.set(p.invoiceId, list);
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
        // Double-check Firestore payments collection to guarantee no concurrent payments were added
        try {
          const paymentsSnap = await getDocs(
            query(collection(db, 'payments'), where('invoiceId', '==', order.id))
          );
          const activePayments = paymentsSnap.docs.filter(d => !d.data().deletedAt);
          if (activePayments.length > 0) {
            const totalPaid = activePayments.reduce((s, d) => s + (d.data().amount || 0), 0);
            failures.push({
              orderId: order.id,
              clientName: order.clientName || 'Direct Sale',
              reason: `Found active payment record in database (₹${totalPaid.toLocaleString('en-IN')}). Deletion blocked.`,
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
        const clientPrimaryCredit = clientDoc.primaryTotals?.credit !== undefined
          ? (clientDoc.primaryTotals.credit || 0)
          : (pRaw < 0 ? Math.abs(pRaw) : (clientDoc.primaryCredit || 0));

        const bRaw = clientDoc.bakeryTotals?.rawBalance !== undefined
          ? clientDoc.bakeryTotals.rawBalance
          : ((clientDoc.bakeryTotals?.openingBalance || 0) + (clientDoc.bakeryTotals?.totalRevenue || 0) - (clientDoc.bakeryTotals?.totalPaid || 0));
        const clientBakeryCredit = clientDoc.bakeryTotals?.credit !== undefined
          ? (clientDoc.bakeryTotals.credit || 0)
          : (bRaw < 0 ? Math.abs(bRaw) : (clientDoc.bakeryCredit || 0));

        if (orderData.division === 'primary') {
          creditApplied = Math.min(clientPrimaryCredit, total);
          primaryCreditApplied = creditApplied;
          bakeryCreditApplied = 0;
        } else if (orderData.division === 'bakery') {
          creditApplied = Math.min(clientBakeryCredit, total);
          primaryCreditApplied = 0;
          bakeryCreditApplied = creditApplied;
        } else if (orderData.division === 'all') {
          const { products } = useDataStore.getState();
          let pSub = 0;
          let bSub = 0;
          (orderData.items || []).forEach((i: any) => {
            const prod = products.find((p: any) => p.id === i.productId);
            const div = getProductDivision(prod || { name: i.productName });
            if (div === 'primary') pSub += i.total;
            else bSub += i.total;
          });
          primaryCreditApplied = Math.min(clientPrimaryCredit, pSub);
          bakeryCreditApplied = Math.min(clientBakeryCredit, bSub);
          creditApplied = primaryCreditApplied + bakeryCreditApplied;
        }
      }

      const netDue = Math.max(0, total - creditApplied);
      const paymentStatus = creditApplied >= total ? 'paid' : 'pending';

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
    const result = await runTransaction(db, async (transaction) => {
      const orderRef = doc(db, COLLECTIONS.ORDERS, orderId);
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error('Order not found');

      const oldData = orderSnap.data();
      const oldTotal: number = oldData.total || 0;
      const newTotal: number = updates.total ?? oldTotal;
      const totalDiff = newTotal - oldTotal;

      // Apply order field updates
      transaction.update(orderRef, updates);

      // If the total, items, division, or deliveryDate changed, keep the ledger in sync
      if (
        (updates.total !== undefined && totalDiff !== 0) || 
        updates.deliveryDate !== undefined ||
        updates.division !== undefined ||
        updates.items !== undefined
      ) {
        if (oldData.clientId && oldData.clientId !== 'direct') {
          // Delete all old invoice ledger entries for this order
          const ledgerQuery = query(
            collection(db, 'ledger'), 
            where('type', '==', 'invoice'), 
            where('invoiceId', '==', orderId)
          );
          const ledgerSnap = await getDocs(ledgerQuery);
          // It is generally safe to run getDocs in a transaction if we use transaction.delete
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
  enforceStaffOrAdmin();
  try {
    const clientIdToSync = await runTransaction(db, async (transaction) => {
      const paymentRef = doc(db, COLLECTIONS.PAYMENTS, paymentId);
      const paymentSnap = await transaction.get(paymentRef);
      if (!paymentSnap.exists()) throw new Error('Payment not found');

      const oldData = paymentSnap.data();
      const oldAmount: number = oldData.amount || 0;
      const newAmount: number = updates.amount ?? oldAmount;
      const amountDiff = newAmount - oldAmount;

      const paymentUpdates: any = { ...updates };

      if (oldData.invoiceId && updates.amount !== undefined) {
        const orderRef = doc(db, COLLECTIONS.ORDERS, oldData.invoiceId);
        const orderSnap = await transaction.get(orderRef);
        if (orderSnap.exists()) {
          const oDoc = orderSnap.data();
          const orderTotal = Number(oDoc.total || 0);
          const orderCreditApplied = Number(oDoc.creditApplied || 0);
          const orderNetDue = Math.max(0, orderTotal - orderCreditApplied);
          
          const newApplied = Math.min(newAmount, orderNetDue);
          const newExcess = Math.max(0, newAmount - orderNetDue);
          paymentUpdates.appliedAmount = newApplied;
          paymentUpdates.excessCredit = newExcess;
          paymentUpdates.isAdvance = newExcess > 0;
        }
      }

      transaction.update(paymentRef, paymentUpdates);

      if ((amountDiff !== 0 || updates.division !== undefined) && oldData.clientId && oldData.clientId !== 'direct') {
        // Keep the ledger credit entry in sync
        const ledgerQuery = query(
          collection(db, 'ledger'), 
          where('type', '==', 'payment'), 
          where('paymentId', '==', paymentId)
        );
        const ledgerSnap = await getDocs(ledgerQuery);
        ledgerSnap.forEach((lDoc) => {
          const lUpdates: any = {};
          if (amountDiff !== 0) lUpdates.amount = increment(amountDiff);
          if (updates.division !== undefined) lUpdates.division = updates.division;
          if (paymentUpdates.appliedAmount !== undefined) lUpdates.appliedAmount = paymentUpdates.appliedAmount;
          if (paymentUpdates.excessCredit !== undefined) lUpdates.excessCredit = paymentUpdates.excessCredit;
          
          if (Object.keys(lUpdates).length > 0) {
            transaction.update(lDoc.ref, lUpdates);
          }
        });
      }
      return oldData.clientId !== 'direct' ? oldData.clientId : null;
    });
    
    if (clientIdToSync) {
      await verifyAndSyncClientTotals(clientIdToSync);
    }
  } catch (error) {
    console.error("Error updating payment:", error);
    toast.error('Failed to update payment');
    throw error;
  }
}

export async function recordPaymentAtomic(paymentData: any) {
  enforceStaffOrAdmin();
  try {
    const {
      clientId,
      amount,
      method,
      updatedBy,
      billDate,
      paymentDate,
      clientName,
      invoiceId,
      reference,
      notes,
      region,
      staffId,
      staffName,
      orderType
    } = paymentData;
    
    const isDirectSale = orderType === 'direct' || clientId === 'direct';

    // Validate inputs
    if (!isDirectSale && !clientId) throw new Error("Missing client ID");
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      throw new Error("Invalid payment amount. Amount must be greater than ₹0.");
    }

    const currentUser = useAuthStore.getState().user;
    const effectiveStaffId = staffId || currentUser?.uid || null;
    const effectiveStaffName = staffName || paymentData.recordedBy || currentUser?.name || currentUser?.displayName || updatedBy || 'Staff';

    // If paying against an invoice, find existing payments on that invoice first
    let existingOrderPaid = 0;
    if (invoiceId) {
      try {
        const existingPaymentsSnap = await getDocs(
          query(collection(db, 'payments'), where('invoiceId', '==', invoiceId))
        );
        existingPaymentsSnap.docs.forEach(d => {
          const p = d.data();
          if (!p.deletedAt) {
            existingOrderPaid += (p.appliedAmount !== undefined ? p.appliedAmount : (p.amount || 0));
          }
        });
      } catch (err) {
        console.warn('Could not read existing payments for invoice:', err);
      }
    }

    await runTransaction(db, async (transaction) => {
      let resolvedRegion = region || (isDirectSale ? 'Direct Sale' : '');
      let resolvedClientName = clientName || (isDirectSale ? 'Direct Sale' : '');

      let appliedAmount = amount;
      let excessCredit = 0;
      let isAdvance = false;

      if (!isDirectSale) {
        // 1. Fetch Client
        const clientRef = doc(db, 'clients', clientId);
        const clientSnap = await transaction.get(clientRef);
        if (!clientSnap.exists()) throw new Error("Client not found");
        const clientDocData = clientSnap.data();
        resolvedRegion = region || clientDocData.region || '';
        resolvedClientName = clientName || clientDocData.name || '';

        if (invoiceId) {
          const orderRef = doc(db, COLLECTIONS.ORDERS, invoiceId);
          const orderSnap = await transaction.get(orderRef);
          if (orderSnap.exists()) {
            const oDoc = orderSnap.data();
            const orderTotal = Number(oDoc.total || 0);
            const orderCreditApplied = Number(oDoc.creditApplied || 0);
            const orderNetDue = Math.max(0, orderTotal - orderCreditApplied);
            const orderRemaining = Math.max(0, orderNetDue - existingOrderPaid);

            appliedAmount = Math.min(amount, orderRemaining);
            excessCredit = Math.max(0, amount - orderRemaining);

            const newPaid = existingOrderPaid + appliedAmount;
            const newStatus = (newPaid >= orderNetDue) ? 'paid' : (newPaid > 0 ? 'partial' : 'pending');

            transaction.update(orderRef, {
              paidAmount: newPaid,
              paymentStatus: newStatus,
              updatedAt: new Date().toISOString()
            });
          }
        } else {
          // Advance payment without a specific bill
          appliedAmount = 0;
          excessCredit = amount;
          isAdvance = true;
        }
      }
      
      // 2. Create Payment Document
      const paymentRef = doc(collection(db, COLLECTIONS.PAYMENTS));
      const pData: any = {
        id: paymentRef.id,
        orderType: isDirectSale ? 'direct' : 'client',
        clientId: isDirectSale ? 'direct' : clientId,
        clientName: resolvedClientName,
        region: resolvedRegion,
        invoiceId: invoiceId || null,
        amount,
        appliedAmount,
        excessCredit,
        isAdvance,
        method,
        reference: reference || null,
        notes: notes || null,
        billDate: billDate || null,
        paymentDate: paymentDate || (billDate ?? null),
        createdAt: paymentDate ? `${paymentDate} 00:00:00` : new Date().toISOString(),
        staffId: effectiveStaffId,
        staffName: effectiveStaffName,
        recordedBy: effectiveStaffName,
        updatedBy: effectiveStaffName,
        division: (paymentData.division === 'bakery' ? 'bakery' : 'primary') as 'primary' | 'bakery'
      };

      transaction.set(paymentRef, pData);
      
      // 3. Create Ledger Transaction (Credit) - ONLY FOR CLIENT ORDERS
      if (!isDirectSale) {
        const ledgerRef = doc(collection(db, 'ledger'));
        const ledgerDesc = invoiceId
          ? (excessCredit > 0
              ? `Payment received against bill (${method.replace('_', ' ')}) - Applied: ₹${appliedAmount.toFixed(2)}, Advance Credit: ₹${excessCredit.toFixed(2)}${reference ? ` - Ref: ${reference}` : ''}`
              : `Payment received (${method.replace('_', ' ')})${reference ? ` - Ref: ${reference}` : ''}`)
          : `Advance payment received (${method.replace('_', ' ')})${reference ? ` - Ref: ${reference}` : ''}`;

        transaction.set(ledgerRef, {
          id: ledgerRef.id,
          type: 'payment',
          paymentId: paymentRef.id,
          clientId,
          clientName: resolvedClientName,
          region: resolvedRegion,
          invoiceId: invoiceId || null,
          amount,
          appliedAmount,
          excessCredit,
          isAdvance,
          paymentDate: pData.createdAt,
          paymentMethod: method,
          description: ledgerDesc,
          createdAt: new Date().toISOString(),
          billDate: billDate || null,
          division: pData.division,
          staffId: effectiveStaffId,
          staffName: effectiveStaffName,
          recordedBy: effectiveStaffName,
        });
      }
    });
    
    if (!isDirectSale && clientId) {
      await verifyAndSyncClientTotals(clientId);
    }
    
    toast.success('Payment recorded successfully');
    return true;
  } catch (error: any) {
    console.error("Atomic payment error:", error);
    toast.error(error.message || 'Failed to record payment');
    throw error;
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

export async function createDirectSale(input: DirectSaleInput): Promise<string> {
  enforceStaffOrAdmin();
  const currentUser = useAuthStore.getState().user;
  const staffId = currentUser?.uid || '';
  const staffName = currentUser?.name || currentUser?.displayName || (currentUser?.role === 'admin' ? 'Admin' : 'Staff');

  const subtotal = input.items.reduce((sum, item) => sum + (item.total || 0), 0);
  const total = subtotal;

  // 1. Create order with orderType 'direct'
  const orderId = await addOrder({
    orderType: 'direct',
    clientId: 'direct',
    clientName: 'Direct Sale',
    region: 'Direct Sale',
    deliveryDate: input.date,
    items: input.items,
    subtotal,
    tax: 0,
    total,
    division: input.division || 'primary',
    createdAt: `${input.date}T${new Date().toTimeString().split(' ')[0]}`,
    notes: input.notes || '',
    staffId,
    staffName,
  });

  // 2. If initial payment provided, record payment atomically
  if (input.payment && input.payment.amount > 0) {
    await recordPaymentAtomic({
      orderType: 'direct',
      clientId: 'direct',
      clientName: 'Direct Sale',
      region: 'Direct Sale',
      invoiceId: orderId,
      amount: input.payment.amount,
      method: input.payment.method,
      reference: input.payment.reference || input.reference,
      billDate: input.date,
      paymentDate: input.date,
      division: input.division || 'primary',
      staffId,
      staffName,
    });
  }

  return orderId;
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
    } else if (trashData.originalCollection === 'payments' && trashData.originalData?.clientId && trashData.originalData.clientId !== 'direct') {
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
