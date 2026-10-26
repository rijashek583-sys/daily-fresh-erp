import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, ShieldCheck, CheckCircle2, History, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { type Payment, type PaymentMethod, DIVISION_LABELS } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { Button, Badge } from '../ui';
import { useAuthStore } from '../../stores/authStore';
import { updatePayment } from '../../services/db';
import { toast } from 'sonner';

interface CorrectPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  payment: Payment | null;
  onSuccess?: () => void;
}

export default function CorrectPaymentModal({
  isOpen,
  onClose,
  payment,
  onSuccess,
}: CorrectPaymentModalProps) {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [correctedAmount, setCorrectedAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (payment) {
      setCorrectedAmount(payment.amount.toString());
      setMethod(payment.method || 'cash');
      setReference(payment.reference || '');
      setNotes(payment.notes || '');
      setReason('');
      setIsConfirming(false);
      setShowHistory(false);
    }
  }, [payment, isOpen]);

  if (!isOpen || !payment) return null;

  const originalAmount = Number(payment.amount || 0);
  const parsedNewAmount = parseFloat(correctedAmount);
  const isAmountValid = !isNaN(parsedNewAmount) && parsedNewAmount >= 0;
  const amountDiff = isAmountValid ? parsedNewAmount - originalAmount : 0;
  const isReasonValid = reason.trim().length > 0;
  const history = payment.correctionHistory || [];

  const handleProceedToConfirmation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      toast.error('Only administrators can correct recorded payments.');
      return;
    }
    if (!isAmountValid) {
      toast.error('Please enter a valid correction amount (₹0 or greater).');
      return;
    }
    if (!isReasonValid) {
      toast.error('A reason for correction is strictly required.');
      return;
    }
    setIsConfirming(true);
  };

  const handleExecuteCorrection = async () => {
    if (!isAdmin || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await updatePayment(payment.id, {
        amount: parsedNewAmount,
        method,
        reference: reference.trim(),
        notes: notes.trim(),
        correctionReason: reason.trim(),
      });
      toast.success(`Payment corrected successfully from ${formatCurrency(originalAmount)} to ${formatCurrency(parsedNewAmount)}`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to correct payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[var(--color-bg)] rounded-3xl w-full max-w-lg shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-black/20">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--color-text-main)] flex items-center gap-2">
                Correct Recorded Payment
                <Badge variant="purple" className="text-[10px]">Admin Only</Badge>
              </h2>
              <p className="text-xs text-[var(--color-text-muted)]">
                {payment.clientName} &middot; Payment #{payment.id.slice(0, 10)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 custom-scrollbar flex-1">
          
          {/* Read-only Payment Context Card */}
          <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800 space-y-2 text-xs">
            <div className="flex justify-between items-center text-gray-500">
              <span>Division:</span>
              <span className="font-semibold text-[var(--color-text-main)]">
                {DIVISION_LABELS[payment.division] || payment.division}
              </span>
            </div>
            <div className="flex justify-between items-center text-gray-500">
              <span>Date Recorded:</span>
              <span className="font-semibold text-[var(--color-text-main)]">
                {payment.createdAt ? format(new Date(payment.createdAt), 'MMM d, yyyy h:mm a') : '—'}
              </span>
            </div>
            {payment.invoiceId && (
              <div className="flex justify-between items-center text-gray-500">
                <span>Linked Bill:</span>
                <span className="font-mono font-semibold text-[var(--color-primary)]">
                  #{payment.invoiceId}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-gray-200/60 dark:border-gray-800">
              <span className="font-bold text-gray-700 dark:text-gray-300">Original Amount:</span>
              <span className="text-base font-extrabold text-[var(--color-text-main)]">
                {formatCurrency(originalAmount)}
              </span>
            </div>
          </div>

          {!isConfirming ? (
            <form onSubmit={handleProceedToConfirmation} className="space-y-4">
              
              {/* Corrected Amount Input */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                  Corrected Payment Amount (₹) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-bold text-gray-400">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={correctedAmount}
                    onChange={(e) => setCorrectedAmount(e.target.value)}
                    className="w-full pl-9 pr-4 py-3 text-base font-extrabold rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-all"
                    placeholder="0.00"
                    autoFocus
                  />
                </div>
                {isAmountValid && amountDiff !== 0 && (
                  <p className={`text-xs font-semibold mt-1.5 ${amountDiff < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    Net adjustment: {amountDiff > 0 ? `+${formatCurrency(amountDiff)}` : formatCurrency(amountDiff)}
                  </p>
                )}
              </div>

              {/* Payment Method */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                  Payment Method
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['cash', 'upi', 'bank_transfer', 'card'] as PaymentMethod[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={`py-2 px-2.5 rounded-xl text-xs font-bold capitalize transition-all border-2 text-center ${method === m ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-card)]'}`}
                    >
                      {m.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reference Number */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                  Reference No. (Optional)
                </label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. UPI / Cheque / Txn reference"
                  className="w-full px-4 py-2.5 text-xs font-semibold rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-all"
                />
              </div>

              {/* Mandatory Reason for Correction */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                    Reason for Correction <span className="text-red-500">*</span>
                  </label>
                  <span className="text-[10px] text-gray-400">Required for audit log</span>
                </div>
                <textarea
                  required
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Data entry error: entered ₹3,000 instead of ₹300 on collection receipt"
                  className="w-full px-4 py-2.5 text-xs font-medium rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-all"
                />
              </div>

              {/* History Toggle if exists */}
              {history.length > 0 && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setShowHistory(!showHistory)}
                    className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-[var(--color-primary)]"
                  >
                    <History className="w-3.5 h-3.5" />
                    {showHistory ? 'Hide' : 'Show'} Audit Trail ({history.length} prior correction{history.length > 1 ? 's' : ''})
                  </button>

                  {showHistory && (
                    <div className="mt-2.5 p-3 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/30 space-y-2 text-xs">
                      {history.map((h, idx) => (
                        <div key={idx} className="pb-2 border-b border-purple-100/60 dark:border-purple-900/20 last:border-none last:pb-0">
                          <div className="flex justify-between font-semibold text-purple-950 dark:text-purple-300">
                            <span>{formatCurrency(h.originalAmount)} &rarr; {formatCurrency(h.newAmount)}</span>
                            <span className="text-[10px] text-gray-400">{format(new Date(h.correctedAt), 'MMM d, h:mm a')}</span>
                          </div>
                          <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5">&ldquo;{h.reason}&rdquo;</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">By {h.adminName}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-3">
                <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!isAmountValid || !isReasonValid}
                  className="flex-1 shadow-md shadow-amber-500/20"
                >
                  Review Correction
                </Button>
              </div>
            </form>
          ) : (
            /* Confirmation Step */
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="font-bold text-amber-900 dark:text-amber-200">
                    Confirm Accounting Correction
                  </p>
                  <p className="text-amber-700 dark:text-amber-300">
                    This will atomically recalculate and reconcile the payment, linked order payment status, division debt allocations, and customer ledger entries.
                  </p>
                </div>
              </div>

              {/* Diff Card */}
              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="p-3 rounded-xl bg-white dark:bg-gray-900/60 border border-gray-100 dark:border-gray-800">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Original Amount</span>
                    <p className="text-base font-extrabold text-gray-700 dark:text-gray-300 mt-0.5">
                      {formatCurrency(originalAmount)}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800">
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Corrected Amount</span>
                    <p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {formatCurrency(parsedNewAmount)}
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white dark:bg-gray-900/60 border border-gray-100 dark:border-gray-800 text-xs space-y-1.5">
                  <div className="flex justify-between text-gray-500">
                    <span>Net Adjustment:</span>
                    <span className={`font-bold ${amountDiff < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {amountDiff > 0 ? `+${formatCurrency(amountDiff)}` : formatCurrency(amountDiff)}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>Reason:</span>
                    <span className="font-medium text-[var(--color-text-main)] max-w-[200px] truncate text-right">
                      {reason}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>Authorized Admin:</span>
                    <span className="font-semibold text-[var(--color-text-main)]">
                      {user?.displayName || user?.name || user?.email || 'Admin'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Confirmation Action Buttons */}
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={isSubmitting}
                  onClick={() => setIsConfirming(false)}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleExecuteCorrection}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-lg shadow-amber-600/20"
                >
                  {isSubmitting ? 'Applying Correction...' : 'Confirm Correction'}
                </Button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
