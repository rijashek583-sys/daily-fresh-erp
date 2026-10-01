import React from 'react';
import { X, CheckCircle2, CreditCard, Banknote, Smartphone, Building, User, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { type Order, type Payment, type PaymentMethod } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { Badge, Button } from '../ui';

interface OrderPaymentHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  payments: Payment[];
  onRecordPayment?: () => void;
}

const methodIcon: Record<PaymentMethod, React.ElementType> = {
  upi: Smartphone,
  cash: Banknote,
  bank_transfer: Building,
  card: CreditCard,
};

const methodLabel: Record<PaymentMethod, string> = {
  upi: 'UPI',
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
};

export default function OrderPaymentHistoryModal({
  isOpen,
  onClose,
  order,
  payments,
  onRecordPayment,
}: OrderPaymentHistoryModalProps) {
  if (!isOpen || !order) return null;

  const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const pendingAmount = Math.max(0, (order.total || 0) - totalPaid);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[var(--color-card)] rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-800 w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/40">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-main)] flex items-center gap-2">
              <Clock className="w-5 h-5 text-[var(--color-primary)]" />
              Payment History
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Order #{order.id} &middot; {order.clientName}
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
        <div className="p-6 overflow-y-auto space-y-5 flex-1 custom-scrollbar">

          {/* Overview summary */}
          <div className="grid grid-cols-3 gap-3 p-3.5 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 text-center">
            <div>
              <span className="text-[10px] font-semibold text-gray-400 uppercase">Order Total</span>
              <p className="text-sm font-bold text-[var(--color-text-main)]">{formatCurrency(order.total)}</p>
            </div>
            <div>
              <span className="text-[10px] font-semibold text-gray-400 uppercase">Total Paid</span>
              <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalPaid)}</p>
            </div>
            <div>
              <span className="text-[10px] font-semibold text-gray-400 uppercase">Pending</span>
              <p className={`text-sm font-bold ${pendingAmount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {pendingAmount > 0 ? formatCurrency(pendingAmount) : 'Paid'}
              </p>
            </div>
          </div>

          {/* Payments List */}
          <div>
            <h3 className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider mb-3">
              Recorded Payments ({payments.length})
            </h3>

            {payments.length === 0 ? (
              <div className="text-center py-10 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/20">
                <p className="text-xs font-medium text-gray-500">No payments recorded for this order yet.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {payments.map(p => {
                  const Icon = methodIcon[p.method] || Banknote;
                  return (
                    <div
                      key={p.id}
                      className="p-3.5 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900/60 shadow-xs flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-[var(--color-text-main)]">
                              {formatCurrency(p.amount)}
                            </span>
                            <Badge variant="gray">{methodLabel[p.method] || p.method}</Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-400">
                            <span>{p.createdAt ? format(new Date(p.createdAt), 'MMM d, yyyy') : '—'}</span>
                            {p.updatedBy && (
                              <span>&middot; By {p.updatedBy}</span>
                            )}
                            {p.reference && (
                              <span>&middot; Ref: {p.reference}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/40">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          {pendingAmount > 0 && onRecordPayment && (
            <Button
              size="sm"
              onClick={() => {
                onClose();
                onRecordPayment();
              }}
              className="shadow-sm"
            >
              Record Payment ({formatCurrency(pendingAmount)})
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
