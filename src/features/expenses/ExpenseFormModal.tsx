import React, { useState, useEffect } from 'react';
import {
  X, Fuel, Utensils, IndianRupee, FileText, AlertCircle,
  Car, Bus, HelpCircle, CheckCircle2, User, ExternalLink, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { type AppUser } from '../../types/auth.types';
import {
  type PredefinedExpenseCategory,
  type AdminNameDocument,
  PREDEFINED_EXPENSE_CATEGORIES,
} from '../../types/expense.types';
import { createExpenseRecord, validateExpenseCreation } from '../../services/expenseDb';
import { getActiveAdminNames } from '../../services/adminNameService';
import { getBusinessDayStatusLabel } from '../../lib/businessDay';
import { Button, Badge } from '../../components/ui';

interface ExpenseFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (expenseId: string) => void;
  currentUser: AppUser;
}

const CATEGORY_ICONS: Record<PredefinedExpenseCategory, React.ElementType> = {
  CNG: Fuel,
  Petrol: Fuel,
  Diesel: Fuel,
  'Daily Food Expense': Utensils,
  Toll: Car,
  'Bus Charge': Bus,
  'Other Expense': HelpCircle,
};

const CATEGORY_COLORS: Record<PredefinedExpenseCategory, { active: string; inactive: string }> = {
  CNG: {
    active: 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 ring-2 ring-emerald-500',
    inactive: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 hover:bg-emerald-100',
  },
  Petrol: {
    active: 'bg-blue-600 text-white shadow-md shadow-blue-600/30 ring-2 ring-blue-500',
    inactive: 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 hover:bg-blue-100',
  },
  Diesel: {
    active: 'bg-amber-600 text-white shadow-md shadow-amber-600/30 ring-2 ring-amber-500',
    inactive: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50 hover:bg-amber-100',
  },
  'Daily Food Expense': {
    active: 'bg-orange-600 text-white shadow-md shadow-orange-600/30 ring-2 ring-orange-500',
    inactive: 'bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800/50 hover:bg-orange-100',
  },
  Toll: {
    active: 'bg-purple-600 text-white shadow-md shadow-purple-600/30 ring-2 ring-purple-500',
    inactive: 'bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800/50 hover:bg-purple-100',
  },
  'Bus Charge': {
    active: 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-2 ring-indigo-500',
    inactive: 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/50 hover:bg-indigo-100',
  },
  'Other Expense': {
    active: 'bg-rose-600 text-white shadow-md shadow-rose-600/30 ring-2 ring-rose-500',
    inactive: 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800/50 hover:bg-rose-100',
  },
};

