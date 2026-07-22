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
  Timestamp,
  addDoc,
  writeBatch,
  runTransaction
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { toast } from 'sonner';
import { useAuthStore } from '../stores/authStore';

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
export function subscribeToCollection(collectionName: string, callback: (data: any[]) => void) {
  const q = query(collection(db, collectionName));
  return onSnapshot(q, (snapshot) => {
    const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    callback(data);
  }, (error) => {
    console.error(`Error subscribing to ${collectionName}:`, error);
  });
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
    const batch = writeBatch(db);
    
    // Create the trash document
    const trashRef = doc(db, 'trash', docId);
    batch.set(trashRef, {
      originalCollection,
      originalDocumentId: docId,
      originalData,
      deletedAt: new Date().toISOString(),
      deletedBy
    });

    // Delete from original collection
    const originalRef = doc(db, originalCollection, docId);
    batch.delete(originalRef);

    await batch.commit();
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
  enforceAdmin();
  try {
    const { clientId, total } = orderData;
    if (!clientId) throw new Error("Missing client ID");

    let newOrderId = '';

    await runTransaction(db, async (transaction) => {
      // 1. Fetch Client
      const clientRef = doc(db, 'clients', clientId);
      const clientSnap = await transaction.get(clientRef);
      if (!clientSnap.exists()) throw new Error("Client not found");

      // 2. Create Order Document
      const orderRef = doc(collection(db, COLLECTIONS.ORDERS));
      newOrderId = orderRef.id;
      const oData = {
        ...orderData,
        id: orderRef.id,
        paymentStatus: 'unpaid',
        paidAmount: 0
      };
      transaction.set(orderRef, oData);

      // 3. Create Ledger Transaction
      const ledgerRef = doc(collection(db, 'ledger'));
      transaction.set(ledgerRef, {
        id: ledgerRef.id,
        type: 'invoice',
        clientId,
        invoiceId: orderRef.id,
        amount: total,
        description: `Daily Bill (${oData.items.map((i: any) => i.productName).join(', ')})`,
        createdAt: new Date().toISOString()
      });

      // 4. Re-calculate Client Outstanding
      const clientOrdersQuery = query(collection(db, COLLECTIONS.ORDERS), where("clientId", "==", clientId));
      const clientPaymentsQuery = query(collection(db, COLLECTIONS.PAYMENTS), where("clientId", "==", clientId));
      
      const [ordersSnap, paymentsSnap] = await Promise.all([
        getDocs(clientOrdersQuery),
        getDocs(clientPaymentsQuery)
      ]);
      
      let totalInvoiceAmount = total; // Include the new order
      let totalOrdersCount = 1;
      ordersSnap.forEach(doc => {
        totalInvoiceAmount += (doc.data().total || 0);
        totalOrdersCount++;
      });
      
      let totalPaymentsReceived = 0;
      paymentsSnap.forEach(doc => {
        if (doc.data().status === 'completed' && !doc.data().deletedAt) {
          totalPaymentsReceived += (doc.data().amount || 0);
        }
      });
      
      const newOutstanding = totalInvoiceAmount - totalPaymentsReceived;
      
      transaction.update(clientRef, {
        outstanding: newOutstanding,
        totalRevenue: totalInvoiceAmount,
        totalOrders: totalOrdersCount
      });
    });

    return newOrderId;
  } catch (error) {
    console.error("Error adding order atomically:", error);
    throw error;
  }
}

export async function updateOrder(orderId: string, updates: any) {
  enforceAdmin();
  try {
    const docRef = doc(db, COLLECTIONS.ORDERS, orderId);
    await updateDoc(docRef, updates);
  } catch (error) {
    console.error("Error updating order:", error);
    throw error;
  }
}

