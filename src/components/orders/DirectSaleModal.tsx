import React, { useState, useMemo } from 'react';
import { X, Plus, Trash2, ShoppingBag, CreditCard, Calendar, UserCheck, AlertCircle, Check } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useDataStore } from '../../stores/dataStore';
import { useAuthStore } from '../../stores/authStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { createDirectSale, type DirectSaleItem } from '../../services/db';
import { type PaymentMethod, type Division } from '../../types';
import { formatCurrency, cn, getProductDivision } from '../../lib/utils';
import { Button } from '../ui';

interface DirectSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (orderId: string) => void;
}

interface FormItem {
  id: string; // local key for React list
  productId: string;
  productName: string;
  qty: number | '';
  unitPrice: number | '';
}

const PAYMENT_METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'bank_transfer', label: 'Bank Transfer' },
  { id: 'card', label: 'Card' },
];

export default function DirectSaleModal({ isOpen, onClose, onSuccess }: DirectSaleModalProps) {
  const { products } = useDataStore();
  const { user } = useAuthStore();
  const { activeDivision } = useDivisionStore();

  const activeProducts = useMemo(() => {
    return products
      .filter((p) => p.status === 'active' && !p.deletedAt)
      .sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99));
  }, [products]);

  // Form states
  const [saleDate, setSaleDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [selectedDivision, setSelectedDivision] = useState<Division>(
    activeDivision === 'bakery' ? 'bakery' : 'primary'
  );
  const [items, setItems] = useState<FormItem[]>([
    { id: '1', productId: '', productName: '', qty: 1, unitPrice: '' },
  ]);
  const [notes, setNotes] = useState<string>('');
  const [reference, setReference] = useState<string>('');

  // Payment states
  const [recordImmediatePayment, setRecordImmediatePayment] = useState<boolean>(true);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentReference, setPaymentReference] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Calculate totals
  const subtotal = useMemo(() => {
    return items.reduce((sum, item) => {
      const q = typeof item.qty === 'number' ? item.qty : 0;
      const p = typeof item.unitPrice === 'number' ? item.unitPrice : 0;
      return sum + q * p;
    }, 0);
  }, [items]);

  const total = subtotal;

  // Sync default payment amount when total changes and user hasn't typed custom
  const effectivePaymentAmount = useMemo(() => {
    if (!recordImmediatePayment) return 0;
    const n = parseFloat(paymentAmount);
    return isNaN(n) ? 0 : n;
  }, [recordImmediatePayment, paymentAmount]);

  const remainingBalance = useMemo(() => {
    return Math.max(0, total - effectivePaymentAmount);
  }, [total, effectivePaymentAmount]);

  if (!isOpen) return null;

  const handleProductChange = (index: number, productId: string) => {
    const prod = activeProducts.find((p) => p.id === productId);
    setItems((prev) => {
      const copy = [...prev];
      const defaultPrice = (prod as any)?.price ?? (prod as any)?.defaultPrice ?? '';
      copy[index] = {
        ...copy[index],
        productId,
        productName: prod ? prod.name : '',
        unitPrice: copy[index].unitPrice !== '' ? copy[index].unitPrice : defaultPrice,
      };
      return copy;
    });
  };

  const handleQtyChange = (index: number, val: string) => {
    const qty = val === '' ? '' : Math.max(0, parseInt(val, 10) || 0);
    setItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], qty };
      return copy;
    });
  };

  const handlePriceChange = (index: number, val: string) => {
    const price = val === '' ? '' : Math.max(0, parseFloat(val) || 0);
    setItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], unitPrice: price };
      return copy;
    });
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { id: String(Date.now()), productId: '', productName: '', qty: 1, unitPrice: '' },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) {
      setItems([{ id: String(Date.now()), productId: '', productName: '', qty: 1, unitPrice: '' }]);
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSetFullPayment = () => {
    setRecordImmediatePayment(true);
    setPaymentAmount(String(total));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    const validItems: DirectSaleItem[] = [];
    for (const item of items) {
      if (!item.productId) {
        setError('Please select a product for all rows or remove unused rows.');
        return;
      }
      const q = typeof item.qty === 'number' ? item.qty : 0;
      if (q <= 0) {
        setError(`Please enter a valid quantity greater than 0 for ${item.productName || 'product'}.`);
        return;
      }
      const p = typeof item.unitPrice === 'number' ? item.unitPrice : 0;
      if (p < 0) {
        setError(`Selling price cannot be negative for ${item.productName || 'product'}.`);
        return;
      }
      validItems.push({
        productId: item.productId,
        productName: item.productName,
        qty: q,
        unitPrice: p,
        total: q * p,
      });
    }

    if (validItems.length === 0) {
      setError('Please add at least one product.');
      return;
    }

    // Payment validation
    let paymentPayload: { amount: number; method: PaymentMethod; reference?: string } | undefined = undefined;
    if (recordImmediatePayment && effectivePaymentAmount > 0) {
      if (effectivePaymentAmount < 0) {
        setError('Payment amount cannot be negative.');
        return;
      }
      if (effectivePaymentAmount > total + 0.01) {
        setError(`Payment amount (${formatCurrency(effectivePaymentAmount)}) cannot exceed total (${formatCurrency(total)}).`);
        return;
      }
      paymentPayload = {
        amount: effectivePaymentAmount,
        method: paymentMethod,
        reference: paymentReference.trim() || reference.trim() || undefined,
      };
    }

    setLoading(true);

    try {
      const orderId = await createDirectSale({
        date: saleDate,
        items: validItems,
        division: selectedDivision,
        notes: notes.trim() || undefined,
        reference: reference.trim() || undefined,
        payment: paymentPayload,
      });

      toast.success(
        `Direct Sale of ${formatCurrency(total)} created successfully.${
          paymentPayload ? ` Payment of ${formatCurrency(paymentPayload.amount)} recorded.` : ''
        }`
      );

      if (onSuccess) onSuccess(orderId);
      onClose();
    } catch (err: any) {
      console.error('Failed to create direct sale:', err);
      setError(err.message || 'Failed to create direct sale. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loggedInStaffName = user?.name || user?.displayName || (user?.role === 'admin' ? 'Admin' : 'Staff');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[var(--color-card)] rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-800 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/40">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <ShoppingBag className="w-5 h-5" />
              </span>
              <h2 className="text-lg font-bold text-[var(--color-text-main)]">
                New Direct Sale
              </h2>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                Company Sale
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Direct buyer sale without client ledger &middot; Recorded automatically under <strong>{loggedInStaffName}</strong>
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

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
          
          {error && (
            <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Sale Metadata Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1.5">
                Sale Date
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="date"
                  required
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1.5">
                Division
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedDivision('primary')}
                  className={cn(
                    'flex-1 py-2 text-xs font-bold rounded-xl border transition-all',
                    selectedDivision === 'primary'
                      ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-xs'
                      : 'bg-transparent text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
                  )}
                >
                  Primary Foods
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDivision('bakery')}
                  className={cn(
                    'flex-1 py-2 text-xs font-bold rounded-xl border transition-all',
                    selectedDivision === 'bakery'
                      ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                      : 'bg-transparent text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
                  )}
                >
                  Bakery Foods
                </button>
              </div>
            </div>
          </div>

          {/* Product Items Table / Rows */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                Products & Quantities
              </label>
              <span className="text-[11px] text-gray-400">
                {items.length} item{items.length > 1 ? 's' : ''}
              </span>
            </div>

            <div className="space-y-2.5">
              {items.map((item, idx) => {
                const lineTotal =
                  (typeof item.qty === 'number' ? item.qty : 0) *
                  (typeof item.unitPrice === 'number' ? item.unitPrice : 0);

                return (
                  <div
                    key={item.id}
                    className="p-3 rounded-2xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
                  >
                    {/* Product Selector */}
                    <div className="flex-1 min-w-[180px]">
                      <select
                        value={item.productId}
                        onChange={(e) => handleProductChange(idx, e.target.value)}
                        className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-700 bg-[var(--color-card)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                      >
                        <option value="">-- Select Product --</option>
                        {activeProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {p.unit ? `(${p.unit})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Quantity */}
                    <div className="w-full sm:w-24">
                      <div className="relative">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          placeholder="Qty"
                          value={item.qty}
                          onChange={(e) => handleQtyChange(idx, e.target.value)}
                          className="w-full px-3 py-2 text-xs font-bold text-center rounded-xl border border-gray-200 dark:border-gray-700 bg-[var(--color-card)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                        />
                      </div>
                    </div>

                    {/* Unit Price */}
                    <div className="w-full sm:w-28">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
                          ₹
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Price"
                          value={item.unitPrice}
                          onChange={(e) => handlePriceChange(idx, e.target.value)}
                          className="w-full pl-6 pr-2.5 py-2 text-xs font-bold text-right rounded-xl border border-gray-200 dark:border-gray-700 bg-[var(--color-card)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                        />
                      </div>
                    </div>

                    {/* Row Total */}
                    <div className="w-full sm:w-28 text-right font-extrabold text-xs tabular-nums text-[var(--color-text-main)] px-1 py-1">
                      {formatCurrency(lineTotal)}
                    </div>

                    {/* Remove Action */}
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(idx)}
                      disabled={items.length <= 1}
                      className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 shrink-0 self-end sm:self-center"
                      title="Remove item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleAddItem}
              className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-[var(--color-primary)] hover:underline"
            >
              <Plus className="w-3.5 h-3.5" /> Add Another Product
            </button>
          </div>

          {/* Subtotal / Grand Total Bar */}
          <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
              Sale Total
            </span>
            <span className="text-xl font-black text-[var(--color-text-main)] tabular-nums">
              {formatCurrency(total)}
            </span>
          </div>

          {/* Payment Section */}
          <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800 space-y-3.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[var(--color-text-main)] flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-[var(--color-primary)]" />
                Payment Collection
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSetFullPayment}
                  className="text-[11px] font-bold text-[var(--color-primary)] hover:underline"
                >
                  Full Payment
                </button>
                <span className="text-gray-300 dark:text-gray-700">&middot;</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recordImmediatePayment}
                    onChange={(e) => setRecordImmediatePayment(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all dark:border-gray-600 peer-checked:bg-[var(--color-primary)]"></div>
                </label>
              </div>
            </div>

            {recordImmediatePayment && (
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--color-text-muted)] mb-1">
                      Payment Amount (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={total}
                      step="0.01"
                      placeholder="0.00"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-gray-200 dark:border-gray-700 bg-[var(--color-card)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--color-text-muted)] mb-1">
                      Payment Method
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                      className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-700 bg-[var(--color-card)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--color-text-muted)] mb-1">
                      Txn / UPI Reference (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. UPI Ref / GPay"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-700 bg-[var(--color-card)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                    />
                  </div>

                  <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-gray-100/60 dark:bg-gray-800/40 text-xs">
                    <span className="text-[var(--color-text-muted)] font-medium">
                      Remaining Pending:
                    </span>
                    <span
                      className={cn(
                        'font-bold tabular-nums',
                        remainingBalance <= 0.01
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      )}
                    >
                      {formatCurrency(remainingBalance)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Notes & Buyer Reference */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">
                Buyer Reference / Name (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Walk-in / Counter buyer"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">
                Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="Additional sale remarks"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
              />
            </div>
          </div>

          {/* Staff Identification Confirmation */}
          <div className="p-3 rounded-2xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 flex items-center gap-2.5 text-xs text-blue-700 dark:text-blue-300">
            <UserCheck className="w-4 h-4 shrink-0" />
            <span>
              Recorded automatically as: <strong>{loggedInStaffName}</strong>
            </span>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-100 dark:border-gray-800">
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={loading || total <= 0}
              className="px-6"
            >
              {loading ? 'Creating...' : `Create Direct Sale (${formatCurrency(total)})`}
            </Button>
          </div>
        </form>

      </div>
    </div>
  );
}
