import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Check, Calendar, CreditCard, User, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { type Order, type Client, type PaymentMethod, type Division } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { useAuthStore } from '../../stores/authStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { recordPaymentAtomic } from '../../services/db';
import { Button, Badge } from '../ui';
import { formatCurrency, cn, getProductDivision, getTodayLocalDateString } from '../../lib/utils';
import { getClientMetrics, allocatePayment } from '../../lib/billing';

interface RecordPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  order?: Order | null;
  client?: Client | null;
  onSuccess?: () => void;
  showAllocationPreviewNotice?: boolean;
}

const PAYMENT_METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'bank_transfer', label: 'Bank Transfer' },
  { id: 'card', label: 'Card' },
];

export default function RecordPaymentModal({
  isOpen,
  onClose,
  order,
  client,
  onSuccess,
  showAllocationPreviewNotice = false,
}: RecordPaymentModalProps) {
  const { clients, orders, payments, products } = useDataStore();
  const { user } = useAuthStore();
  const { activeDivision } = useDivisionStore();
  const isStaff = user?.role === 'staff';

  const isDirectSaleOrder = order?.orderType === 'direct' || order?.clientId === 'direct';
  const isSubmittingRef = useRef(false);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  // Active clients list for selector
  const activeClients = useMemo(() => {
    return clients.filter(c => !c.deletedAt && c.status === 'active');
  }, [clients]);

  // Resolve client & order
  const resolvedClient = useMemo(() => {
    if (client) return client;
    if (order) {
      if (order.orderType === 'direct' || order.clientId === 'direct') {
        return {
          id: 'direct',
          name: 'Direct Sale',
          region: 'Direct Sale',
          status: 'active',
          totalOrders: 1,
          totalRevenue: order.total,
          outstanding: 0,
        } as Client;
      }
      return clients.find(c => c.id === order.clientId) || null;
    }
    if (selectedClientId) {
      return clients.find(c => c.id === selectedClientId) || null;
    }
    return null;
  }, [client, order, selectedClientId, clients]);

  // Form State
  const [amount, setAmount] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(getTodayLocalDateString());
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [division, setDivision] = useState<Division>('primary');
  const [reference, setReference] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // Payments already made on this order
  const orderPayments = useMemo(() => {
    if (!order) return [];
    return payments.filter(p => !p.deletedAt && p.invoiceId === order.id);
  }, [order, payments]);

  const orderPaidTotal = useMemo(() => {
    const pSum = orderPayments.reduce((sum, p) => sum + (p.appliedAmount !== undefined ? p.appliedAmount : (p.amount || 0)), 0);
    return Math.max(pSum, order?.paidAmount || 0);
  }, [orderPayments, order]);

  const orderCreditApplied = useMemo(() => {
    return order ? (order.creditApplied || ((order.primaryCreditApplied || 0) + (order.bakeryCreditApplied || 0)) || 0) : 0;
  }, [order]);

  const orderNetDue = useMemo(() => {
    if (!order) return 0;
    return Math.max(0, (order.total || 0) - orderCreditApplied);
  }, [order, orderCreditApplied]);

  const isOrderSettled = useMemo(() => {
    if (!order) return false;
    return order.paymentStatus === 'paid' || (orderNetDue - orderPaidTotal) <= 0.01;
  }, [order, orderNetDue, orderPaidTotal]);

  const orderPendingTotal = useMemo(() => {
    if (!order) return 0;
    if (isOrderSettled) return 0;
    return Math.max(0, orderNetDue - orderPaidTotal);
  }, [order, isOrderSettled, orderNetDue, orderPaidTotal]);

  // Division-specific client metrics
  const clientDivisionMetrics = useMemo(() => {
    if (!resolvedClient || resolvedClient.id === 'direct') {
      return { outstanding: 0, credit: 0, totalPaid: 0, openingBalance: 0, totalInvoiced: 0 };
    }
    return getClientMetrics(resolvedClient.id, division);
  }, [resolvedClient, division]);

  // Cross-division total client metrics
  const clientAllMetrics = useMemo(() => {
    if (!resolvedClient || resolvedClient.id === 'direct') {
      return { outstanding: 0, credit: 0, totalPaid: 0, openingBalance: 0, totalInvoiced: 0 };
    }
    return getClientMetrics(resolvedClient.id, 'all');
  }, [resolvedClient]);

  // Maximum standard pending amount for current context
  const maxAllowedAmount = useMemo(() => {
    if (order) return orderPendingTotal;
    return Math.max(0, clientAllMetrics.outstanding);
  }, [order, orderPendingTotal, clientAllMetrics]);

  // Detect division from order or default to active division / primary
  const detectedDivision = useMemo<Division>(() => {
    if (order) {
      if (order.division === 'bakery') return 'bakery';
      if (order.division === 'primary') return 'primary';
      if (order.items && order.items.length > 0) {
        const hasPrimary = order.items.some(i => {
          const p = products.find(prod => prod.id === i.productId);
          return getProductDivision(p || { name: i.productName }) === 'primary';
        });
        const hasBakery = order.items.some(i => {
          const p = products.find(prod => prod.id === i.productId);
          return getProductDivision(p || { name: i.productName }) === 'bakery';
        });
        if (hasBakery && !hasPrimary) return 'bakery';
        if (hasPrimary && !hasBakery) return 'primary';
      }
    }
    if (activeDivision === 'bakery' || activeDivision === 'primary') {
      return activeDivision;
    }
    return 'primary';
  }, [order, products, activeDivision]);

  const parsedAmount = parseFloat(amount) || 0;

  const otherDivision: Division = division === 'bakery' ? 'primary' : 'bakery';
  const otherDivisionMetrics = useMemo(() => {
    if (!resolvedClient || resolvedClient.id === 'direct') {
      return { outstanding: 0, credit: 0, totalPaid: 0, openingBalance: 0, totalInvoiced: 0 };
    }
    return getClientMetrics(resolvedClient.id, otherDivision);
  }, [resolvedClient, otherDivision]);

  const otherDivisionOrder = useMemo(() => {
    if (!order || !order.deliveryDate || !order.clientId || isDirectSaleOrder) return null;
    return orders.find(o =>
      !o.deletedAt &&
      o.id !== order.id &&
      o.clientId === order.clientId &&
      o.deliveryDate === order.deliveryDate &&
      (o.division === otherDivision || (o.items && o.items.some(i => {
        const prod = products.find(p => p.id === i.productId);
        return getProductDivision(prod || { name: i.productName }) === otherDivision;
      })))
    );
  }, [order, orders, otherDivision, isDirectSaleOrder, products]);

  const otherOrderPendingTotal = useMemo(() => {
    if (!otherDivisionOrder) return 0;
    const isPaid = otherDivisionOrder.paymentStatus === 'paid';
    if (isPaid) return 0;
    const paid = otherDivisionOrder.paidAmount || 0;
    const credit = Number(otherDivisionOrder.creditApplied || ((otherDivisionOrder.primaryCreditApplied || 0) + (otherDivisionOrder.bakeryCreditApplied || 0)) || 0);
    return Math.max(0, (otherDivisionOrder.total || 0) - credit - paid);
  }, [otherDivisionOrder]);

  const billDivisionPrior = useMemo(() => {
    if (!order) return Math.max(0, clientDivisionMetrics.outstanding);
    return Math.max(0, clientDivisionMetrics.outstanding - orderPendingTotal);
  }, [order, clientDivisionMetrics.outstanding, orderPendingTotal]);

  const otherDivisionPrior = useMemo(() => {
    return Math.max(0, otherDivisionMetrics.outstanding - otherOrderPendingTotal);
  }, [otherDivisionMetrics.outstanding, otherOrderPendingTotal]);

  const previousOutstanding = billDivisionPrior;

  const allocation = useMemo(() => {
    return allocatePayment({
      paymentAmount: parsedAmount,
      orderRemaining: order ? orderPendingTotal : 0,
      otherOrderRemaining: otherOrderPendingTotal,
      clientTotalOutstanding: clientAllMetrics.outstanding,
      billDivisionOutstanding: clientDivisionMetrics.outstanding,
      otherDivisionOutstanding: otherDivisionMetrics.outstanding,
      billDivisionPrior,
      otherDivisionPrior,
      isDirectSale: Boolean(isDirectSaleOrder || resolvedClient?.id === 'direct'),
      division,
    });
  }, [
    parsedAmount,
    order,
    orderPendingTotal,
    otherOrderPendingTotal,
    clientAllMetrics.outstanding,
    clientDivisionMetrics.outstanding,
    otherDivisionMetrics.outstanding,
    billDivisionPrior,
    otherDivisionPrior,
    isDirectSaleOrder,
    resolvedClient,
    division,
  ]);

  const appliedToBill = allocation.appliedToBill;
  const appliedToPrevious = allocation.appliedToPrevious;
  const appliedToSameDivisionPrevious = allocation.appliedToSameDivisionPrevious;
  const appliedToOtherDivisionPrevious = allocation.appliedToOtherDivisionPrevious;
  const excessCredit = allocation.excessCredit;
  const remainingBill = allocation.remainingBill;
  const remainingTotalOutstanding = allocation.remainingTotalOutstanding;

  // Prefill when modal opens
  useEffect(() => {
    if (isOpen) {
      const initClientId = client?.id || (order?.clientId && order.clientId !== 'direct' ? order.clientId : '');
      setSelectedClientId(initClientId);
      const targetClient = client || (order?.clientId ? clients.find(c => c.id === order.clientId) : null);

      let initDiv: Division = 'primary';
      if (order) {
        initDiv = detectedDivision;
      } else if (targetClient && targetClient.id !== 'direct') {
        const pMetrics = getClientMetrics(targetClient.id, 'primary');
        const bMetrics = getClientMetrics(targetClient.id, 'bakery');
        if (bMetrics.outstanding > 0 && pMetrics.outstanding <= 0) {
          initDiv = 'bakery';
        } else if (pMetrics.outstanding > 0) {
          initDiv = 'primary';
        } else {
          initDiv = (activeDivision === 'bakery' ? 'bakery' : 'primary');
        }
      } else {
        initDiv = (activeDivision === 'bakery' ? 'bakery' : 'primary');
      }
      setDivision(initDiv);

      let defaultAmt = 0;
      if (order) {
        const orderCredit = Number(order.creditApplied || ((order.primaryCreditApplied || 0) + (order.bakeryCreditApplied || 0)) || 0);
        const orderDue = Math.max(0, (order.total || 0) - orderCredit - (order.paidAmount || 0));
        const orderSettled = order.paymentStatus === 'paid' || orderDue <= 0.01;
        if (!orderSettled) {
          defaultAmt = orderDue;
        }
      } else if (targetClient && targetClient.id !== 'direct') {
        const allMetrics = getClientMetrics(targetClient.id, 'all');
        defaultAmt = Math.max(0, allMetrics.outstanding);
      }
      setAmount(defaultAmt > 0 ? String(defaultAmt) : '');
      setPaymentDate(getTodayLocalDateString());
      setMethod('cash');
      setReference('');
      setNotes('');
      setError('');
      setLoading(false);
      isSubmittingRef.current = false;
      const uniqueKey = `pay_idem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      setIdempotencyKey(uniqueKey);
    }
  }, [isOpen, order, client, detectedDivision, clients, activeDivision]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || loading) return;
    setError('');

    if (!resolvedClient) {
      setError('Please select a client or shop.');
      return;
    }

    const isDirect = resolvedClient.id === 'direct' || isDirectSaleOrder;

    // Strict Settled Invoice Guard: Never silently change a settled invoice to an on-account payment
    if (order && isOrderSettled) {
      setError(
        `This bill (#${order.id.slice(0, 8)}) is already fully settled. Payments cannot be recorded against a settled bill. To record an on-account collection for this client, please use "Collect Payment" without selecting a settled bill.`
      );
      return;
    }

    const numericAmount = parseFloat(amount);

    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError('Please enter a valid payment amount greater than ₹0.');
      return;
    }

    // Validation: prevent overpayment for direct sales only (direct sales cannot hold credit)
    if (isDirect && maxAllowedAmount > 0 && numericAmount > maxAllowedAmount + 0.01) {
      setError(
        `Direct sale payment amount (₹${numericAmount}) cannot exceed the pending amount of ${formatCurrency(
          maxAllowedAmount
        )}.`
      );
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);

    try {
      const staffName =
        user?.name || user?.displayName || (user?.role === 'staff' ? 'Staff' : 'Admin');
      const staffId = user?.uid || null;

      const effectivePaymentDate = isStaff
        ? getTodayLocalDateString()
        : (paymentDate || getTodayLocalDateString());

      await recordPaymentAtomic({
        orderType: isDirect ? 'direct' : 'client',
        clientId: resolvedClient.id,
        clientName: resolvedClient.name,
        region: resolvedClient.region || (isDirect ? 'Direct Sale' : ''),
        invoiceId: order ? order.id : null,
        otherInvoiceId: otherDivisionOrder?.id || null,
        otherOrderRemaining: otherOrderPendingTotal,
        billDivisionPrior,
        otherDivisionPrior,
        amount: numericAmount,
        method,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        billDate: order ? order.deliveryDate : effectivePaymentDate,
        paymentDate: effectivePaymentDate,
        staffId,
        staffName,
        recordedBy: staffName,
        updatedBy: staffName,
        division,
        idempotencyKey,
      });

      toast.success(
        `Payment of ${formatCurrency(numericAmount)} recorded for ${resolvedClient.name} successfully.`
      );

      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to record payment:', err);
      setError(err.message || 'Failed to record payment. Please try again.');
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[var(--color-card)] rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-800 w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/40">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-main)] flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-[var(--color-primary)]" />
              {isDirectSaleOrder
                ? 'Record Direct Sale Payment'
                : order
                  ? 'Record Bill Payment'
                  : 'Record Customer Payment'}
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {isDirectSaleOrder
                ? 'Record payment for Direct Sale · No customer ledger affected'
                : order
                  ? `Settle Bill #${order.id.slice(0, 8)} and allocate surplus to previous debt`
                  : 'Unified collection · Settle outstanding debt across divisions'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 flex-1 custom-scrollbar">

          {showAllocationPreviewNotice && !isDirectSaleOrder && (
            <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-semibold">Proportional allocation preview unavailable</p>
              <p className="mt-1">Verified invoice balances are needed to calculate this preview. Recording a payment continues to use the current allocation process; the proportional policy is not yet applied when saving.</p>
            </div>
          )}

          {/* Client Selector (when neither order nor client is pre-specified) */}
          {!order && !client && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider flex items-center justify-between">
                <span>Select Client / Shop <span className="text-red-500">*</span></span>
                {resolvedClient && (
                  <span className="text-[11px] font-semibold text-gray-400 lowercase">
                    {resolvedClient.region}
                  </span>
                )}
              </label>
              <select
                value={selectedClientId}
                onChange={e => {
                  const newId = e.target.value;
                  setSelectedClientId(newId);
                  const cl = clients.find(c => c.id === newId);
                  if (cl) {
                    const m = getClientMetrics(cl.id, 'all');
                    setAmount(m.outstanding > 0 ? String(m.outstanding) : '');
                    const pMetrics = getClientMetrics(cl.id, 'primary');
                    const bMetrics = getClientMetrics(cl.id, 'bakery');
                    if (bMetrics.outstanding > 0 && pMetrics.outstanding <= 0) {
                      setDivision('bakery');
                    } else {
                      setDivision('primary');
                    }
                  } else {
                    setAmount('');
                  }
                }}
                className="w-full px-3.5 py-2.5 text-xs font-semibold rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] cursor-pointer"
                required
              >
                <option value="">-- Choose a customer / shop --</option>
                {activeClients.map(c => {
                  const m = getClientMetrics(c.id, 'all');
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.region ? `(${c.region})` : ''} {m.outstanding > 0 ? `· Due: ${formatCurrency(m.outstanding)}` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Context Overview Box */}
          {resolvedClient && (
            <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    Client / Shop
                  </span>
                  <p className="text-sm font-bold text-[var(--color-text-main)]">
                    {resolvedClient.name}
                    {resolvedClient.region && (
                      <span className="text-xs font-normal text-gray-400 ml-1.5">
                        ({resolvedClient.region})
                      </span>
                    )}
                  </p>
                </div>

                {order ? (
                  <div className="text-right">
                    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                      Order Date
                    </span>
                    <p className="text-xs font-semibold text-[var(--color-text-main)]">
                      {format(new Date(order.deliveryDate), 'MMM d, yyyy')}
                    </p>
                    <Badge variant={order.division === 'bakery' ? 'purple' : 'info'} className="mt-1 text-[10px]">
                      {order.division === 'bakery' ? 'Bakery Foods' : 'Primary Foods'}
                    </Badge>
                  </div>
                ) : (
                  <div className="text-right">
                    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                      Customer Status
                    </span>
                    <Badge variant={clientAllMetrics.outstanding > 0 ? 'warning' : 'success'} className="mt-1">
                      {clientAllMetrics.outstanding > 0 ? `Due: ${formatCurrency(clientAllMetrics.outstanding)}` : 'Clear'}
                    </Badge>
                  </div>
                )}
              </div>

              {/* Financial figures */}
              {order ? (
                <div className={`grid ${orderCreditApplied > 0 ? 'grid-cols-4' : 'grid-cols-3'} gap-2 pt-2 border-t border-gray-200/60 dark:border-gray-700/60 text-center`}>
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-gray-400">Bill Total</p>
                    <p className="text-xs font-bold text-[var(--color-text-main)]">
                      {formatCurrency(order.total)}
                    </p>
                  </div>
                  {orderCreditApplied > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-green-600 dark:text-green-400">Credit Applied</p>
                      <p className="text-xs font-bold text-green-600 dark:text-green-400">
                        -{formatCurrency(orderCreditApplied)}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-gray-400">Paid So Far</p>
                    <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(orderPaidTotal)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-gray-400">Bill Remaining</p>
                    <p className="text-xs font-extrabold text-amber-600 dark:text-amber-400">
                      {formatCurrency(orderPendingTotal)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200/60 dark:border-gray-700/60 text-center">
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-gray-400">Total Invoiced</p>
                    <p className="text-xs font-bold text-[var(--color-text-main)]">
                      {formatCurrency(clientAllMetrics.totalInvoiced)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-gray-400">Total Paid</p>
                    <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(clientAllMetrics.totalPaid)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-gray-400">Total Outstanding</p>
                    <p className="text-xs font-extrabold text-amber-600 dark:text-amber-400">
                      {formatCurrency(clientAllMetrics.outstanding)}
                    </p>
                  </div>
                </div>
              )}

              {/* Outstanding Debt Summary */}
              {order && !isDirectSaleOrder && (previousOutstanding > 0 || otherDivisionMetrics.outstanding > 0) && (
                <div className="pt-2 border-t border-gray-200/50 dark:border-gray-700/50 space-y-1 text-xs">
                  <div className="flex items-center justify-between text-gray-500">
                    <span>Prior Outstanding Balance:</span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                      {formatCurrency(previousOutstanding + otherDivisionMetrics.outstanding)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between font-bold text-[var(--color-text-main)]">
                    <span>Overall Customer Due (Bill + Prior):</span>
                    <span className="tabular-nums">
                      {formatCurrency(clientAllMetrics.outstanding)}
                    </span>
                  </div>
                </div>
              )}

              {/* Settled Bill Guard Notice */}
              {order && isOrderSettled && (
                <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                  <div className="flex items-center gap-2 font-bold">
                    <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 stroke-[3]" />
                    <span>This bill (#{order.id.slice(0, 8)}) is already fully settled.</span>
                  </div>
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    No additional payment can be recorded against this invoice. To collect previous balance or advance credit for {resolvedClient.name}, please use "Collect Payment" from the customer page.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Amount Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                Payment Amount (₹) <span className="text-red-500">*</span>
              </label>

              {/* Quick-fill helper buttons */}
              {order && !isOrderSettled && orderPendingTotal > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setAmount(String(orderPendingTotal))}
                    className="text-[11px] font-bold text-[var(--color-primary)] hover:underline"
                  >
                    Pay Bill ({formatCurrency(orderPendingTotal)})
                  </button>
                  {clientAllMetrics.outstanding > orderPendingTotal && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(clientAllMetrics.outstanding))}
                      className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      &middot; Pay Total ({formatCurrency(clientAllMetrics.outstanding)})
                    </button>
                  )}
                  {orderPendingTotal > 10 && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(Math.round(orderPendingTotal / 2)))}
                      className="text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    >
                      &middot; Half
                    </button>
                  )}
                </div>
              )}

              {!order && clientAllMetrics.outstanding > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setAmount(String(clientAllMetrics.outstanding))}
                    className="text-[11px] font-bold text-[var(--color-primary)] hover:underline"
                  >
                    Pay Full Balance ({formatCurrency(clientAllMetrics.outstanding)})
                  </button>
                  {clientAllMetrics.outstanding > 10 && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(Math.round(clientAllMetrics.outstanding / 2)))}
                      className="text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    >
                      &middot; Half
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-gray-400 text-sm">
                ₹
              </span>
              <input
                type="number"
                step="any"
                min="0.01"
                placeholder="0.00"
                value={amount}
                disabled={Boolean(order && isOrderSettled)}
                onChange={e => {
                  setAmount(e.target.value);
                  setError('');
                }}
                required
                className="w-full pl-8 pr-4 py-2.5 text-base font-bold rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            {/* Live Payment Allocation Preview (Business Requirement 4) */}
            {parsedAmount > 0 && !isDirectSaleOrder && (
              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/80 text-xs space-y-2.5 animate-in fade-in duration-200">
                <div className="flex items-center justify-between text-gray-500 font-semibold border-b border-gray-200/80 dark:border-gray-700/80 pb-2">
                  <span className="uppercase tracking-wider text-[10px]">Payment Allocation Preview</span>
                  <span className="text-sm font-black text-[var(--color-text-main)] tabular-nums">
                    {formatCurrency(parsedAmount)}
                  </span>
                </div>

                {order && !isOrderSettled && (
                  <>
                    <div className="flex justify-between items-center text-gray-700 dark:text-gray-300">
                      <span>Bill Total:</span>
                      <span className="font-bold tabular-nums">{formatCurrency(order.total)}</span>
                    </div>
                    {orderPaidTotal > 0 && (
                      <div className="flex justify-between items-center text-gray-600 dark:text-gray-400">
                        <span>Already Paid on this Bill:</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                          {formatCurrency(orderPaidTotal)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-gray-700 dark:text-gray-300">
                      <span>Applied to this Bill:</span>
                      <span className="font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums flex items-center gap-1.5">
                        {formatCurrency(appliedToBill)}
                        {remainingBill <= 0.01 && (
                          <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded font-bold">
                            Bill Settled
                          </span>
                        )}
                      </span>
                    </div>
                    {allocation.appliedToOtherBill > 0 && (
                      <div className="flex justify-between items-center text-gray-700 dark:text-gray-300">
                        <span>Applied to {otherDivision === 'bakery' ? 'Bakery' : 'Primary'} Bill:</span>
                        <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {formatCurrency(allocation.appliedToOtherBill)}
                        </span>
                      </div>
                    )}
                    {remainingBill > 0.01 && (
                      <div className="flex justify-between items-center text-gray-600 dark:text-gray-400">
                        <span>Remaining Due on this Bill:</span>
                        <span className="font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                          {formatCurrency(remainingBill)}
                        </span>
                      </div>
                    )}
                  </>
                )}

                {appliedToSameDivisionPrevious > 0 && (
                  <div className="flex justify-between items-center text-gray-700 dark:text-gray-300">
                    <span>Applied to Prior {division === 'bakery' ? 'Bakery' : 'Primary'} Balance:</span>
                    <span className="font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                      {formatCurrency(appliedToSameDivisionPrevious)}
                    </span>
                  </div>
                )}

                {appliedToOtherDivisionPrevious > 0 && (
                  <div className="flex justify-between items-center text-gray-700 dark:text-gray-300">
                    <span>Applied to Prior {otherDivision === 'bakery' ? 'Bakery Foods' : 'Primary Foods'} Balance:</span>
                    <span className="font-bold text-indigo-700 dark:text-indigo-400 tabular-nums">
                      {formatCurrency(appliedToOtherDivisionPrevious)}
                    </span>
                  </div>
                )}

                {!order && appliedToPrevious > 0 && appliedToSameDivisionPrevious === 0 && appliedToOtherDivisionPrevious === 0 && (
                  <div className="flex justify-between items-center text-gray-700 dark:text-gray-300">
                    <span>Applied to Outstanding Balance:</span>
                    <span className="font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                      {formatCurrency(appliedToPrevious)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between items-center pt-2 border-t border-gray-200/80 dark:border-gray-700/80 text-[var(--color-text-main)] font-bold">
                  <span>Remaining Total Outstanding:</span>
                  <span className={remainingTotalOutstanding > 0.01 ? "text-amber-600 dark:text-amber-400 tabular-nums font-black" : "text-emerald-600 dark:text-emerald-400 tabular-nums font-black"}>
                    {formatCurrency(remainingTotalOutstanding)}
                  </span>
                </div>

                {excessCredit > 0 && (
                  <div className="flex justify-between items-center pt-2 border-t border-emerald-200 dark:border-emerald-800/80 font-bold text-emerald-700 dark:text-emerald-300">
                    <span>General Customer Credit Created:</span>
                    <span className="font-black tabular-nums text-sm">+{formatCurrency(excessCredit)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Admin Date & Division Selector (Staff does NOT see division toggle per Business Rule 1 & 2) */}
          {!isStaff && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" /> Payment Date
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={e => setPaymentDate(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                />
              </div>

              {!order && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                    Entry Division
                  </label>
                  <div className="flex p-1 bg-gray-100 dark:bg-gray-800/80 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setDivision('primary')}
                      className={cn(
                        'flex-1 py-1 text-xs font-semibold rounded-lg transition-all',
                        division === 'primary'
                          ? 'bg-white dark:bg-gray-900 text-[var(--color-text-main)] shadow-xs'
                          : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
                      )}
                    >
                      Primary
                    </button>
                    <button
                      type="button"
                      onClick={() => setDivision('bakery')}
                      className={cn(
                        'flex-1 py-1 text-xs font-semibold rounded-lg transition-all',
                        division === 'bakery'
                          ? 'bg-white dark:bg-gray-900 text-[var(--color-text-main)] shadow-xs'
                          : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
                      )}
                    >
                      Bakery
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Payment Method */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
              Payment Method
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PAYMENT_METHODS.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    'px-3 py-2 rounded-xl text-xs font-bold border transition-all text-center flex items-center justify-center gap-1.5',
                    method === m.id
                      ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                      : 'bg-[var(--color-input-bg)] border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  )}
                >
                  {method === m.id && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reference & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                Ref / Trans. ID <span className="font-normal text-gray-400 normal-case">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. UPI-123456 / Cheque"
                value={reference}
                onChange={e => setReference(e.target.value)}
                className="w-full px-3.5 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                Notes <span className="font-normal text-gray-400 normal-case">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="Remarks..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full px-3.5 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
              />
            </div>
          </div>

          {/* Recorded By info */}
          <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-800">
            <span className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-gray-400" />
              Recorded by: <strong className="text-[var(--color-text-main)]">{user?.displayName || user?.name || (user?.role === 'staff' ? 'Staff' : 'Admin')}</strong> ({user?.role})
            </span>
          </div>

          {/* Validation error display */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-red-700 dark:text-red-300 leading-relaxed">
                {error}
              </p>
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                loading ||
                !resolvedClient ||
                Boolean(order && isOrderSettled)
              }
              loading={loading}
              className="shadow-md shadow-red-500/20 px-6"
            >
              {!resolvedClient
                ? 'Select a Client'
                : (order && isOrderSettled)
                  ? 'Bill Already Settled'
                  : parsedAmount > 0
                    ? `Record Payment (${formatCurrency(parsedAmount)})`
                    : 'Record Payment'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
