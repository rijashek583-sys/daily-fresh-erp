/**
 * Daily Fresh ERP — Trusted Server-Side Payment & Correction Engine
 *
 * Implements server-side payment recording and correction with:
 * 1. Authoritative Firestore runTransaction atomicity across orders, payments, ledger, and customer balances.
 * 2. Delivery Date grouping, dynamic Primary/Bakery proportional allocation, and oldest-invoice-first attribution.
 * 3. Durable operation-specific idempotency keys.
 * 4. Exact integer-paise conservation and unified advance credit (primaryAllocated + bakeryAllocated + excessCredit == amount).
 * 5. Primary-first credit application policy preservation.
 * 6. Explicit Admin review for ambiguous legacy invoices and opening balances.
 * 7. Reversal tracking and audit history preservation on payment corrections.
 */

import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { type AuthenticatedUser } from './authValidation';
import {
  allocatePaymentPolicy,
  type InvoiceObligation,
  type FinancialDivision,
} from './financialPolicy';

export interface DirectSaleItemPayload {
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface DirectSalePayload {
  items: DirectSaleItemPayload[];
  date: string;
  division?: 'primary' | 'bakery';
  notes?: string | null;
  reference?: string | null;
}

export interface RecordPaymentPayload {
  clientId: string;
  amount: number;
  paymentDate?: string;
  billDate?: string;
  deliveryDate?: string;
  invoiceId?: string | null;
  otherInvoiceId?: string | null;
  division?: 'primary' | 'bakery';
  method: 'cash' | 'upi' | 'bank_transfer' | 'card';
  reference?: string | null;
  notes?: string | null;
  idempotencyKey: string;
  orderType?: 'client' | 'direct';
  directSale?: DirectSalePayload;
}

export interface CorrectPaymentPayload {
  paymentId: string;
  newAmount: number;
  correctionReason: string;
  division?: 'primary' | 'bakery';
  paymentDate?: string;
  method?: 'cash' | 'upi' | 'bank_transfer' | 'card';
  reference?: string | null;
  notes?: string | null;
  expectedFinancialRevision?: number;
}

export interface PaymentAttributionDetail {
  invoiceId: string;
  division: FinancialDivision;
  deliveryDate: string;
  amountPaise: number;
  amount: number;
}

const round2 = (val: number): number => Math.round((val + Number.EPSILON) * 100) / 100;

/**
 * Trusted Callable Handler: handleRecordPayment
 */
export async function handleRecordPayment(
  db: admin.firestore.Firestore,
  caller: AuthenticatedUser,
  payload: RecordPaymentPayload
) {
  // Authorization check
  if (!['admin', 'staff', 'delivery_staff'].includes(caller.role)) {
    throw new HttpsError('permission-denied', 'Unauthorized. Staff or Admin role required.');
  }

  // Input Validation
  const clientId = (payload.clientId || '').trim();
  const isDirectSale = payload.orderType === 'direct' || clientId === 'direct';
  if (!isDirectSale && !clientId) {
    throw new HttpsError('invalid-argument', 'Missing or invalid clientId.');
  }

  const hasDirectSalePayload = Boolean(isDirectSale && payload.directSale);
  if (hasDirectSalePayload) {
    if (typeof payload.amount !== 'number' || isNaN(payload.amount) || payload.amount < 0) {
      throw new HttpsError('invalid-argument', 'Direct sale payment amount must be a number greater than or equal to ₹0.');
    }
  } else {
    if (typeof payload.amount !== 'number' || isNaN(payload.amount) || payload.amount <= 0) {
      throw new HttpsError('invalid-argument', 'Payment amount must be a number greater than ₹0.');
    }
  }
  const paymentAmount = round2(payload.amount);
  const paymentPaise = Math.round(paymentAmount * 100);

  const idempotencyKey = (payload.idempotencyKey || '').trim();
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
    throw new HttpsError(
      'invalid-argument',
      'Missing or invalid durable idempotencyKey. Must be an 8–128 character identifier.'
    );
  }

  const validMethods = ['cash', 'upi', 'bank_transfer', 'card'];
  const method = validMethods.includes(payload.method) ? payload.method : 'cash';
  const effectiveDivision: FinancialDivision = payload.division === 'bakery' ? 'bakery' : 'primary';

  const todayIso = new Date().toISOString().split('T')[0];
  const effectivePaymentDate = payload.paymentDate || todayIso;
  const effectiveBillDate = payload.billDate || effectivePaymentDate;

