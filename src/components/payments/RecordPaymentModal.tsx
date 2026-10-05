import React, { useState, useEffect, useMemo } from 'react';
import { X, Check, DollarSign, Calendar, CreditCard, User, AlertCircle, ShoppingCart } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { type Order, type Client, type PaymentMethod, type Division } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { useAuthStore } from '../../stores/authStore';
import { recordPaymentAtomic } from '../../services/db';
import { Button, Input } from '../ui';
import { formatCurrency, cn, getProductDivision } from '../../lib/utils';
import { getClientMetrics } from '../../lib/billing';

interface RecordPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  order?: Order | null;
  client?: Client | null;
  onSuccess?: () => void;
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
}: RecordPaymentModalProps) {
  const { clients, orders, payments, products } = useDataStore();
  const { user } = useAuthStore();

  const isDirectSaleOrder = order?.orderType === 'direct' || order?.clientId === 'direct';

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
    return null;
  }, [client, order, clients]);

  // Payments already made on this order
  const orderPayments = useMemo(() => {
    if (!order) return [];
    return payments.filter(p => !p.deletedAt && p.invoiceId === order.id);
  }, [order, payments]);

  const orderPaidTotal = useMemo(() => {
    return orderPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [orderPayments]);

  const orderPendingTotal = useMemo(() => {
    if (!order) return 0;
    return Math.max(0, (order.total || 0) - orderPaidTotal);
  }, [order, orderPaidTotal]);

  // Client metrics if not paying against a specific order
  const clientMetrics = useMemo(() => {
    if (!resolvedClient) return { outstanding: 0 };
    return getClientMetrics(resolvedClient.id, 'all');
  }, [resolvedClient]);

  // Maximum allowed payment amount
  const maxAllowedAmount = useMemo(() => {
    if (order) return orderPendingTotal;
    return Math.max(0, clientMetrics.outstanding);
  }, [order, orderPendingTotal, clientMetrics]);

  // Detect division from order or default to primary
  const detectedDivision = useMemo<Division>(() => {
    if (order) {
      if (order.division === 'bakery') return 'bakery';
      if (order.division === 'primary') return 'primary';
      // Check items
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
      }
    }
    return 'primary';
  }, [order, products]);

  // Form State
  const [amount, setAmount] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [division, setDivision] = useState<Division>('primary');
  const [reference, setReference] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // Prefill when modal opens
  useEffect(() => {
    if (isOpen) {
      const defaultAmt = order ? orderPendingTotal : Math.max(0, clientMetrics.outstanding);
      setAmount(defaultAmt > 0 ? String(defaultAmt) : '');
      setPaymentDate(format(new Date(), 'yyyy-MM-dd'));
      setMethod('cash');
      setDivision(detectedDivision);
      setReference('');
      setNotes('');
      setError('');
      setLoading(false);
    }
  }, [isOpen, order, orderPendingTotal, clientMetrics.outstanding, detectedDivision]);

  if (!isOpen || !resolvedClient) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const numericAmount = parseFloat(amount);

    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError('Please enter a valid payment amount greater than ₹0.');
      return;
    }

    // Validation: prevent payment greater than pending amount
    if (maxAllowedAmount > 0 && numericAmount > maxAllowedAmount + 0.01) {
      setError(
        `Payment amount (₹${numericAmount}) cannot exceed the remaining pending amount of ${formatCurrency(
          maxAllowedAmount
        )}.`
      );
      return;
    }

    setLoading(true);

    try {
      const staffName =
        user?.name || user?.displayName || (user?.role === 'staff' ? 'Staff' : 'Admin');
      const staffId = user?.uid || null;

      const isDirect = resolvedClient.id === 'direct' || isDirectSaleOrder;

      await recordPaymentAtomic({
        orderType: isDirect ? 'direct' : 'client',
        clientId: resolvedClient.id,
        clientName: resolvedClient.name,
        region: resolvedClient.region || (isDirect ? 'Direct Sale' : ''),
        invoiceId: order ? order.id : null,
        amount: numericAmount,
        method,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        billDate: order ? order.deliveryDate : paymentDate,
        paymentDate,
        staffId,
        staffName,
        recordedBy: staffName,
        updatedBy: staffName,
        division,
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
              {isDirectSaleOrder ? 'Record Direct Sale Payment' : 'Record Payment'}
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {isDirectSaleOrder
                ? 'Record payment for Direct Sale · No client ledger affected'
                : 'Record customer collection · Updates Ledger and Pending Collections'}
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

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 flex-1 custom-scrollbar">

          {/* Context Overview Box */}
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

              {order && (
                <div className="text-right">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    Order Date
                  </span>
                  <p className="text-xs font-semibold text-[var(--color-text-main)]">
                    {format(new Date(order.deliveryDate), 'MMM d, yyyy')}
                  </p>
                </div>
              )}
            </div>

            {/* Financial figures */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200/60 dark:border-gray-700/60 text-center">
              <div>
                <p className="text-[10px] font-semibold uppercase text-gray-400">Total</p>
                <p className="text-xs font-bold text-[var(--color-text-main)]">
                  {formatCurrency(order ? order.total : clientMetrics.outstanding)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-gray-400">Paid So Far</p>
                <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(order ? orderPaidTotal : 0)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-gray-400">Remaining Pending</p>
                <p className="text-xs font-extrabold text-amber-600 dark:text-amber-400">
                  {formatCurrency(maxAllowedAmount)}
                </p>
              </div>
            </div>
          </div>

          {/* Amount Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                Payment Amount (₹) <span className="text-red-500">*</span>
              </label>
              {maxAllowedAmount > 0 && (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAmount(String(maxAllowedAmount))}
                    className="text-[11px] font-bold text-[var(--color-primary)] hover:underline"
                  >
                    Pay Full ({formatCurrency(maxAllowedAmount)})
                  </button>
                  {maxAllowedAmount > 10 && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(Math.round(maxAllowedAmount / 2)))}
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
                onChange={e => {
                  setAmount(e.target.value);
                  setError('');
                }}
                required
                className="w-full pl-8 pr-4 py-2.5 text-base font-bold rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] transition-all"
              />
            </div>
          </div>

          {/* Payment Date & Division */}
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

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                Division
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
          </div>

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
              disabled={loading}
              loading={loading}
              className="shadow-md shadow-red-500/20 px-6"
            >
              Save Payment
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