export default function ExpenseFormModal({
  isOpen,
  onClose,
  onSuccess,
  currentUser,
}: ExpenseFormModalProps) {
  const isAdmin = currentUser.role === 'admin';

  // Form state
  const [category, setCategory] = useState<PredefinedExpenseCategory>('Diesel');
  const [customExpenseName, setCustomExpenseName] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [notes, setNotes] = useState('');

  // Admin name attribution
  const [adminNames, setAdminNames] = useState<AdminNameDocument[]>([]);
  const [selectedAdminId, setSelectedAdminId] = useState('');
  const [loadingAdminNames, setLoadingAdminNames] = useState(false);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Business day status indicator
  const businessDayInfo = getBusinessDayStatusLabel();

  // Load active admin names if current user is admin
  useEffect(() => {
    if (isAdmin && isOpen) {
      setLoadingAdminNames(true);
      getActiveAdminNames()
        .then((names) => {
          setAdminNames(names);
          if (names.length > 0 && !selectedAdminId) {
            setSelectedAdminId(names[0].id);
          }
        })
        .catch((err) => {
          console.error('Failed to load active admin names:', err);
          toast.error('Failed to load admin names');
        })
        .finally(() => {
          setLoadingAdminNames(false);
        });
    }
  }, [isAdmin, isOpen]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCategorySelect = (cat: PredefinedExpenseCategory) => {
    setCategory(cat);
    setErrorMessage(null);
  };

  const executeSubmission = async (resetForNext: boolean) => {
    setErrorMessage(null);

    const parsedAmount = parseFloat(amountStr);
    const selectedAdmin = adminNames.find((a) => a.id === selectedAdminId);

    const payload = {
      amount: parsedAmount,
      category,
      customExpenseName: category === 'Other Expense' ? customExpenseName.trim() : undefined,
      notes: notes.trim() || undefined,
      adminName: isAdmin ? selectedAdmin?.name : undefined,
      adminNameId: isAdmin ? selectedAdmin?.id : undefined,
    };

    // Client-side quick check
    const validation = validateExpenseCreation(payload, currentUser);
    if (!validation.valid) {
      setErrorMessage(validation.error || 'Please fill in all required fields.');
      return;
    }

    try {
      setSubmitting(true);
      const expenseId = await createExpenseRecord(payload, currentUser);
      toast.success(
        `Expense of ₹${parsedAmount.toFixed(2)} recorded for ${payload.category === 'Other Expense' ? payload.customExpenseName : payload.category}!`
      );

      onSuccess?.(expenseId);

      if (resetForNext) {
        // Keep category and admin selected; clear amount and notes for rapid sequential entry
        setAmountStr('');
        setCustomExpenseName('');
        setNotes('');
        setErrorMessage(null);
      } else {
        onClose();
      }
    } catch (err: any) {
      console.error('Failed to record expense:', err);
      setErrorMessage(err.message || 'Failed to record expense.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSubmission(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      id="expense-form-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-[var(--color-bg)] rounded-3xl shadow-2xl border border-black/[0.08] dark:border-white/[0.08] overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200"
        id="expense-form-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/[0.06] dark:border-white/[0.06] bg-[var(--color-card)] shrink-0">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-main)] tracking-tight">
              Record Daily Expense
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {businessDayInfo.formattedDate}
              </span>
              <span className="text-[11px] text-gray-500 font-medium">
                ({businessDayInfo.closesAtLabel})
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            id="expense-modal-close-button"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
          {/* Active Business Day Banner */}
          <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-800/40 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed font-medium">
              Expenses are recorded under the authoritative business day based on the{' '}
              <span className="font-bold">2:00 AM IST cutoff</span>. Dates cannot be backdated or
              manually altered.
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div
              className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-2.5"
              id="expense-form-error"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Admin Attribution Selector (Admin Only) */}
          {isAdmin ? (
            <div className="space-y-2 p-4 rounded-2xl bg-gray-50/80 dark:bg-gray-800/40 border border-black/[0.04] dark:border-white/[0.04]">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="admin-name-selector"
                  className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider flex items-center gap-1.5"
                >
                  <User className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                  Admin Operator Display Name <span className="text-red-500">*</span>
                </label>
                <Link
                  to="/expenses/admin-names"
                  target="_blank"
                  className="text-[11px] font-semibold text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
                >
                  Manage Names <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              {loadingAdminNames ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--color-primary)]" />
                  Loading registered Admin names...
                </div>
              ) : adminNames.length === 0 ? (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-400">
                  <p className="font-semibold">No active Admin names registered.</p>
                  <p className="mt-0.5 text-[11px]">
                    You must register at least one active Admin name before recording expenses.
                  </p>
                  <Link
                    to="/expenses/admin-names"
                    className="mt-2 inline-flex items-center gap-1 px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700"
                  >
                    Register Name Now
                  </Link>
                </div>
              ) : (
                <select
                  id="admin-name-selector"
                  value={selectedAdminId}
                  onChange={(e) => setSelectedAdminId(e.target.value)}
                  className="w-full px-4 h-11 text-sm rounded-xl font-medium bg-[var(--color-card)] text-[var(--color-text-main)] border border-gray-300 dark:border-gray-700 focus:border-[var(--color-primary)] focus:ring-0 outline-none transition-colors"
                  required
                >
                  {adminNames.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-[11px] text-gray-400">
                Identifies who is recording this expense under the shared Admin account.
              </p>
            </div>
          ) : (
            /* Staff Attribution Indicator (Non-Admin) */
            <div className="p-3.5 rounded-2xl bg-gray-50/80 dark:bg-gray-800/40 border border-black/[0.04] dark:border-white/[0.04] flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">Recorded By</span>
              <span className="text-xs font-bold text-[var(--color-text-main)] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {currentUser.name} ({currentUser.role === 'staff' ? 'Staff' : 'Delivery Staff'})
              </span>
            </div>
          )}

          {/* Category Picker */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider block">
              Expense Category <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" id="expense-category-grid">
              {PREDEFINED_EXPENSE_CATEGORIES.map((cat) => {
                const Icon = CATEGORY_ICONS[cat];
                const isSelected = category === cat;
                const colors = CATEGORY_COLORS[cat];

                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => handleCategorySelect(cat)}
                    className={`flex items-center gap-2.5 p-3 rounded-2xl text-xs font-bold transition-all duration-200 cursor-pointer text-left ${
                      isSelected ? colors.active : colors.inactive
                    }`}
                    id={`category-button-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{cat}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Expense Name (Required only when category === 'Other Expense') */}
          {category === 'Other Expense' && (
            <div className="space-y-1.5 animate-in fade-in duration-200">
              <label
                htmlFor="custom-expense-name"
                className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider block"
              >
                Specific Expense Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="custom-expense-name"
                value={customExpenseName}
                onChange={(e) => setCustomExpenseName(e.target.value)}
                placeholder="e.g. Vehicle Puncture, Oil Top-up, Parking Fee"
                maxLength={50}
                className="w-full px-4 h-11 text-sm rounded-xl font-medium bg-[var(--color-input-bg)] text-[var(--color-text-main)] border border-gray-300 dark:border-gray-700 hover:border-[var(--color-primary)] focus:border-2 focus:border-[var(--color-primary)] outline-none transition-colors"
                required
              />
              <p className="text-[11px] text-gray-400">
                Between 2 and 50 characters describing this custom expense.
              </p>
            </div>
          )}

          {/* Amount Input */}
          <div className="space-y-1.5">
            <label
              htmlFor="expense-amount-input"
              className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider block"
            >
              Amount (₹) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">
                ₹
              </span>
              <input
                type="number"
                id="expense-amount-input"
                step="0.01"
                min="0.01"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0.00"
                className="w-full pl-9 pr-4 h-12 text-lg rounded-xl font-bold bg-[var(--color-input-bg)] text-[var(--color-text-main)] border border-gray-300 dark:border-gray-700 hover:border-[var(--color-primary)] focus:border-2 focus:border-[var(--color-primary)] outline-none transition-colors"
                required
              />
            </div>
            <p className="text-[11px] text-gray-400">
              Enter the exact expense amount paid in INR.
            </p>
          </div>

          {/* Notes (Optional) */}
          <div className="space-y-1.5">
            <label
              htmlFor="expense-notes-input"
              className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider block"
            >
              Optional Notes / Vehicle Number
            </label>
            <textarea
              id="expense-notes-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. KL 10 AZ 4501, 15 Liters at HP Bunk"
              rows={2}
              maxLength={500}
              className="w-full px-4 py-2.5 text-sm rounded-xl font-medium bg-[var(--color-input-bg)] text-[var(--color-text-main)] border border-gray-300 dark:border-gray-700 hover:border-[var(--color-primary)] focus:border-2 focus:border-[var(--color-primary)] outline-none transition-colors resize-none"
            />
            <div className="flex justify-between text-[11px] text-gray-400">
              <span>Receipt number, vehicle plate, or pump location</span>
              <span>{notes.length}/500</span>
            </div>
          </div>
        </form>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-3 p-5 border-t border-black/[0.06] dark:border-white/[0.06] bg-[var(--color-card)] shrink-0">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            id="expense-modal-cancel-button"
          >
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => executeSubmission(true)}
              disabled={submitting || (isAdmin && adminNames.length === 0)}
              id="expense-modal-save-and-add-button"
            >
              {submitting ? 'Saving...' : 'Save & Add Another'}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => executeSubmission(false)}
              loading={submitting}
              disabled={submitting || (isAdmin && adminNames.length === 0)}
              id="expense-modal-submit-button"
            >
              Save Expense
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
