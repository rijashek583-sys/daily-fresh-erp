import React, { useState } from 'react';
import {
  AlertTriangle,
  X,
  Loader2,
  Shield,
  Calendar,
  Tag,
  FileText,
  IndianRupee,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui';
import { formatCurrency } from '../../lib/utils';
import {
  type ExpenseDocument,
  type AdminNameDocument,
} from '../../types/expense.types';
import { type AppUser } from '../../types/auth.types';
import { voidExpenseRecord } from '../../services/expenseDb';

interface ExpenseVoidModalProps {
  expense: ExpenseDocument | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  currentUser: AppUser | null;
  adminNamesList?: AdminNameDocument[];
}

export default function ExpenseVoidModal({
  expense,
  isOpen,
  onClose,
  onSuccess,
  currentUser,
  adminNamesList = [],
}: ExpenseVoidModalProps) {
  const [voidReason, setVoidReason] = useState('');
  const [selectedAdminName, setSelectedAdminName] = useState<string>(
    expense?.adminName || adminNamesList[0]?.name || 'Admin'
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !expense) return null;

  const handleClose = () => {
    if (isSubmitting) return;
    setVoidReason('');
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      setError('You must be logged in as an Administrator.');
      return;
    }

    const trimmedReason = voidReason.trim();
    if (trimmedReason.length < 3) {
      setError('A specific reason of at least 3 characters is strictly required to void an expense.');
      return;
    }

    if (trimmedReason.length > 500) {
      setError('Void reason cannot exceed 500 characters.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await voidExpenseRecord(
        expense.id,
        trimmedReason,
        currentUser,
        selectedAdminName
      );

      toast.success(`Expense of ${formatCurrency(expense.amount)} has been voided.`);
      setVoidReason('');
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('[ExpenseVoidModal] Failed to void expense:', err);
      const msg = err?.message || 'Failed to void expense. Please check your network or permissions.';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-[var(--color-card)] rounded-2xl border border-rose-200 dark:border-rose-900/50 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="void-expense-title"
      >
        {/* ── Modal Header ── */}
        <div className="px-6 py-4 bg-rose-50/80 dark:bg-rose-950/40 border-b border-rose-100 dark:border-rose-900/30 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="void-expense-title" className="text-base font-bold text-[var(--color-text-main)]">
                Void Expense
              </h2>
              <p className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold">
                Admin Audit Action • Non-Destructive Soft Delete
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Modal Form ── */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Explanation Alert */}
          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200/80 dark:border-amber-900/40 text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
            Voiding excludes this expense from all active totals and financial summaries. The original record and your reason will remain permanently in the immutable audit trail.
          </div>

          {/* Expense Details Card */}
          <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-gray-400" />
                Category:
              </span>
              <span className="text-xs font-bold text-[var(--color-text-main)]">
                {expense.category}
                {expense.customExpenseName ? ` (${expense.customExpenseName})` : ''}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5">
                <IndianRupee className="w-3.5 h-3.5 text-gray-400" />
                Amount:
              </span>
              <span className="text-base font-mono font-extrabold text-rose-600 dark:text-rose-400">
                {formatCurrency(expense.amount)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                Business Day:
              </span>
              <span className="text-xs font-mono font-semibold text-gray-700 dark:text-gray-300">
                {expense.businessDay}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-gray-400" />
                Recorded By:
              </span>
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                {expense.creatorRole === 'admin'
                  ? `Admin: ${expense.adminName || 'Admin'}`
                  : `Staff: ${expense.creatorName}`}
              </span>
            </div>

            {expense.notes && (
              <div className="pt-2 border-t border-gray-200/50 dark:border-gray-700/50 text-[11px] text-gray-500 italic">
                Notes: "{expense.notes}"
              </div>
            )}
          </div>

          {/* Admin Attribution Selector (if multiple admin names exist) */}
          {adminNamesList.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Admin Operator Attribution
              </label>
              <select
                value={selectedAdminName}
                onChange={(e) => setSelectedAdminName(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)]"
              >
                {adminNamesList.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Mandatory Void Reason */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="void-reason-input"
                className="block text-xs font-bold text-[var(--color-text-main)]"
              >
                Reason for Voiding <span className="text-rose-500">*</span>
              </label>
              <span className="text-[10px] text-gray-400 font-mono">
                {voidReason.trim().length}/500
              </span>
            </div>
            <textarea
              id="void-reason-input"
              rows={3}
              value={voidReason}
              onChange={(e) => {
                setVoidReason(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. Duplicate receipt recorded by mistake, invoice cancelled, or wrong amount entry..."
              disabled={isSubmitting}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-[var(--color-text-main)] outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all resize-none"
              required
            />
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 rounded-xl border border-rose-200 dark:border-rose-900/50 text-xs text-rose-600 dark:text-rose-400 font-medium">
              {error}
            </div>
          )}

          {/* ── Action Buttons ── */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              size="sm"
              disabled={isSubmitting || voidReason.trim().length < 3}
              className="gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Voiding...
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Confirm Void Expense
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
