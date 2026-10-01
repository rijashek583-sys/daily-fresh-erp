import { useState, useMemo } from 'react';
import { Search, History, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useStockStore } from '../../stores/stockStore';
import { useDataStore } from '../../stores/dataStore';
import { getFinishedStockBalance, addFinishedStockTransaction } from '../../services/stockDb';
import { getProductDivision } from '../../lib/utils';
import { PageHeader, Card, Button, Badge } from '../../components/ui';

interface AdjustModal { productId: string; productName: string; division: string; unit: string; }

function AdjustStockModal({ modal, onClose }: { modal: AdjustModal; onClose: () => void }) {
  const [sign, setSign] = useState<1 | -1>(1);
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qtyNum = parseFloat(qty);
    if (!qtyNum || qtyNum <= 0) return toast.error('Enter a valid quantity');
    if (!notes.trim()) return toast.error('Reason is required for adjustments');
    setLoading(true);
    try {
      await addFinishedStockTransaction({
        productId: modal.productId,
        productName: modal.productName,
        division: modal.division,
        type: 'adjustment',
        sign,
        qty: qtyNum,
        notes: notes || undefined,
        date,
      });
      toast.success('Adjustment saved');
      onClose();
    } catch { toast.error('Failed to save'); }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-[var(--color-card)] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h2 className="text-lg font-bold text-[var(--color-text-main)] mb-1">Stock Adjustment</h2>
        <p className="text-sm font-medium text-[var(--color-text-muted)] mb-5">{modal.productName} · {modal.unit}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-sm text-[var(--color-text-main)] focus:outline-none"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Direction</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSign(1)}
                className={`flex-1 py-2 rounded-xl border text-sm font-semibold transition-colors ${sign === 1 ? 'bg-green-500 text-white border-green-500' : 'border-gray-200 dark:border-white/10 text-[var(--color-text-muted)]'}`}
              >
                + Add
              </button>
              <button
                type="button"
                onClick={() => setSign(-1)}
                className={`flex-1 py-2 rounded-xl border text-sm font-semibold transition-colors ${sign === -1 ? 'bg-red-500 text-white border-red-500' : 'border-gray-200 dark:border-white/10 text-[var(--color-text-muted)]'}`}
              >
                − Deduct
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Quantity ({modal.unit})</label>
            <input
              type="number"
              min="1"
              step="1"
              value={qty}
              onChange={e => setQty(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-sm text-[var(--color-text-main)] focus:outline-none"
              placeholder="0"
              required
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Reason (required)</label>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-sm text-[var(--color-text-main)] focus:outline-none"
              placeholder="e.g. Physical count difference"
              required
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={loading}>Save</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProductHistoryModal({ productId, productName, unit, onClose }: { productId: string; productName: string; unit: string; onClose: () => void }) {
  const { finishedStockTransactions } = useStockStore();
  const txs = useMemo(() =>
    finishedStockTransactions
      .filter(t => t.productId === productId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [finishedStockTransactions, productId]
  );

  const TYPE_LABELS: Record<string, string> = {
    opening: 'Opening',
    production: 'Production',
    production_reversal: 'Prod. Reversal',
    order_deduction: 'Order',
    order_reversal: 'Order Reversal',
    adjustment: 'Adjustment',
  };

  const TYPE_COLORS: Record<string, string> = {
    opening: 'text-blue-600 dark:text-blue-400',
    production: 'text-green-600 dark:text-green-400',
    production_reversal: 'text-amber-600 dark:text-amber-400',
    order_deduction: 'text-red-600 dark:text-red-400',
    order_reversal: 'text-purple-600 dark:text-purple-400',
    adjustment: 'text-gray-600 dark:text-gray-400',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-[var(--color-card)] rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-main)]">{productName}</h2>
            <p className="text-xs font-medium text-[var(--color-text-muted)]">Stock Movement History · {txs.length} transactions</p>
          </div>
          <button onClick={onClose} className="text-sm font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]">Close</button>
        </div>
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--color-card)]">
              <tr className="border-b border-gray-100 dark:border-white/5">
                <th className="text-left py-2 px-3 text-xs font-bold text-[var(--color-text-muted)]">Date</th>
                <th className="text-left py-2 px-3 text-xs font-bold text-[var(--color-text-muted)]">Type</th>
                <th className="text-left py-2 px-3 text-xs font-bold text-[var(--color-text-muted)]">Reference</th>
                <th className="text-right py-2 px-3 text-xs font-bold text-[var(--color-text-muted)]">Qty</th>
              </tr>
            </thead>
            <tbody>
              {txs.length === 0 && (
                <tr><td colSpan={4} className="text-center py-8 text-[var(--color-text-muted)] text-sm">No transactions yet.</td></tr>
              )}
              {txs.map(t => (
                <tr key={t.id} className="border-b border-gray-50 dark:border-white/5">
                  <td className="py-2 px-3 text-[var(--color-text-muted)] text-xs">{format(new Date(t.date), 'dd MMM yyyy')}</td>
                  <td className={`py-2 px-3 text-xs font-semibold ${TYPE_COLORS[t.type] || ''}`}>
                    {TYPE_LABELS[t.type] || t.type}
                  </td>
                  <td className="py-2 px-3 text-[var(--color-text-muted)] text-xs max-w-[200px] truncate">{t.reference}</td>
                  <td className={`py-2 px-3 text-right font-bold tabular-nums text-xs ${t.sign > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {t.sign > 0 ? '+' : ''}{t.signedQty.toLocaleString()} {unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function FinishedStockPage() {
  const { finishedStockTransactions } = useStockStore();
  const { products } = useDataStore();
  const [search, setSearch] = useState('');
  const [adjustModal, setAdjustModal] = useState<AdjustModal | null>(null);
  const [historyModal, setHistoryModal] = useState<{ productId: string; productName: string; unit: string } | null>(null);

  const activeProducts = useMemo(() =>
    products.filter(p => p.status === 'active' && !p.deletedAt).sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );

  const filtered = useMemo(() =>
    activeProducts.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase())),
    [activeProducts, search]
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <PageHeader
        title="Finished Product Stock"
        description="Current stock balance for all products. Production adds stock; orders automatically subtract."
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full h-10 pl-10 pr-4 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40"
          placeholder="Search products..."
        />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/5">
                <th className="text-left py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Product</th>
                <th className="text-left py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Division</th>
                <th className="text-right py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Balance</th>
                <th className="text-center py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Status</th>
                <th className="text-right py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="text-center py-12 text-[var(--color-text-muted)] text-sm font-medium">No products found.</td></tr>
              )}
              {filtered.map(p => {
                const balance = getFinishedStockBalance(p.id, finishedStockTransactions);
                const unit = (p as any).unit || 'PCS';
                const division = getProductDivision(p);
                const isNegative = balance < 0;
                const isZero = balance === 0;
                return (
                  <tr key={p.id} className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4 font-semibold text-[var(--color-text-main)]">{p.name}</td>
                    <td className="py-3 px-4">
                      <Badge variant={division === 'bakery' ? 'purple' : 'info'}>{division}</Badge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className={`font-black tabular-nums text-base ${isNegative ? 'text-red-600 dark:text-red-400' : isZero ? 'text-amber-600' : 'text-[var(--color-text-main)]'}`}>
                        {balance.toLocaleString()}
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)] ml-1">{unit}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {isNegative
                        ? <Badge variant="danger"><AlertTriangle className="w-3 h-3 mr-1 inline" />Negative</Badge>
                        : isZero
                          ? <Badge variant="warning">Zero</Badge>
                          : <Badge variant="success">OK</Badge>}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setAdjustModal({ productId: p.id, productName: p.name, division, unit })}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 transition-colors"
                        >
                          Adjust
                        </button>
                        <button
                          onClick={() => setHistoryModal({ productId: p.id, productName: p.name, unit })}
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-[var(--color-text-muted)] transition-colors"
                          title="View History"
                        >
                          <History className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {adjustModal && <AdjustStockModal modal={adjustModal} onClose={() => setAdjustModal(null)} />}
      {historyModal && <ProductHistoryModal {...historyModal} onClose={() => setHistoryModal(null)} />}
    </div>
  );
}
