import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useStockStore } from '../../stores/stockStore';
import { addRawMaterialStock, getRawMaterialBalance } from '../../services/stockDb';
import { Card, Button, Badge } from '../../components/ui';
import type { RawMaterialUnit } from '../../types/stock.types';

const TYPE_LABELS: Record<string, { label: string; variant: 'success' | 'danger' | 'info' | 'warning' | 'default' }> = {
  opening: { label: 'Opening', variant: 'info' },
  purchase: { label: 'Purchase', variant: 'success' },
  production_usage: { label: 'Production Used', variant: 'danger' },
  production_reversal: { label: 'Reversal', variant: 'warning' },
  adjustment: { label: 'Adjustment', variant: 'warning' },
};

function AddStockInline({ materialId, materialName, unit, onClose }: { materialId: string; materialName: string; unit: string; onClose: () => void }) {
  const [stockType, setStockType] = useState<'opening' | 'purchase' | 'adjustment'>('purchase');
  const [sign, setSign] = useState<1 | -1>(1);
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qtyNum = parseFloat(qty);
    if (!qtyNum || qtyNum <= 0) return toast.error('Enter a valid quantity');
    if (stockType === 'adjustment' && !notes.trim()) return toast.error('Reason is required for adjustments');
    setLoading(true);
    try {
      await addRawMaterialStock({ rawMaterialId: materialId, rawMaterialName: materialName, unit, type: stockType, sign: stockType === 'adjustment' ? sign : 1, qty: qtyNum, reference: stockType === 'purchase' ? 'Purchase' : stockType === 'opening' ? 'Opening Stock' : `Adjustment: ${notes.trim()}`, notes: notes || undefined, date });
      toast.success('Stock entry saved');
      setQty(''); setNotes('');
    } catch { toast.error('Failed to save'); }
    setLoading(false);
  };

  return (
    <div className="bg-[var(--color-bg)] rounded-2xl border border-gray-200 dark:border-white/10 p-5">
      <h3 className="text-sm font-bold text-[var(--color-text-main)] mb-4">Add Stock Entry</h3>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
        <div>
          <label className="text-xs font-semibold text-[var(--color-text-muted)] block mb-1">Type</label>
          <select value={stockType} onChange={e => setStockType(e.target.value as any)} className="w-full h-9 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none">
            <option value="purchase">Purchase</option>
            <option value="opening">Opening Stock</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </div>
        {stockType === 'adjustment' && (
          <div>
            <label className="text-xs font-semibold text-[var(--color-text-muted)] block mb-1">Direction</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSign(1)} className={`flex-1 h-9 rounded-xl border text-xs font-bold transition-colors ${sign === 1 ? 'bg-green-500 text-white border-green-500' : 'border-gray-200 dark:border-white/10 text-[var(--color-text-muted)]'}`}>+ Add</button>
              <button type="button" onClick={() => setSign(-1)} className={`flex-1 h-9 rounded-xl border text-xs font-bold transition-colors ${sign === -1 ? 'bg-red-500 text-white border-red-500' : 'border-gray-200 dark:border-white/10 text-[var(--color-text-muted)]'}`}>− Deduct</button>
            </div>
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-[var(--color-text-muted)] block mb-1">Qty ({unit})</label>
          <input type="number" min="0.01" step="0.01" value={qty} onChange={e => setQty(e.target.value)} className="w-full h-9 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none" placeholder="0.00" required />
        </div>
        <div>
          <label className="text-xs font-semibold text-[var(--color-text-muted)] block mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full h-9 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none" />
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <label className="text-xs font-semibold text-[var(--color-text-muted)] block mb-1">{stockType === 'adjustment' ? 'Reason (required)' : 'Notes (optional)'}</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full h-9 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none" placeholder={stockType === 'adjustment' ? 'Reason for adjustment...' : 'Optional'} required={stockType === 'adjustment'} />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" loading={loading} className="flex-1">Save</Button>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}

export default function RawMaterialStockPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { rawMaterials, rawMaterialTransactions } = useStockStore();
  const [showAddStock, setShowAddStock] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const material = rawMaterials.find(m => m.id === id);
  const allTx = useMemo(() =>
    rawMaterialTransactions
      .filter(t => t.rawMaterialId === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [rawMaterialTransactions, id]
  );

  const filteredTx = useMemo(() => allTx.filter(t => {
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo && t.date > dateTo) return false;
    return true;
  }), [allTx, dateFrom, dateTo]);

  const balance = useMemo(() => getRawMaterialBalance(id || '', rawMaterialTransactions), [rawMaterialTransactions, id]);

  if (!material) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-[var(--color-text-muted)] font-medium">Material not found.</p>
    </div>
  );

  let runningBalance = balance;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/stock/raw-materials')} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-[var(--color-text-muted)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[var(--color-text-main)]">{material.name}</h1>
          <p className="text-sm font-medium text-[var(--color-text-muted)]">Raw Material Stock History</p>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowAddStock(!showAddStock)}>
          Add Stock
        </Button>
      </div>

      {/* Balance card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-1 bg-[var(--color-card)] rounded-2xl p-6 border border-gray-100 dark:border-white/[0.05] flex flex-col items-center justify-center">
          <p className="text-sm font-semibold text-[var(--color-text-muted)] mb-1">Current Balance</p>
          <p className={`text-4xl font-black tabular-nums ${balance < 0 ? 'text-red-500' : balance === 0 ? 'text-amber-500' : 'text-[var(--color-text-main)]'}`}>
            {balance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
          </p>
          <p className="text-base font-semibold text-[var(--color-text-muted)] mt-1">{material.unit}</p>
        </div>
        <div className="sm:col-span-2 bg-[var(--color-card)] rounded-2xl p-6 border border-gray-100 dark:border-white/[0.05]">
          <p className="text-sm font-semibold text-[var(--color-text-muted)] mb-3">Quick Stats</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Total In</p>
              <p className="text-lg font-bold text-green-600 dark:text-green-400">
                +{allTx.filter(t => t.sign > 0).reduce((s, t) => s + t.qty, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} {material.unit}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Total Out</p>
              <p className="text-lg font-bold text-red-600 dark:text-red-400">
                -{allTx.filter(t => t.sign < 0).reduce((s, t) => s + t.qty, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} {material.unit}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Transactions</p>
              <p className="text-lg font-bold text-[var(--color-text-main)]">{allTx.length}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Status</p>
              <Badge variant={material.status === 'active' ? 'success' : 'gray'}>{material.status}</Badge>
            </div>
          </div>
        </div>
      </div>

      {showAddStock && (
        <AddStockInline materialId={material.id} materialName={material.name} unit={material.unit} onClose={() => setShowAddStock(false)} />
      )}

      {/* Date filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label className="text-xs font-semibold text-[var(--color-text-muted)] block mb-1">From Date</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full h-9 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none" />
        </div>
        <div className="flex-1">
          <label className="text-xs font-semibold text-[var(--color-text-muted)] block mb-1">To Date</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full h-9 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none" />
        </div>
        {(dateFrom || dateTo) && <Button variant="ghost" size="sm" className="sm:self-end" onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear</Button>}
      </div>

      {/* Transaction history */}
      <Card>
        <h2 className="text-sm font-bold text-[var(--color-text-main)] mb-4">Transaction History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/5">
                <th className="text-left py-2 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Date</th>
                <th className="text-left py-2 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Type</th>
                <th className="text-left py-2 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Reference</th>
                <th className="text-right py-2 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Qty</th>
                <th className="text-right py-2 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Balance</th>
              </tr>
            </thead>
            <tbody>
              {filteredTx.length === 0 && (
                <tr><td colSpan={5} className="text-center py-10 text-[var(--color-text-muted)] text-sm font-medium">No transactions found.</td></tr>
              )}
              {filteredTx.map((t, i) => {
                // Build running balance going backwards
                const rowBalance = i === 0 ? balance : undefined;
                const typeInfo = TYPE_LABELS[t.type] || { label: t.type, variant: 'default' as const };
                const signed = t.signedQty;
                return (
                  <tr key={t.id} className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                    <td className="py-3 px-4 text-[var(--color-text-muted)]">{format(new Date(t.date), 'dd MMM yyyy')}</td>
                    <td className="py-3 px-4"><Badge variant={typeInfo.variant as any}>{typeInfo.label}</Badge></td>
                    <td className="py-3 px-4 text-[var(--color-text-muted)] max-w-[200px] truncate">{t.reference}{t.notes && t.notes !== t.reference ? ` — ${t.notes}` : ''}</td>
                    <td className={`py-3 px-4 text-right font-bold tabular-nums ${signed > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {signed > 0 ? '+' : ''}{signed.toLocaleString(undefined, { maximumFractionDigits: 2 })} {t.unit}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-[var(--color-text-muted)] tabular-nums">—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