// Payments
export async function recordPaymentAtomic(paymentData: any) {
  enforceStaffOrAdmin();
  try {
    const { clientId, amount, method, updatedBy, billDate, paymentDate, clientName, invoiceId } = paymentData;
    
    // Validate inputs
    if (!clientId) throw new Error("Missing client ID");
    
    await runTransaction(db, async (transaction) => {
      // 1. Fetch Client
      const clientRef = doc(db, 'clients', clientId);
      const clientSnap = await transaction.get(clientRef);
      if (!clientSnap.exists()) throw new Error("Client not found");
      
      // 2. Fetch Invoice if provided (fallback to finding by billDate)
      let targetOrderRef: any = null;
      let targetOrderSnap: any = null;
      
      if (invoiceId) {
        targetOrderRef = doc(db, COLLECTIONS.ORDERS, invoiceId);
        targetOrderSnap = await transaction.get(targetOrderRef);
      } else if (billDate) {
        // We have to query orders by billDate, but queries inside transactions are tricky.
        // We will just fetch all orders for client from cache/store in UI and pass invoiceId instead.
        // If not provided, we throw.
        throw new Error("Must provide invoiceId for payment");
      }
      
      if (!targetOrderSnap || !targetOrderSnap.exists()) {
        throw new Error("Invoice not found");
      }
      
      const orderData = targetOrderSnap.data();
      const invoiceTotal = orderData.total || 0;
      let newPaidAmount = (orderData.paidAmount || 0) + amount;
      
      // 3. Validation: Paid Amount cannot exceed Invoice Total
      if (newPaidAmount > invoiceTotal + 0.01) { // 0.01 for floating point safety
        throw new Error("Payment exceeds invoice total");
      }
      
      // 4. Determine new Invoice Status
      let newStatus: 'unpaid' | 'partial' | 'paid' = 'unpaid';
      if (newPaidAmount <= 0.01) newStatus = 'unpaid';
      else if (Math.abs(invoiceTotal - newPaidAmount) <= 0.01) newStatus = 'paid';
      else newStatus = 'partial';
      
      // 5. Create Payment Document
      const paymentRef = doc(collection(db, COLLECTIONS.PAYMENTS));
      const pData = {
        id: paymentRef.id,
        clientId,
        clientName,
        invoiceId: targetOrderSnap.id,
        amount,
        method,
        status: 'completed',
        billDate: orderData.deliveryDate,
        createdAt: paymentDate ? `${paymentDate} 00:00:00` : new Date().toISOString(),
        updatedBy
      };
      transaction.set(paymentRef, pData);
      
      // 6. Create Ledger Transaction
      const ledgerRef = doc(collection(db, 'ledger'));
      transaction.set(ledgerRef, {
        id: ledgerRef.id,
        type: 'payment',
        paymentId: paymentRef.id,
        clientId,
        invoiceId: targetOrderSnap.id,
        amount,
        paymentDate: pData.createdAt,
        paymentMethod: method,
        createdAt: new Date().toISOString()
      });
      
      // 7. Update Invoice
      transaction.update(targetOrderRef, {
        paymentStatus: newStatus,
        paidAmount: newPaidAmount
      });
      
      // 8. Update Client Outstanding
      // As requested: "Outstanding must always be derived from Total Invoice Amount - Total Payments Received"
      const clientOrdersQuery = query(collection(db, COLLECTIONS.ORDERS), where("clientId", "==", clientId));
      const clientPaymentsQuery = query(collection(db, COLLECTIONS.PAYMENTS), where("clientId", "==", clientId));
      
      const [ordersSnap, paymentsSnap] = await Promise.all([
        getDocs(clientOrdersQuery),
        getDocs(clientPaymentsQuery)
      ]);
      
      let totalInvoiceAmount = 0;
      let totalOrdersCount = 0;
      ordersSnap.forEach(doc => {
        if (doc.id !== invoiceId) {
          totalInvoiceAmount += (doc.data().total || 0);
          totalOrdersCount++;
        }
      });
      // Add the current invoice which might have been modified (or just use its total)
      totalInvoiceAmount += invoiceTotal;
      totalOrdersCount++; // Wait, if the invoice was already in the DB, it was counted. Let's just use the query snapshot which includes it!
      
      // Let's re-calculate perfectly:
      totalInvoiceAmount = 0;
      totalOrdersCount = 0;
      ordersSnap.forEach(doc => {
        totalInvoiceAmount += (doc.data().total || 0);
        totalOrdersCount++;
      });
      
      let totalPaymentsReceived = 0;
      paymentsSnap.forEach(doc => {
        if (doc.data().status === 'completed' && !doc.data().deletedAt) {
          totalPaymentsReceived += (doc.data().amount || 0);
        }
      });
      // Add the new payment we just created (since it's not in the snapshot yet)
      totalPaymentsReceived += amount;
      
      const newOutstanding = totalInvoiceAmount - totalPaymentsReceived;
      
      transaction.update(clientRef, {
        outstanding: newOutstanding,
        totalRevenue: totalInvoiceAmount,
        totalOrders: totalOrdersCount,
        lastPaymentDate: pData.createdAt,
        totalPaid: totalPaymentsReceived
      });
    });
    
    toast.success('Payment recorded successfully');
  } catch (error: any) {
    console.error("Atomic payment error:", error);
    toast.error(error.message || 'Failed to record payment');
    throw error;
  }
}

// Pricing
export async function saveClientPricing(clientId: string, pricingData: Record<string, number>) {
  enforceAdmin();
  try {
    const docRef = doc(db, COLLECTIONS.PRICING, clientId);
    await setDoc(docRef, { pricing: pricingData }, { merge: true });
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

export function subscribeToRegions(callback: (regions: string[]) => void) {
  return onSnapshot(doc(db, 'config', 'regions'), (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data().list || []);
    } else {
      callback([]);
    }
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

    await batch.commit();
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
    await deleteDoc(doc(db, 'trash', trashDocId));
    toast.success('Permanently deleted');
  } catch (error) {
    console.error("Error permanently deleting:", error);
    toast.error('Failed to delete permanently');
    throw error;
  }
}