  return await db.runTransaction(async (transaction) => {
    // ─── 1. Idempotency Guard ───
    const paymentRef = db.collection('payments').doc(idempotencyKey);
    const existingPaymentSnap = await transaction.get(paymentRef);
    if (existingPaymentSnap.exists) {
      const existingData = existingPaymentSnap.data()!;
      if (Math.abs(Number(existingData.amount) - paymentAmount) < 0.005 && existingData.clientId === (isDirectSale ? 'direct' : clientId)) {
        return {
          success: true,
          paymentId: idempotencyKey,
          orderId: existingData.invoiceId || undefined,
          duplicate: true,
          message: 'Idempotent replay: Payment was already recorded.',
          primaryAllocated: existingData.primaryAllocated ?? 0,
          bakeryAllocated: existingData.bakeryAllocated ?? 0,
          excessCredit: existingData.excessCredit ?? 0,
        };
      }
      throw new HttpsError(
        'already-exists',
        `Duplicate idempotencyKey "${idempotencyKey}" with conflicting payment parameters.`
      );
    }

    // ─── 2. Direct Sale Path ───
    if (isDirectSale) {
      const directOrderId = payload.invoiceId || (hasDirectSalePayload ? `dir_${idempotencyKey}` : null);
      let directOrderRef: admin.firestore.DocumentReference | null = null;
      let directOrderData: any = null;

      if (directOrderId) {
        directOrderRef = db.collection('orders').doc(directOrderId);
        const orderSnap = await transaction.get(directOrderRef);
        if (orderSnap.exists) {
          directOrderData = orderSnap.data();
          // If direct sale was already committed with this order ID, replay cleanly
          if (hasDirectSalePayload) {
            return {
              success: true,
              orderId: directOrderId,
              paymentId: paymentAmount > 0 ? idempotencyKey : undefined,
              duplicate: true,
              message: 'Idempotent replay: Direct sale order was already committed.',
              primaryAllocated: effectiveDivision === 'primary' ? paymentAmount : 0,
              bakeryAllocated: effectiveDivision === 'bakery' ? paymentAmount : 0,
              excessCredit: 0,
            };
          }
        }
      }

      // If direct sale order creation is requested in this trusted backend transaction:
      if (hasDirectSalePayload && directOrderRef) {
        const ds = payload.directSale!;
        if (!Array.isArray(ds.items) || ds.items.length === 0) {
          throw new HttpsError('invalid-argument', 'Direct sale must contain at least one item.');
        }

        const validItems = ds.items.map((it) => {
          const qty = Number(it.qty) || 0;
          const unitPrice = Number(it.unitPrice) || 0;
          const total = Number(it.total) || qty * unitPrice;
          if (qty <= 0) throw new HttpsError('invalid-argument', `Invalid quantity for ${it.productName || 'item'}.`);
          if (unitPrice < 0) throw new HttpsError('invalid-argument', `Selling price cannot be negative.`);
          return {
            productId: String(it.productId),
            productName: String(it.productName),
            qty,
            unitPrice,
            total: round2(total),
          };
        });

        const orderSubtotal = round2(validItems.reduce((sum, item) => sum + item.total, 0));
        const orderTotal = orderSubtotal;

        if (paymentAmount > orderTotal + 0.01) {
          throw new HttpsError('invalid-argument', `Payment amount (${paymentAmount}) cannot exceed direct sale total (${orderTotal}).`);
        }

        const isFullyPaid = paymentAmount >= orderTotal - 0.01;
        const isPartial = paymentAmount > 0.01 && !isFullyPaid;
        const paymentStatus = isFullyPaid ? 'paid' : (isPartial ? 'partial' : 'pending');

        const nowIso = new Date().toISOString();
        const timePart = nowIso.split('T')[1] || '00:00:00.000Z';
        const orderDate = ds.date || effectivePaymentDate;

        directOrderData = {
          id: directOrderId,
          orderType: 'direct',
          clientId: 'direct',
          clientName: 'Direct Sale',
          region: 'Direct Sale',
          deliveryDate: orderDate,
          items: validItems,
          subtotal: orderTotal,
          tax: 0,
          total: orderTotal,
          division: ds.division || effectiveDivision,
          createdAt: `${orderDate}T${timePart}`,
          notes: ds.notes || payload.notes || '',
          reference: ds.reference || payload.reference || '',
          staffId: caller.uid,
          staffName: caller.displayName,
          creditApplied: 0,
          primaryCreditApplied: 0,
          bakeryCreditApplied: 0,
          netDue: orderTotal,
          paidAmount: paymentAmount,
          paymentStatus,
          updatedAt: nowIso,
        };

        transaction.set(directOrderRef, directOrderData);
      }

      // If initial payment provided, write payment document atomically
      let primaryAllocated = 0;
      let bakeryAllocated = 0;

      if (paymentAmount > 0) {
        primaryAllocated = effectiveDivision === 'primary' ? paymentAmount : 0;
        bakeryAllocated = effectiveDivision === 'bakery' ? paymentAmount : 0;

        const pData = {
          id: idempotencyKey,
          orderType: 'direct',
          clientId: 'direct',
          clientName: 'Direct Sale',
          region: 'Direct Sale',
          invoiceId: directOrderId || payload.invoiceId || null,
          otherInvoiceId: payload.otherInvoiceId || null,
          amount: paymentAmount,
          appliedAmount: paymentAmount,
          appliedToPrevious: 0,
          appliedToOtherBill: 0,
          totalAppliedToBill: paymentAmount,
          excessCredit: 0,
          generalCredit: 0,
          isAdvance: false,
          method,
          reference: payload.reference?.trim() || null,
          notes: payload.notes?.trim() || null,
          billDate: effectiveBillDate,
          paymentDate: effectivePaymentDate,
          createdAt: `${effectivePaymentDate}T00:00:00.000Z`,
          staffId: caller.uid,
          staffName: caller.displayName,
          recordedBy: caller.displayName,
          updatedBy: caller.displayName,
          division: effectiveDivision,
          primaryAllocated,
          bakeryAllocated,
          idempotencyKey,
        };

        transaction.set(paymentRef, pData);

        // Update existing direct order if this was an on-bill collection for an existing direct order
        if (!hasDirectSalePayload && directOrderRef && directOrderData) {
          const orderTotal = round2(Number(directOrderData.total || 0));
          const currentPaid = round2(Number(directOrderData.paidAmount || 0));
          const newPaid = round2(currentPaid + paymentAmount);
          const newStatus = newPaid >= orderTotal - 0.01 ? 'paid' : (newPaid > 0.01 ? 'partial' : 'pending');
          transaction.update(directOrderRef, {
            paidAmount: newPaid,
            paymentStatus: newStatus,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      return {
        success: true,
        paymentId: paymentAmount > 0 ? idempotencyKey : undefined,
        orderId: directOrderId || undefined,
        duplicate: false,
        primaryAllocated,
        bakeryAllocated,
        excessCredit: 0,
      };
    }

    // ─── 3. Customer Document Verification ───
    const clientRef = db.collection('clients').doc(clientId);
    const clientSnap = await transaction.get(clientRef);
    if (!clientSnap.exists) {
      throw new HttpsError('not-found', `Customer document "${clientId}" not found.`);
    }
    const clientData = clientSnap.data()!;

    // Priority 7: Reject ambiguous legacy opening balances requiring Admin review
    if (clientData.hasUnresolvedOpeningBalance === true) {
      throw new HttpsError(
        'failed-precondition',
        'Customer has unresolved legacy opening balances. Explicit Admin credit reconciliation is required before recording payments.'
      );
    }

    // ─── 4. Query & Verify Candidate Unpaid Invoices ───
    const unpaidQuery = db
      .collection('orders')
      .where('clientId', '==', clientId)
      .where('paymentStatus', 'in', ['pending', 'partial']);

    const unpaidSnap = await transaction.get(unpaidQuery);
    const candidateOrderDocs: Array<{ id: string; ref: admin.firestore.DocumentReference; data: any }> = [];

    unpaidSnap.docs.forEach((docSnap) => {
      candidateOrderDocs.push({ id: docSnap.id, ref: docSnap.ref, data: docSnap.data() });
    });

    // Ensure explicitly requested invoices are included
    if (payload.invoiceId && !candidateOrderDocs.some((d) => d.id === payload.invoiceId)) {
      const explicitRef = db.collection('orders').doc(payload.invoiceId);
      const explicitSnap = await transaction.get(explicitRef);
      if (explicitSnap.exists) {
        candidateOrderDocs.push({ id: explicitSnap.id, ref: explicitRef, data: explicitSnap.data() });
      }
    }
    if (payload.otherInvoiceId && !candidateOrderDocs.some((d) => d.id === payload.otherInvoiceId)) {
      const explicitOtherRef = db.collection('orders').doc(payload.otherInvoiceId);
      const explicitOtherSnap = await transaction.get(explicitOtherRef);
      if (explicitOtherSnap.exists) {
        candidateOrderDocs.push({ id: explicitOtherSnap.id, ref: explicitOtherRef, data: explicitOtherSnap.data() });
      }
    }

    // Evidence Validation & Customer-Ownership Verification (Priority 7)
    const obligations: InvoiceObligation[] = [];
    for (const o of candidateOrderDocs) {
      if (o.data.clientId !== clientId) {
        throw new HttpsError(
          'permission-denied',
          `Cross-customer settlement forbidden: invoice #${o.id} belongs to client ${o.data.clientId}.`
        );
      }
      if (o.data.deletedAt) continue;

      const dDate = o.data.deliveryDate;
      if (!dDate || typeof dDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dDate) || Number(dDate.slice(0, 4)) < 2000) {
        throw new HttpsError(
          'failed-precondition',
          `Invoice #${o.id} has missing or invalid deliveryDate ("${dDate || ''}"). Explicit Admin review required.`
        );
      }

      const orderedAt = o.data.orderedAt || o.data.createdAt || o.data.orderDate;
      if (!orderedAt || typeof orderedAt !== 'string' || isNaN(Date.parse(orderedAt))) {
        throw new HttpsError(
          'failed-precondition',
          `Invoice #${o.id} has missing or unparseable ordering timestamp. Explicit Admin review required.`
        );
      }

      const totalPaise = Math.round((Number(o.data.total) || 0) * 100);
      const creditPaise = Math.round(
        (Number(o.data.creditApplied || ((o.data.primaryCreditApplied || 0) + (o.data.bakeryCreditApplied || 0)) || 0)) * 100
      );
      const netDuePaise = Math.max(0, totalPaise - creditPaise);
      const paidPaise = Math.round((Number(o.data.paidAmount) || 0) * 100);
      const unpaidPaise = Math.max(0, netDuePaise - paidPaise);

      if (unpaidPaise > 0) {
        obligations.push({
          invoiceId: o.id,
          division: (o.data.division === 'bakery' ? 'bakery' : 'primary') as FinancialDivision,
          deliveryDate: dDate,
          orderedAt,
          eligibleUnpaidPaise: unpaidPaise,
        });
      }
    }

    // Check if specifically requested invoice is already settled
    if (payload.invoiceId) {
      const targetO = candidateOrderDocs.find((d) => d.id === payload.invoiceId);
      if (targetO) {
        const totalPaise = Math.round((Number(targetO.data.total) || 0) * 100);
        const creditPaise = Math.round(
          (Number(targetO.data.creditApplied || ((targetO.data.primaryCreditApplied || 0) + (targetO.data.bakeryCreditApplied || 0)) || 0)) * 100
        );
        const netDuePaise = Math.max(0, totalPaise - creditPaise);
        const paidPaise = Math.round((Number(targetO.data.paidAmount) || 0) * 100);
        if (netDuePaise - paidPaise <= 0 || targetO.data.paymentStatus === 'paid') {
          throw new HttpsError(
            'failed-precondition',
            `Bill #${payload.invoiceId.slice(0, 8)} is already fully settled. No additional payment can be applied.`
          );
        }
      }
    }

    // Resolve target selected delivery date
    const selectedDate = payload.deliveryDate || effectiveBillDate || todayIso;

    // ─── 5. Proportional Payment Policy Execution ───
    const allocResult = allocatePaymentPolicy({
      policyVersion: 1,
      clientId,
      selectedDeliveryDate: selectedDate,
      paymentPaise,
      obligations,
      openingBalancesResolved: clientData.hasUnresolvedOpeningBalance !== true,
    });

    if (allocResult.status === 'review-required') {
      throw new HttpsError(
        'failed-precondition',
        `Payment allocation review required: ${allocResult.reason}.`
      );
    }

    // Priority 2 & 6: Integer Paise Conservation and Proportional Division Calculation
    const attributions: PaymentAttributionDetail[] = allocResult.attributions.map((a) => ({
      ...a,
      amount: round2(a.amountPaise / 100),
    }));

    const primaryAllocatedPaise = attributions
      .filter((a) => a.division === 'primary')
      .reduce((sum, a) => sum + a.amountPaise, 0);

    const bakeryAllocatedPaise = attributions
      .filter((a) => a.division === 'bakery')
      .reduce((sum, a) => sum + a.amountPaise, 0);

    const unifiedExcessPaise = allocResult.unifiedAdvancePaise;

    // Strict mathematical check: every single paise is accounted for
    if (primaryAllocatedPaise + bakeryAllocatedPaise + unifiedExcessPaise !== paymentPaise) {
      throw new HttpsError(
        'internal',
        `Allocation invariant failed: ${primaryAllocatedPaise} + ${bakeryAllocatedPaise} + ${unifiedExcessPaise} !== ${paymentPaise}`
      );
    }

    const primaryAllocated = round2(primaryAllocatedPaise / 100);
    const bakeryAllocated = round2(bakeryAllocatedPaise / 100);
    const excessCredit = round2(unifiedExcessPaise / 100);
    const isAdvance = attributions.length === 0 && excessCredit > 0;

    // ─── 6. Atomically Update Affected Orders ───
    for (const attr of attributions) {
      const orderDoc = candidateOrderDocs.find((d) => d.id === attr.invoiceId);
      if (orderDoc) {
        const totalPaise = Math.round((Number(orderDoc.data.total) || 0) * 100);
        const creditPaise = Math.round(
          (Number(orderDoc.data.creditApplied || ((orderDoc.data.primaryCreditApplied || 0) + (orderDoc.data.bakeryCreditApplied || 0)) || 0)) * 100
        );
        const netDuePaise = Math.max(0, totalPaise - creditPaise);
        const currentPaidPaise = Math.round((Number(orderDoc.data.paidAmount) || 0) * 100);
        const newPaidPaise = currentPaidPaise + attr.amountPaise;
        const newStatus = newPaidPaise >= netDuePaise ? 'paid' : 'partial';

        transaction.update(orderDoc.ref, {
          paidAmount: round2(newPaidPaise / 100),
          paymentStatus: newStatus,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // ─── 7. Atomically Update Customer Balances & Monotonic Financial Revision ───
    const currentRevision = Number(clientData.financialRevision) || 0;
    const newRevision = currentRevision + 1;

    const oldPrimaryTotals = clientData.primaryTotals || {};
    const oldBakeryTotals = clientData.bakeryTotals || {};

    const primaryOpening = round2(Number(oldPrimaryTotals.openingBalance || 0));
    const bakeryOpening = round2(Number(oldBakeryTotals.openingBalance || 0));

    const primaryRevenue = round2(Number(oldPrimaryTotals.totalRevenue || 0));
    const bakeryRevenue = round2(Number(oldBakeryTotals.totalRevenue || 0));

    const newPrimaryPaid = round2(Number(oldPrimaryTotals.totalPaid || 0) + primaryAllocated);
    const newBakeryPaid = round2(Number(oldBakeryTotals.totalPaid || 0) + bakeryAllocated);

    const primaryRaw = round2(primaryOpening + primaryRevenue - newPrimaryPaid);
    const bakeryRaw = round2(bakeryOpening + bakeryRevenue - newBakeryPaid);
    const newTotalPaid = round2(Number(clientData.totalPaid || 0) + paymentAmount);
    const combinedRaw = round2((primaryOpening + bakeryOpening + primaryRevenue + bakeryRevenue) - newTotalPaid);

    const newOutstanding = Math.max(0, combinedRaw);
    const newGeneralCredit = Math.max(0, -combinedRaw);

    transaction.update(clientRef, {
      totalPaid: newTotalPaid,
      outstanding: newOutstanding,
      credit: newGeneralCredit,
      availableCredit: newGeneralCredit,
      generalCredit: newGeneralCredit,
      primaryCredit: 0,
      bakeryCredit: 0,
      rawBalance: combinedRaw,
      financialRevision: newRevision,
      primaryTotals: {
        ...oldPrimaryTotals,
        openingBalance: primaryOpening,
        totalRevenue: primaryRevenue,
        totalPaid: newPrimaryPaid,
        rawBalance: primaryRaw,
      },
      bakeryTotals: {
        ...oldBakeryTotals,
        openingBalance: bakeryOpening,
        totalRevenue: bakeryRevenue,
        totalPaid: newBakeryPaid,
        rawBalance: bakeryRaw,
      },
      updatedAt: new Date().toISOString(),
    });

    // ─── 8. Write Payment Document ───
    const pData: any = {
      id: idempotencyKey,
      orderType: 'client',
      clientId,
      clientName: clientData.name || '',
      region: clientData.region || '',
      invoiceId: payload.invoiceId || null,
      otherInvoiceId: payload.otherInvoiceId || null,
      amount: paymentAmount,
      appliedAmount: round2(primaryAllocated + bakeryAllocated),
      appliedToPrevious: round2(
        attributions
          .filter((a) => a.deliveryDate !== selectedDate)
          .reduce((sum, a) => sum + a.amount, 0)
      ),
      totalAppliedToBill: round2(
        attributions
          .filter((a) => a.deliveryDate === selectedDate)
          .reduce((sum, a) => sum + a.amount, 0)
      ),
      excessCredit,
      generalCredit: excessCredit,
      isAdvance,
      method,
      reference: payload.reference?.trim() || null,
      notes: payload.notes?.trim() || null,
      billDate: effectiveBillDate,
      paymentDate: effectivePaymentDate,
      createdAt: `${effectivePaymentDate}T00:00:00.000Z`,
      staffId: caller.uid,
      staffName: caller.displayName,
      recordedBy: caller.displayName,
      updatedBy: caller.displayName,
      division: effectiveDivision,
      primaryAllocated,
      bakeryAllocated,
      idempotencyKey,
      attributions,
      financialRevision: newRevision,
    };

    transaction.set(paymentRef, pData);

    // ─── 9. Create Division Ledger Entries ───
    if (primaryAllocated > 0 && bakeryAllocated > 0) {
      const lRef1 = db.collection('ledger').doc();
      transaction.set(lRef1, {
        id: lRef1.id,
        type: 'payment',
        paymentId: idempotencyKey,
        clientId,
        clientName: clientData.name || '',
        region: clientData.region || '',
        invoiceId: payload.invoiceId || null,
        amount: primaryAllocated,
        appliedAmount: primaryAllocated,
        excessCredit: effectiveDivision === 'primary' ? excessCredit : 0,
        generalCredit: effectiveDivision === 'primary' ? excessCredit : 0,
        isAdvance: isAdvance && effectiveDivision === 'primary',
        paymentDate: pData.createdAt,
        paymentMethod: method,
        description: `Primary Foods allocation (${method.replace('_', ' ')}) - ₹${primaryAllocated.toFixed(2)}${payload.reference ? ` Ref: ${payload.reference}` : ''}`,
        createdAt: new Date().toISOString(),
        billDate: effectiveBillDate,
        division: 'primary',
        staffId: caller.uid,
        staffName: caller.displayName,
        recordedBy: caller.displayName,
      });

      const lRef2 = db.collection('ledger').doc();
      transaction.set(lRef2, {
        id: lRef2.id,
        type: 'payment',
        paymentId: idempotencyKey,
        clientId,
        clientName: clientData.name || '',
        region: clientData.region || '',
        invoiceId: payload.otherInvoiceId || null,
        amount: bakeryAllocated,
        appliedAmount: bakeryAllocated,
        excessCredit: effectiveDivision === 'bakery' ? excessCredit : 0,
        generalCredit: effectiveDivision === 'bakery' ? excessCredit : 0,
        isAdvance: isAdvance && effectiveDivision === 'bakery',
        paymentDate: pData.createdAt,
        paymentMethod: method,
        description: `Bakery Foods allocation (${method.replace('_', ' ')}) - ₹${bakeryAllocated.toFixed(2)}${payload.reference ? ` Ref: ${payload.reference}` : ''}`,
        createdAt: new Date().toISOString(),
        billDate: effectiveBillDate,
        division: 'bakery',
        staffId: caller.uid,
        staffName: caller.displayName,
        recordedBy: caller.displayName,
      });
    } else {
      const div = primaryAllocated > 0 ? 'primary' : (bakeryAllocated > 0 ? 'bakery' : effectiveDivision);
      const lRef = db.collection('ledger').doc();
      transaction.set(lRef, {
        id: lRef.id,
        type: 'payment',
        paymentId: idempotencyKey,
        clientId,
        clientName: clientData.name || '',
        region: clientData.region || '',
        invoiceId: payload.invoiceId || null,
        amount: paymentAmount,
        appliedAmount: round2(primaryAllocated + bakeryAllocated),
        excessCredit,
        generalCredit: excessCredit,
        isAdvance,
        paymentDate: pData.createdAt,
        paymentMethod: method,
        description: `Payment received (${method.replace('_', ' ')}) - ₹${paymentAmount.toFixed(2)}${excessCredit > 0 ? ` (Advance Credit: ₹${excessCredit.toFixed(2)})` : ''}${payload.reference ? ` Ref: ${payload.reference}` : ''}`,
        createdAt: new Date().toISOString(),
        billDate: effectiveBillDate,
        division: div,
        staffId: caller.uid,
        staffName: caller.displayName,
        recordedBy: caller.displayName,
      });
    }

    return {
      success: true,
      paymentId: idempotencyKey,
      duplicate: false,
      primaryAllocated,
      bakeryAllocated,
      excessCredit,
      financialRevision: newRevision,
    };
  });
}

/**
 * Trusted Callable Handler: handleCorrectPayment (Admin Only)
 * Priority 8: Accurate invoice attribution reversal and immutable audit tracking.
 */
export async function handleCorrectPayment(
  db: admin.firestore.Firestore,
  caller: AuthenticatedUser,
  payload: CorrectPaymentPayload
) {
  if (caller.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only Admins are authorized to correct recorded payments.');
  }

  const paymentId = (payload.paymentId || '').trim();
  if (!paymentId) throw new HttpsError('invalid-argument', 'Missing paymentId.');

  const reason = (payload.correctionReason || '').trim();
  if (!reason) throw new HttpsError('invalid-argument', 'A correction reason is required.');

  if (typeof payload.newAmount !== 'number' || isNaN(payload.newAmount) || payload.newAmount <= 0) {
    throw new HttpsError('invalid-argument', 'New payment amount must be greater than ₹0.');
  }
  const newAmount = round2(payload.newAmount);
  const newAmountPaise = Math.round(newAmount * 100);

  return await db.runTransaction(async (transaction) => {
    // 1. Read existing payment
    const paymentRef = db.collection('payments').doc(paymentId);
    const paymentSnap = await transaction.get(paymentRef);
    if (!paymentSnap.exists) {
      throw new HttpsError('not-found', 'Payment record not found.');
    }
    const paymentData = paymentSnap.data()!;
    const oldAmount = round2(Number(paymentData.amount || 0));
    const clientId = paymentData.clientId;

    if (clientId === 'direct') {
      throw new HttpsError('failed-precondition', 'Direct sale payments cannot be corrected via client payment flow.');
    }

    // 2. Read customer doc
    const clientRef = db.collection('clients').doc(clientId);
    const clientSnap = await transaction.get(clientRef);
    if (!clientSnap.exists) throw new HttpsError('not-found', 'Client not found.');
    const clientData = clientSnap.data()!;

    // 3. Reverse previously attributed invoice amounts
    const previousAttributions: PaymentAttributionDetail[] = Array.isArray(paymentData.attributions)
      ? paymentData.attributions
      : [];

    const restoredOrders = new Map<string, { ref: admin.firestore.DocumentReference; data: any; restoredPaidPaise: number }>();

    for (const prevAttr of previousAttributions) {
      const oRef = db.collection('orders').doc(prevAttr.invoiceId);
      const oSnap = await transaction.get(oRef);
      if (oSnap.exists) {
        const oData = oSnap.data()!;
        const currentPaidPaise = Math.round((Number(oData.paidAmount) || 0) * 100);
        const restoredPaidPaise = Math.max(0, currentPaidPaise - prevAttr.amountPaise);
        restoredOrders.set(prevAttr.invoiceId, { ref: oRef, data: oData, restoredPaidPaise });
      }
    }

    // 4. Query current candidate unpaid orders for re-allocation
    const unpaidQuery = db
      .collection('orders')
      .where('clientId', '==', clientId)
      .where('paymentStatus', 'in', ['pending', 'partial']);

    const unpaidSnap = await transaction.get(unpaidQuery);
    const candidateOrderDocs = new Map<string, { ref: admin.firestore.DocumentReference; data: any; paidPaise: number }>();

    unpaidSnap.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const currentPaid = Math.round((Number(data.paidAmount) || 0) * 100);
      candidateOrderDocs.set(docSnap.id, { ref: docSnap.ref, data, paidPaise: currentPaid });
    });

    // Merge restored orders into candidate orders
    for (const [id, restored] of restoredOrders) {
      candidateOrderDocs.set(id, { ref: restored.ref, data: restored.data, paidPaise: restored.restoredPaidPaise });
    }

    // Build obligations for re-allocation
    const obligations: InvoiceObligation[] = [];
    for (const [id, o] of candidateOrderDocs) {
      if (o.data.deletedAt) continue;
      const dDate = o.data.deliveryDate;
      const orderedAt = o.data.orderedAt || o.data.createdAt || o.data.orderDate;
      if (!dDate || !orderedAt) continue;

      const totalPaise = Math.round((Number(o.data.total) || 0) * 100);
      const creditPaise = Math.round(
        (Number(o.data.creditApplied || ((o.data.primaryCreditApplied || 0) + (o.data.bakeryCreditApplied || 0)) || 0)) * 100
      );
      const netDuePaise = Math.max(0, totalPaise - creditPaise);
      const unpaidPaise = Math.max(0, netDuePaise - o.paidPaise);

      if (unpaidPaise > 0) {
        obligations.push({
          invoiceId: id,
          division: (o.data.division === 'bakery' ? 'bakery' : 'primary') as FinancialDivision,
          deliveryDate: dDate,
          orderedAt,
          eligibleUnpaidPaise: unpaidPaise,
        });
      }
    }

    // 5. Re-run Proportional Allocation Policy
    const targetDate = paymentData.paymentDate || new Date().toISOString().split('T')[0];
    const allocResult = allocatePaymentPolicy({
      policyVersion: 1,
      clientId,
      selectedDeliveryDate: targetDate,
      paymentPaise: newAmountPaise,
      obligations,
      openingBalancesResolved: clientData.hasUnresolvedOpeningBalance !== true,
    });

    if (allocResult.status === 'review-required') {
      throw new HttpsError('failed-precondition', `Correction allocation review required: ${allocResult.reason}.`);
    }

    const newAttributions: PaymentAttributionDetail[] = allocResult.attributions.map((a) => ({
      ...a,
      amount: round2(a.amountPaise / 100),
    }));

    const primaryAllocatedPaise = newAttributions
      .filter((a) => a.division === 'primary')
      .reduce((sum, a) => sum + a.amountPaise, 0);

    const bakeryAllocatedPaise = newAttributions
      .filter((a) => a.division === 'bakery')
      .reduce((sum, a) => sum + a.amountPaise, 0);

    const unifiedExcessPaise = allocResult.unifiedAdvancePaise;
    const primaryAllocated = round2(primaryAllocatedPaise / 100);
    const bakeryAllocated = round2(bakeryAllocatedPaise / 100);
    const excessCredit = round2(unifiedExcessPaise / 100);

    // 6. Update all affected orders (restored + newly allocated)
    const allAffectedOrderIds = new Set([...restoredOrders.keys(), ...newAttributions.map((a) => a.invoiceId)]);
    for (const oId of allAffectedOrderIds) {
      const candidate = candidateOrderDocs.get(oId);
      if (candidate) {
        const newlyAllocatedPaise = newAttributions
          .filter((a) => a.invoiceId === oId)
          .reduce((sum, a) => sum + a.amountPaise, 0);
        const finalPaidPaise = candidate.paidPaise + newlyAllocatedPaise;

        const totalPaise = Math.round((Number(candidate.data.total) || 0) * 100);
        const creditPaise = Math.round(
          (Number(candidate.data.creditApplied || ((candidate.data.primaryCreditApplied || 0) + (candidate.data.bakeryCreditApplied || 0)) || 0)) * 100
        );
        const netDuePaise = Math.max(0, totalPaise - creditPaise);
        const newStatus = finalPaidPaise >= netDuePaise ? 'paid' : (finalPaidPaise > 0 ? 'partial' : 'pending');

        transaction.update(candidate.ref, {
          paidAmount: round2(finalPaidPaise / 100),
          paymentStatus: newStatus,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // 7. Update Customer Balances & Revision
    const oldRevision = Number(clientData.financialRevision) || 0;
    const newRevision = oldRevision + 1;
    const amountDiff = round2(newAmount - oldAmount);

    const oldPrimaryTotals = clientData.primaryTotals || {};
    const oldBakeryTotals = clientData.bakeryTotals || {};

    const oldPaymentPrimary = Number(paymentData.primaryAllocated || 0);
    const oldPaymentBakery = Number(paymentData.bakeryAllocated || 0);

    const newPrimaryPaid = round2(Number(oldPrimaryTotals.totalPaid || 0) + (primaryAllocated - oldPaymentPrimary));
    const newBakeryPaid = round2(Number(oldBakeryTotals.totalPaid || 0) + (bakeryAllocated - oldPaymentBakery));

    const primaryOpening = round2(Number(oldPrimaryTotals.openingBalance || 0));
    const bakeryOpening = round2(Number(oldBakeryTotals.openingBalance || 0));

    const primaryRevenue = round2(Number(oldPrimaryTotals.totalRevenue || 0));
    const bakeryRevenue = round2(Number(oldBakeryTotals.totalRevenue || 0));

    const primaryRaw = round2(primaryOpening + primaryRevenue - newPrimaryPaid);
    const bakeryRaw = round2(bakeryOpening + bakeryRevenue - newBakeryPaid);
    const newTotalPaid = round2(Number(clientData.totalPaid || 0) + amountDiff);
    const combinedRaw = round2((primaryOpening + bakeryOpening + primaryRevenue + bakeryRevenue) - newTotalPaid);

    transaction.update(clientRef, {
      totalPaid: newTotalPaid,
      outstanding: Math.max(0, combinedRaw),
      credit: Math.max(0, -combinedRaw),
      availableCredit: Math.max(0, -combinedRaw),
      generalCredit: Math.max(0, -combinedRaw),
      rawBalance: combinedRaw,
      financialRevision: newRevision,
      primaryTotals: {
        ...oldPrimaryTotals,
        totalPaid: newPrimaryPaid,
        rawBalance: primaryRaw,
      },
      bakeryTotals: {
        ...oldBakeryTotals,
        totalPaid: newBakeryPaid,
        rawBalance: bakeryRaw,
      },
      updatedAt: new Date().toISOString(),
    });

    // 8. Update Payment Record with Audit History
    const baseOriginalAmount = paymentData.originalAmount !== undefined ? Number(paymentData.originalAmount) : oldAmount;
    const existingHistory = Array.isArray(paymentData.correctionHistory) ? [...paymentData.correctionHistory] : [];
    const correctionRecord = {
      correctedAt: new Date().toISOString(),
      correctedBy: caller.displayName,
      adminId: caller.uid,
      adminName: caller.displayName,
      originalAmount: oldAmount,
      newAmount,
      reason,
      paymentId,
      attributionsReversed: previousAttributions,
      newAttributions,
    };

    transaction.update(paymentRef, {
      amount: newAmount,
      appliedAmount: round2(primaryAllocated + bakeryAllocated),
      primaryAllocated,
      bakeryAllocated,
      excessCredit,
      generalCredit: excessCredit,
      isAdvance: newAttributions.length === 0 && excessCredit > 0,
      isCorrected: true,
      originalAmount: baseOriginalAmount,
      correctionReason: reason,
      correctionHistory: [...existingHistory, correctionRecord],
      attributions: newAttributions,
      financialRevision: newRevision,
      updatedAt: new Date().toISOString(),
      updatedBy: caller.displayName,
    });

    return {
      success: true,
      paymentId,
      originalAmount: oldAmount,
      newAmount,
      financialRevision: newRevision,
    };
  });
}
