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
import { db } from '../lib/firebase';
import { toast } from 'sonner';
import { useAuthStore } from '../stores/authStore';
import { getProductDivision } from '../lib/utils';
import { useDataStore } from '../stores/dataStore';

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
      if (data.invoiceId && validOrderIds.has(data.invoiceId)) {
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

    const primaryTotals = { totalInvoiced: 0, totalPaid: 0, totalOrders: 0 };
    const bakeryTotals = { totalInvoiced: 0, totalPaid: 0, totalOrders: 0 };

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
        }
      }
    });

    if (hasOrphans) {
      await batch.commit();
      console.log(`[Integrity] Cleaned up orphans for client ${clientId}`);
    }

    const primaryOutstanding = primaryTotals.totalInvoiced - primaryTotals.totalPaid;
    const bakeryOutstanding = bakeryTotals.totalInvoiced - bakeryTotals.totalPaid;
    
    // Cross-division totals for fallback
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
      primaryTotals: {
        totalRevenue: primaryTotals.totalInvoiced,
        totalPaid: primaryTotals.totalPaid,
        outstanding: primaryOutstanding,
        totalOrders: primaryTotals.totalOrders,
      },
      bakeryTotals: {
        totalRevenue: bakeryTotals.totalInvoiced,
        totalPaid: bakeryTotals.totalPaid,
        outstanding: bakeryOutstanding,
        totalOrders: bakeryTotals.totalOrders,
      }
    });
    
    console.log(`[Integrity] Client ${clientId} synced. Primary Out: ${primaryOutstanding}, Bakery Out: ${bakeryOutstanding}`);
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
    //  1. Delete its associated ledger entry.
    //  2. Atomically update the client's denormalized aggregates.
    if (originalCollection === 'orders' && originalData?.clientId) {
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

      // Find and trash all associated payments
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
    } else if (originalCollection === 'payments' && originalData?.clientId) {
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
    if (originalData?.clientId) {
      await verifyAndSyncClientTotals(originalData.clientId);
    }
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
    const { clientId, total } = orderData;
    if (!clientId) throw new Error("Missing client ID");

    let newOrderId = '';

    await runTransaction(db, async (transaction) => {
      // 1. Fetch Client (single document read — safe inside transaction)
      const clientRef = doc(db, 'clients', clientId);
      const clientSnap = await transaction.get(clientRef);
      if (!clientSnap.exists()) throw new Error("Client not found");

      // 2. Create Order Document
      const orderRef = doc(collection(db, COLLECTIONS.ORDERS));
      newOrderId = orderRef.id;
      const oData = {
        ...orderData,
        id: orderRef.id
      };
      transaction.set(orderRef, oData);

      // 3. Create Ledger entries — split by division so every ledger row is division-clean
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
    });
    
    await verifyAndSyncClientTotals(clientId);

    return newOrderId;
  } catch (error) {
    console.error("Error adding order atomically:", error);
    throw error;
  }
}

export async function updateOrder(orderId: string, updates: any) {
  enforceStaffOrAdmin();
  try {
    const clientIdToSync = await runTransaction(db, async (transaction) => {
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
        if (oldData.clientId) {
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
      return oldData.clientId;
    });
    
    if (clientIdToSync) {
      await verifyAndSyncClientTotals(clientIdToSync);
    }
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

      if ((amountDiff !== 0 || updates.division !== undefined) && oldData.clientId) {
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
      return oldData.clientId;
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
    const { clientId, amount, method, updatedBy, billDate, paymentDate, clientName, invoiceId, reference, notes } = paymentData;
    
    // Validate inputs
    if (!clientId) throw new Error("Missing client ID");
    
    await runTransaction(db, async (transaction) => {
      // 1. Fetch Client
      const clientRef = doc(db, 'clients', clientId);
      const clientSnap = await transaction.get(clientRef);
      if (!clientSnap.exists()) throw new Error("Client not found");
      
      // 2. Create Payment Document
      const paymentRef = doc(collection(db, COLLECTIONS.PAYMENTS));
      const pData = {
        id: paymentRef.id,
        clientId,
        clientName,
        invoiceId: invoiceId || null,
        amount,
        method,
        reference: reference || null,
        notes: notes || null,
        billDate: billDate || null,
        createdAt: paymentDate ? `${paymentDate} 00:00:00` : new Date().toISOString(),
        updatedBy,
        division: paymentData.division as 'primary' | 'bakery'
      };

      // Validate division — payments must be explicitly primary or bakery
      if (!pData.division || (pData.division !== 'primary' && pData.division !== 'bakery')) {
        throw new Error('Payment must specify a valid division: "primary" or "bakery"');
      }

      transaction.set(paymentRef, pData);
      
      // 3. Create Ledger Transaction (Credit)
      const ledgerRef = doc(collection(db, 'ledger'));
      transaction.set(ledgerRef, {
        id: ledgerRef.id,
        type: 'payment',
        paymentId: paymentRef.id,
        clientId,
        invoiceId: invoiceId || null,
        amount,
        paymentDate: pData.createdAt,
        paymentMethod: method,
        description: `Payment received (${method.replace('_', ' ')})${reference ? ` - Ref: ${reference}` : ''}`,
        createdAt: new Date().toISOString(),
        billDate: billDate || null,
        division: pData.division
      });
    });
    
    await verifyAndSyncClientTotals(clientId);
    
    toast.success('Payment recorded successfully');
  } catch (error: any) {
    console.error("Atomic payment error:", error);
    toast.error(error.message || 'Failed to record payment');
    throw error;
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
  try {
    const batch = writeBatch(db);

    // Restore to original collection
    const originalRef = doc(db, trashData.originalCollection, trashDocId);
    batch.set(originalRef, trashData.originalData);

    // Remove from trash
    const trashRef = doc(db, 'trash', trashDocId);
    batch.delete(trashRef);

    // If restoring an order or payment, we must also restore the ledger entry and update client
    if (trashData.originalCollection === 'orders' && trashData.originalData?.clientId) {
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

      // Find and restore associated payments from trash
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
    } else if (trashData.originalCollection === 'payments' && trashData.originalData?.clientId) {
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
    if (trashData.originalData?.clientId) {
      await verifyAndSyncClientTotals(trashData.originalData.clientId);
    }
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
