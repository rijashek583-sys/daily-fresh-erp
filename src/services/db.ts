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
import { type Division, type PaymentMethod, type ClientOpeningBalance } from '../types';

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
    const primaryOutstanding = primaryOpening + primaryTotals.totalInvoiced - primaryTotals.totalPaid;
    const bakeryOutstanding = bakeryOpening + bakeryTotals.totalInvoiced - bakeryTotals.totalPaid;
    
    // Cross-division totals for fallback
    const totalOpening = primaryOpening + bakeryOpening;
    const totalInvoiced = primaryTotals.totalInvoiced + bakeryTotals.totalInvoiced;
    const totalPaid = primaryTotals.totalPaid + bakeryTotals.totalPaid;
    const outstanding = primaryOutstanding + bakeryOutstanding;
    const totalOrders = primaryTotals.totalOrders + bakeryTotals.totalOrders;

    const clientRef = doc(db, COLLECTIONS.CLIENTS, clientId);
    
    // We overwrite the client doc without a transaction to enforce the ledger as the ultimate source of truth
    await updateDoc(clientRef, {
      totalRevenue: totalInvoiced,
      totalPaid,
      outstanding,
      totalOrders,
      openingBalanceAmount: totalOpening,
      primaryTotals: {
        totalRevenue: primaryTotals.totalInvoiced,
        totalPaid: primaryTotals.totalPaid,
        outstanding: primaryOutstanding,
        totalOrders: primaryTotals.totalOrders,
        openingBalance: primaryOpening,
      },
      bakeryTotals: {
        totalRevenue: bakeryTotals.totalInvoiced,
        totalPaid: bakeryTotals.totalPaid,
        outstanding: bakeryOutstanding,
        totalOrders: bakeryTotals.totalOrders,
        openingBalance: bakeryOpening,
      }
    });
    
    console.log(`[Integrity] Client ${clientId} synced. Opening: ${totalOpening}, Primary Out: ${primaryOutstanding}, Bakery Out: ${bakeryOutstanding}`);
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

      // Find and trash all associated payments (both client orders and direct sales)
      const paymentsQuery = query(
        collection(db, 'payments'),
        where('invoiceId', '==', docId)
      );
      const paymentsSnap = await getDocs(paymentsQuery);
      paymentsSnap.forEach((pDoc) => {
        const pTrashRef = doc(db, 'trash', pDoc.id);
        batch.set(pTrashRef, {
          originalCollection: 'payments',
          originalDocumentId: pDoc.id,
          originalData: pDoc.data(),
          deletedAt,
          deletedBy
        });
        batch.delete(pDoc.ref);
      });

      if (originalData?.clientId && originalData.clientId !== 'direct') {
        // Find and trash all associated ledger credits (payments)
        const paymentLedgerQuery = query(
          collection(db, 'ledger'),
          where('type', '==', 'payment'),
          where('invoiceId', '==', docId)
        );
        const paymentLedgerSnap = await getDocs(paymentLedgerQuery);
        paymentLedgerSnap.forEach((lDoc) => {
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

      // 2. Create Order Document
      const orderRef = doc(collection(db, COLLECTIONS.ORDERS));
      newOrderId = orderRef.id;
      const oData = {
        ...orderData,
        id: orderRef.id,
        orderType: isDirectSale ? 'direct' : 'client',
        clientId: isDirectSale ? 'direct' : clientId,
        clientName: isDirectSale ? 'Direct Sale' : (orderData.clientName || clientSnap?.data()?.name || ''),
        region: isDirectSale ? 'Direct Sale' : (orderData.region || clientSnap?.data()?.region || ''),
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

      transaction.update(paymentRef, updates);

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

    await runTransaction(db, async (transaction) => {
      let resolvedRegion = region || (isDirectSale ? 'Direct Sale' : '');
      let resolvedClientName = clientName || (isDirectSale ? 'Direct Sale' : '');

      if (!isDirectSale) {
        // 1. Fetch Client
        const clientRef = doc(db, 'clients', clientId);
        const clientSnap = await transaction.get(clientRef);
        if (!clientSnap.exists()) throw new Error("Client not found");
        const clientDocData = clientSnap.data();
        resolvedRegion = region || clientDocData.region || '';
        resolvedClientName = clientName || clientDocData.name || '';
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
        transaction.set(ledgerRef, {
          id: ledgerRef.id,
          type: 'payment',
          paymentId: paymentRef.id,
          clientId,
          clientName: resolvedClientName,
          region: resolvedRegion,
          invoiceId: invoiceId || null,
          amount,
          paymentDate: pData.createdAt,
          paymentMethod: method,
          description: `Payment received (${method.replace('_', ' ')})${reference ? ` - Ref: ${reference}` : ''}`,
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
