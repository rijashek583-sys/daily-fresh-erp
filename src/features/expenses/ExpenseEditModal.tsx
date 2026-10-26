import React, { useState, useEffect } from 'react';
import {
  X, Fuel, Utensils, Car, Bus, HelpCircle,
  AlertCircle, ShieldAlert, History, User, Lock, ExternalLink, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { type AppUser } from '../../types/auth.types';
import {
  type ExpenseDocument,
  type PredefinedExpenseCategory,
  type AdminNameDocument,
  type ExpenseEditAuditRecord,
  PREDEFINED_EXPENSE_CATEGORIES,
} from '../../types/expense.types';
import { updateExpenseRecord } from '../../services/expenseDb';
import { getActiveAdminNames } from '../../services/adminNameService';
import { isCurrentBusinessDay, formatBusinessDayDisplay } from '../../lib/businessDay';
import { Button, Badge } from '../../components/ui';

interface ExpenseEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  expense: ExpenseDocument | null;
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

export default function ExpenseEditModal({
  isOpen,
  onClose,
  onSuccess,
  expense,
  currentUser,
}: ExpenseEditModalProps) {
  if (!isOpen || !expense) return null;

  const isAdmin = currentUser.role === 'admin';
  const isToday = isCurrentBusinessDay(expense.businessDay);

  // Form states
  const [category, setCategory] = useState<PredefinedExpenseCategory>(expense.category);
  const [customExpenseName, setCustomExpenseName] = useState(expense.customExpenseName || '');
  const [amountStr, setAmountStr] = useState(String(expense.amount));
  const [notes, setNotes] = useState(expense.notes || '');

  // Admin attribution for editor
  const [adminNames, setAdminNames] = useState<AdminNameDocument[]>([]);
  const [selectedEditorAdminName, setSelectedEditorAdminName] = useState('');
  const [loadingAdminNames, setLoadingAdminNames] = useState(false);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Populate form with current expense values
  useEffect(() => {
    if (expense) {
      setCategory(expense.category);
      setCustomExpenseName(expense.customExpenseName || '');
      setAmountStr(String(expense.amount));
      setNotes(expense.notes || '');
      setErrorMessage(null);
    }
  }, [expense]);

  // Load active admin names if current user is admin
  useEffect(() => {
    if (isAdmin && isOpen) {
      setLoadingAdminNames(true);
      getActiveAdminNames()
        .then((names) => {
          setAdminNames(names);
          if (names.length > 0) {
            setSelectedEditorAdminName(names[0].name);
          }
        })
        .catch((err) => {
          console.error('Failed to load active admin names for editor:', err);
        })
        .finally(() => {
          setLoadingAdminNames(false);
        });
    }
  }, [isAdmin, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!isToday) {
      setErrorMessage('Editing is permanently closed for previous business days.');
      return;
    }

    const parsedAmount = parseFloat(amountStr);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setErrorMessage('Amount must be a positive number greater than 0.');
      return;
    }

    if (category === 'Other Expense') {
      const trimmed = customExpenseName.trim();
      if (trimmed.length < 2 || trimmed.length > 50) {
        setErrorMessage('Specific expense name must be between 2 and 50 characters.');
        return;
      }
    }

    if (isAdmin && !selectedEditorAdminName.trim()) {
      setErrorMessage('Admin editor name is required for audit trail attribution.');
      return;
    }

    try {
      setSubmitting(true);
      await updateExpenseRecord(
        expense.id,
        {
          amount: parsedAmount,
          category,
          customExpenseName: category === 'Other Expense' ? customExpenseName.trim() : null,
          notes: notes.trim() || null,
          editorAdminName: isAdmin ? selectedEditorAdminName.trim() : undefined,
        },
        currentUser
      );

      toast.success('Expense updated successfully. Edit recorded in audit trail.');
      onSuccess?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to update expense:', err);
      setErrorMessage(err.message || 'Failed to update expense.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      id="expense-edit-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-[var(--color-bg)] rounded-3xl shadow-2xl border border-black/[0.08] dark:border-white/[0.08] overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200"
        id="expense-edit-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/[0.06] dark:border-white/[0.06] bg-[var(--color-card)] shrink-0">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-main)] tracking-tight">
              {isToday ? 'Edit Today\'s Expense' : 'View Expense Details'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Business Day: {formatBusinessDayDisplay(expense.businessDay)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            id="expense-edit-close-button"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
          {/* Lockout Notice if Past Business Day */}
          {!isToday ? (
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-3">
              <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Editing Locked — Previous Business Day</p>
                <p className="mt-0.5 text-[11px] leading-relaxed">
                  This expense belongs to business day {expense.businessDay}, which closed at 2:00 AM IST.
                  In accordance with financial compliance rules, closed business-day records are permanently read-only.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                Edits to today's records are tracked in an immutable audit trail.
                Original creator attribution remains permanently preserved.
              </div>
            </div>
          )}

          {/* Immutable Creator & Attribution Card */}
          <div className="p-4 rounded-2xl bg-gray-50/80 dark:bg-gray-800/40 border border-black/[0.04] dark:border-white/[0.04] space-y-2 text-xs">
            <div className="font-bold text-gray-400 uppercase tracking-wider text-[10px]">
              Original Creation Details (Immutable)
            </div>
            <div className="grid grid-cols-2 gap-2 text-gray-700 dark:text-gray-300">
              <div>
                <span className="text-gray-400 block text-[11px]">Recorded By</span>
                <span className="font-semibold">{expense.creatorName}</span>
                <span className="text-[10px] text-gray-400 ml-1">
                  ({expense.creatorRole === 'admin' ? 'Admin' : 'Staff'})
                </span>
              </div>
              {expense.adminName && (
                <div>
                  <span className="text-gray-400 block text-[11px]">Admin Operator</span>
                  <span className="font-semibold text-[var(--color-primary)]">{expense.adminName}</span>
                </div>
              )}
              <div>
                <span className="text-gray-400 block text-[11px]">Created At</span>
                <span className="font-mono text-[11px]">
                  {new Date(expense.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block text-[11px]">Status</span>
                {expense.isEdited ? (
                  <Badge variant="warning" className="text-[10px]">
                    Edited ({expense.editCount}x)
                  </Badge>
                ) : (
                  <Badge variant="success" className="text-[10px]">
                    Original Record
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div
              className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-2.5"
              id="expense-edit-error"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Admin Editor Attribution (Admin Only) */}
          {isAdmin && isToday && (
            <div className="space-y-1.5 p-4 rounded-2xl bg-gray-50/80 dark:bg-gray-800/40 border border-black/[0.04] dark:border-white/[0.04]">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="editor-admin-name-selector"
                  className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider flex items-center gap-1.5"
                >
                  <User className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                  Editor Operator Name <span className="text-red-500">*</span>
                </label>
                <Link
                  to="/expenses/admin-names"
                  target="_blank"
                  className="text-[11px] font-semibold text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
                >
                  Manage <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              {loadingAdminNames ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-1">
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--color-primary)]" />
                  Loading admin names...
                </div>
              ) : (
                <select
                  id="editor-admin-name-selector"
                  value={selectedEditorAdminName}
                  onChange={(e) => setSelectedEditorAdminName(e.target.value)}
                  className="w-full px-4 h-10 text-sm rounded-xl font-medium bg-[var(--color-card)] text-[var(--color-text-main)] border border-gray-300 dark:border-gray-700 focus:border-[var(--color-primary)] focus:ring-0 outline-none transition-colors"
                  required
                >
                  {adminNames.map((a) => (
                    <option key={a.id} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-[11px] text-gray-400">
                Logged in the audit trail as the operator who performed this modification.
              </p>
            </div>
          )}

          {/* Category Picker */}
          <div className="space-y-1.5">
            <label htmlFor="edit-category-select" className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider block">
              Expense Category <span className="text-red-500">*</span>
            </label>
            <select
              id="edit-category-select"
              value={category}
              onChange={(e) => setCategory(e.target.value as PredefinedExpenseCategory)}
              disabled={!isToday}
              className="w-full px-4 h-11 text-sm rounded-xl font-medium bg-[var(--color-input-bg)] text-[var(--color-text-main)] border border-gray-300 dark:border-gray-700 disabled:opacity-60 disabled:cursor-not-allowed outline-none"
            >
              {PREDEFINED_EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Custom Name if Other Expense */}
          {category === 'Other Expense' && (
            <div className="space-y-1.5 animate-in fade-in duration-200">
              <label
                htmlFor="edit-custom-expense-name"
                className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider block"
              >
                Specific Expense Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="edit-custom-expense-name"
                value={customExpenseName}
                onChange={(e) => setCustomExpenseName(e.target.value)}
                disabled={!isToday}
                maxLength={50}
                className="w-full px-4 h-11 text-sm rounded-xl font-medium bg-[var(--color-input-bg)] text-[var(--color-text-main)] border border-gray-300 dark:border-gray-700 disabled:opacity-60 disabled:cursor-not-allowed outline-none"
                required
              />
            </div>
          )}

          {/* Amount */}
          <div className="space-y-1.5">
            <label
              htmlFor="edit-amount-input"
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
                id="edit-amount-input"
                step="0.01"
                min="0.01"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                disabled={!isToday}
                className="w-full pl-9 pr-4 h-12 text-lg rounded-xl font-bold bg-[var(--color-input-bg)] text-[var(--color-text-main)] border border-gray-300 dark:border-gray-700 disabled:opacity-60 disabled:cursor-not-allowed outline-none"
                required
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label
              htmlFor="edit-notes-input"
              className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider block"
            >
              Notes
            </label>
            <textarea
              id="edit-notes-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!isToday}
              rows={2}
              maxLength={500}
              className="w-full px-4 py-2.5 text-sm rounded-xl font-medium bg-[var(--color-input-bg)] text-[var(--color-text-main)] border border-gray-300 dark:border-gray-700 disabled:opacity-60 disabled:cursor-not-allowed outline-none resize-none"
            />
          </div>

          {/* Audit Trail Section */}
          {expense.auditTrail && expense.auditTrail.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-black/[0.04] dark:border-white/[0.04]">
              <div className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wider">
                <History className="w-3.5 h-3.5" />
                Audit Trail ({expense.auditTrail.length} modification{expense.auditTrail.length > 1 ? 's' : ''})
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                {expense.auditTrail.map((record, idx) => {
                  if ('action' in record && record.action === 'void') {
                    return (
                      <div
                        key={idx}
                        className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/50 dark:border-rose-900/30 text-[11px] space-y-1"
                      >
                        <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
                          <span className="font-semibold">
                            Voided by Admin: {record.voidedByAdminName || record.voidedByName}
                          </span>
                          <span>{new Date(record.voidedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="text-gray-600 dark:text-gray-400">
                          Reason: {record.voidReason}
                        </div>
                      </div>
                    );
                  }
                  const edit = record as ExpenseEditAuditRecord;
                  return (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-black/[0.04] dark:border-white/[0.04] text-[11px] space-y-1"
                    >
                      <div className="flex items-center justify-between text-gray-500">
                        <span className="font-semibold text-[var(--color-text-main)]">
                          {edit.editorAdminName ? `Admin: ${edit.editorAdminName}` : 'Staff Edit'}
                        </span>
                        <span>{new Date(edit.editedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="text-gray-600 dark:text-gray-400">
                        Amount: ₹{edit.previousValues.amount.toFixed(2)} → ₹{edit.newValues.amount.toFixed(2)}
                        {edit.previousValues.category !== edit.newValues.category && (
                          <span> | Category: {edit.previousValues.category} → {edit.newValues.category}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </form>

        {/* Action Footer */}
        <div className="flex items-center justify-between p-5 border-t border-black/[0.06] dark:border-white/[0.06] bg-[var(--color-card)] shrink-0">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            id="expense-edit-cancel-button"
          >
            {isToday ? 'Cancel' : 'Close'}
          </Button>

          {isToday && (
            <Button
              type="button"
              variant="primary"
              onClick={handleSubmit}
              loading={submitting}
              id="expense-edit-save-button"
            >
              Save Changes
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
