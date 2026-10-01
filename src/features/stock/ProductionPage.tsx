import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, Calendar, Factory } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useStockStore } from '../../stores/stockStore';
import { useDataStore } from '../../stores/dataStore';
import { useAuthStore } from '../../stores/authStore';
import { deleteProduction } from '../../services/stockDb';
import { PageHeader, Card, Button, Badge } from '../../components/ui';
import type { Production } from '../../types/stock.types';

export default function ProductionPage() {
  const navigate = useNavigate();
  const { productions } = useStockStore();
  const { products } = useDataStore();
  const { user } = useAuthStore();
  const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [productFilter, setProductFilter] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Production | null>(null);
  const [deleting, setDeleting] = useState(false);

  const activeProductions = useMemo(() =>
    productions.filter(p => p.status === 'active').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [productions]
  );

  const filtered = useMemo(() => {
    return activeProductions.filter(p => {
      if (dateFilter && p.date !== dateFilter) return false;
      if (productFilter && p.productId !== productFilter) return false;
      return true;
    });
  }, [activeProductions, dateFilter, productFilter]);

  // Daily totals per product
  const dailyTotals = useMemo(() => {
    const totals = new Map<string, { productName: string; qty: number; unit: string }>();
    for (const p of filtered) {
      const existing = totals.get(p.productId);
      if (existing) { existing.qty += p.producedQty; }
      else { totals.set(p.productId, { productName: p.productName, qty: p.producedQty, unit: p.producedUnit }); }
    }
    return totals;
  }, [filtered]);

  const handleDelete = async () => {
    if (!confirmDelete || !user) return;
    setDeleting(true);
    try {
      await deleteProduction(confirmDelete, user.uid);
      toast.success('Production entry deleted');
      setConfirmDelete(null);
    } catch { toast.error('Failed to delete production entry'); }
    setDeleting(false);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <PageHeader
        title="Daily Production"
        description="Record how many units of each product were produced."
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={() => navigate('/stock/production/new')}>Add Production</Button>}
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
          <input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="h-9 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none"
          />
        </div>
        <select
          value={productFilter}
          onChange={e => setProductFilter(e.target.value)}
          className="h-9 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none"
        >
          <option value="">All Products</option>
          {products.filter(p => p.status === 'active').map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {(dateFilter !== format(new Date(), 'yyyy-MM-dd') || productFilter) && (
          <Button variant="ghost" size="sm" onClick={() => { setDateFilter(format(new Date(), 'yyyy-MM-dd')); setProductFilter(''); }}>
            Clear Filters
          </Button>
        )}
      </div>

      {/* Daily totals summary */}
      {dailyTotals.size > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from(dailyTotals.entries()).map(([productId, { productName, qty, unit }]) => (
            <div key={productId} className="bg-[var(--color-card)] rounded-2xl p-4 border border-gray-100 dark:border-white/[0.05]">
              <p className="text-xs font-semibold text-[var(--color-text-muted)] truncate">{productName}</p>
              <p className="text-2xl font-black text-[var(--color-text-main)] tabular-nums mt-1">{qty.toLocaleString()}</p>
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Daily Total · {unit}</p>
            </div>
          ))}
        </div>
      )}

      {/* Production list */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/5">
                <th className="text-left py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Date</th>
                <th className="text-left py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Product</th>
                <th className="text-left py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Division</th>
                <th className="text-right py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Produced</th>
                <th className="text-left py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Notes</th>
                <th className="text-right py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-[var(--color-text-muted)] text-sm font-medium">
                    <Factory className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No production entries for {dateFilter ? format(new Date(dateFilter), 'dd MMM yyyy') : 'selected period'}.
                  </td>
                </tr>
              )}
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-4 text-[var(--color-text-muted)]">{format(new Date(p.date), 'dd MMM yyyy')}</td>
                  <td className="py-3 px-4 font-semibold text-[var(--color-text-main)]">{p.productName}</td>
                  <td className="py-3 px-4">
                    <Badge variant={p.division === 'bakery' ? 'purple' : 'info'}>{p.division}</Badge>
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-green-600 dark:text-green-400 tabular-nums">
                    +{p.producedQty.toLocaleString()} {p.producedUnit}
                  </td>
                  <td className="py-3 px-4 text-[var(--color-text-muted)] text-xs max-w-[150px] truncate">{p.notes || '—'}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => navigate(`/stock/production/${p.id}/edit`)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-[var(--color-text-muted)] transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(p)}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-[var(--color-card)] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold text-[var(--color-text-main)] mb-2">Delete Production Entry?</h3>
            <p className="text-sm font-medium text-[var(--color-text-muted)] mb-1">
              <strong>{confirmDelete.productName}</strong> — {format(new Date(confirmDelete.date), 'dd MMM yyyy')}
            </p>
            <p className="text-sm font-medium text-[var(--color-text-muted)] mb-4">
              Produced: {confirmDelete.producedQty.toLocaleString()} {confirmDelete.producedUnit}
            </p>
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl mb-5">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                This will reverse the finished stock addition for this entry. The entry can be restored from Trash.
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="danger" className="flex-1" loading={deleting} onClick={handleDelete}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
