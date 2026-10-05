import React, { useState, useEffect } from 'react';
import { X, Wallet, Calendar, AlertCircle, Trash2, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { type Client, type Division } from '../../types';
import { saveClientOpeningBalance } from '../../services/db';
import { useAuthStore } from '../../stores/authStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { Button } from '../ui';
import { formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';

interface OpeningBalanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: Client;
  onSuccess?: () => void;
}

export default function OpeningBalanceModal({
  isOpen,
  onClose,
  client,
  onSuccess,
}: OpeningBalanceModalProps) {
  const { user } = useAuthStore();
  const { activeDivision } = useDivisionStore();
  const isAdmin = user?.role === 'admin';

  const [amount, setAmount] = useState<string>('');
  const [asOfDate, setAsOfDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [division, setDivision] = useState<Division>('primary');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const existingOB = client.openingBalance;
  const hasExistingOB = (client.openingBalanceAmount ?? existingOB?.amount ?? 0) > 0;

  useEffect(() => {
    if (isOpen && client) {
      if (existingOB && existingOB.amount > 0) {
        setAmount(String(existingOB.amount));
        setAsOfDate(existingOB.asOfDate || format(new Date(), 'yyyy-MM-dd'));
        setNotes(existingOB.notes || '');
        setDivision(existingOB.division || (activeDivision === 'bakery' ? 'bakery' : 'primary'));
      } else if ((client.openingBalanceAmount || 0) > 0) {
        setAmount(String(client.openingBalanceAmount));
        setAsOfDate(format(new Date(), 'yyyy-MM-dd'));
        setNotes('');
        setDivision(activeDivision === 'bakery' ? 'bakery' : 'primary');
      } else {
        setAmount('');
        setAsOfDate(format(new Date(), 'yyyy-MM-dd'));
        setNotes('');
        setDivision(activeDivision === 'bakery' ? 'bakery' : 'primary');
      }
      setError('');
      setLoading(false);
    }
  }, [isOpen, client, existingOB, activeDivision]);

  if (!isOpen || !client || !isAdmin) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount < 0) {
      setError('Please enter a valid amount (₹0 or greater).');
      return;
    }

    if (!asOfDate) {
      setError('Please select an as-of date.');
      return;
    }

    setLoading(true);
    try {
      await saveClientOpeningBalance(client.id, {
        amount: numericAmount,
        asOfDate,
        notes: notes.trim(),
        division,
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to save opening balance:', err);
      setError(err.message || 'Failed to save opening balance.');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm(`Are you sure you want to remove the opening balance for ${client.name}?`)) {
      return;
    }
    setLoading(true);
    try {
      await saveClientOpeningBalance(client.id, {
        amount: 0,
        asOfDate: format(new Date(), 'yyyy-MM-dd'),
        notes: '',
        division,
      });
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to clear opening balance:', err);
      setError(err.message || 'Failed to clear opening balance.');
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
              <Wallet className="w-5 h-5 text-[var(--color-primary)]" />
              Opening Balance
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Set initial outstanding balance for old sales prior to using this app
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
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Client Overview Banner */}
          <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  Client / Shop
                </span>
                <p className="text-sm font-bold text-[var(--color-text-main)]">
                  {client.name}
                  {client.region && (
                    <span className="text-xs font-normal text-gray-400 ml-1.5">
                      ({client.region})
                    </span>
                  )}
                </p>
              </div>
              {hasExistingOB && (
                <div className="text-right">
                  <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider">
                    Current Opening Balance
                  </span>
                  <p className="text-sm font-bold text-amber-600 tabular-nums">
                    {formatCurrency(existingOB?.amount || client.openingBalanceAmount || 0)}
                  </p>
                </div>
              )}
            </div>
            {hasExistingOB && existingOB?.asOfDate && (
              <p className="text-xs text-[var(--color-text-muted)] mt-2 pt-2 border-t border-gray-200 dark:border-gray-700/60">
                As of <span className="font-semibold text-[var(--color-text-main)]">{format(new Date(existingOB.asOfDate), 'dd MMM yyyy')}</span>
                {existingOB.notes ? ` · Note: "${existingOB.notes}"` : ''}
              </p>
            )}
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-2 text-xs font-semibold text-red-600 dark:text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Amount Field */}
          <div>
            <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
              Opening Balance Amount (₹) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-bold text-gray-400">
                ₹
              </span>
              <input
                type="number"
                step="any"
                min="0"
                required
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full pl-9 pr-4 py-3 rounded-2xl border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] font-bold text-lg focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] outline-none transition-all shadow-sm"
              />
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5">
              Enter the outstanding balance client owed before starting with this app.
            </p>
          </div>

          {/* Date & Division Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                As of Date <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="date"
                  required
                  value={asOfDate}
                  onChange={e => setAsOfDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] text-sm font-semibold focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] outline-none transition-all shadow-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                Division
              </label>
              <select
                value={division}
                onChange={e => setDivision(e.target.value as Division)}
                className="w-full px-4 py-2.5 rounded-2xl border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] text-sm font-semibold focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] outline-none transition-all shadow-sm"
              >
                <option value="primary">Primary Foods</option>
                <option value="bakery">Bakery Foods</option>
              </select>
            </div>
          </div>

          {/* Note Field */}
          <div>
            <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
              Note (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Previous sales outstanding"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              maxLength={150}
              className="w-full px-4 py-2.5 rounded-2xl border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] text-sm font-medium focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] outline-none transition-all shadow-sm"
            />
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-between gap-3 border-t border-gray-100 dark:border-gray-800">
            {hasExistingOB ? (
              <button
                type="button"
                disabled={loading}
                onClick={handleClear}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Balance
              </button>
            ) : <div />}

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={loading}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={loading}
              >
                Save Opening Balance
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
