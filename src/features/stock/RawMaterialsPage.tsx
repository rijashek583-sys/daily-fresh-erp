import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Edit2, History, AlertTriangle, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { useStockStore } from '../../stores/stockStore';
import { addRawMaterial, updateRawMaterial, addRawMaterialStock, getRawMaterialBalance } from '../../services/stockDb';
import { PageHeader, Card, Button, Badge } from '../../components/ui';
import type { RawMaterial, RawMaterialUnit } from '../../types/stock.types';

const UNITS: RawMaterialUnit[] = ['KG', 'Gram', 'Litre', 'Piece', 'Box'];

interface MaterialModal { mode: 'add' | 'edit'; material?: RawMaterial; }
interface StockModal { material: RawMaterial; stockType: 'opening' | 'purchase' | 'adjustment'; }

function MaterialForm({ modal, onClose }: { modal: MaterialModal; onClose: () => void }) {
  const [name, setName] = useState(modal.material?.name || '');
  const [unit, setUnit] = useState<RawMaterialUnit>(modal.material?.unit || 'KG');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('Name is required');
    setLoading(true);
    try {
      if (modal.mode === 'add') {
        await addRawMaterial({ name: name.trim(), unit, status: 'active' });
        toast.success('Raw material added');
      } else if (modal.material) {
        await updateRawMaterial(modal.material.id, { name: name.trim(), unit });
        toast.success('Raw material updated');
      }
      onClose();
    } catch (err) { toast.error('Failed to save'); }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-[var(--color-card)] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h2 className="text-lg font-bold text-[var(--color-text-main)] mb-5">{modal.mode === 'add' ? 'Add Raw Material' : 'Edit Raw Material'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Material Name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40" placeholder="e.g. Maida" required />
          </div>
          <div>
            <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Unit</label>
            <select value={unit} onChange={e => setUnit(e.target.value as RawMaterialUnit)} className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40">
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
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

function AddStockModal({ modal, onClose }: { modal: StockModal; onClose: () => void }) {
  const [qty, setQty] = useState('');
  const [sign, setSign] = useState<1 | -1>(1);
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
  const [loading, setLoading] = useState(false);
  const isAdjustment = modal.stockType === 'adjustment';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qtyNum = parseFloat(qty);
    if (!qtyNum || qtyNum <= 0) return toast.error('Enter a valid quantity');
    if (isAdjustment && !notes.trim()) return toast.error('Reason is required for adjustments');
    setLoading(true);
    try {
      await addRawMaterialStock({
        rawMaterialId: modal.material.id,
        rawMaterialName: modal.material.name,
        unit: modal.material.unit,
        type: modal.stockType,
        sign: isAdjustment ? sign : 1,
        qty: qtyNum,
        reference: modal.stockType === 'opening' ? 'Opening Stock' : modal.stockType === 'purchase' ? 'Purchase' : `Adjustment: ${notes.trim()}`,
        notes: notes || undefined,
        date,
      });
      toast.success(modal.stockType === 'opening' ? 'Opening stock added' : modal.stockType === 'purchase' ? 'Stock added' : 'Adjustment saved');
      onClose();
    } catch { toast.error('Failed to save stock entry'); }
    setLoading(false);
  };

  const title = modal.stockType === 'opening' ? 'Add Opening Stock' : modal.stockType === 'purchase' ? 'Add Purchase Stock' : 'Stock Adjustment';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-[var(--color-card)] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h2 className="text-lg font-bold text-[var(--color-text-main)] mb-1">{title}</h2>
        <p className="text-sm font-medium text-[var(--color-text-muted)] mb-5">{modal.material.name} · {modal.material.unit}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40" />
          </div>
          {isAdjustment && (
            <div>
              <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Direction</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSign(1)} className={`flex-1 py-2 rounded-xl border text-sm font-semibold transition-colors ${sign === 1 ? 'bg-green-500 text-white border-green-500' : 'border-gray-200 dark:border-white/10 text-[var(--color-text-muted)]'}`}>
                  + Add
                </button>
                <button type="button" onClick={() => setSign(-1)} className={`flex-1 py-2 rounded-xl border text-sm font-semibold transition-colors ${sign === -1 ? 'bg-red-500 text-white border-red-500' : 'border-gray-200 dark:border-white/10 text-[var(--color-text-muted)]'}`}>
                  − Deduct
                </button>
              </div>
            </div>
          )}
          <div>
            <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Quantity ({modal.material.unit})</label>
            <input type="number" min="0.01" step="0.01" value={qty} onChange={e => setQty(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40" placeholder="0.00" required />
          </div>
          <div>
            <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">{isAdjustment ? 'Reason (required)' : 'Notes (optional)'}</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40" placeholder={isAdjustment ? 'e.g. Physical count difference' : 'Optional notes'} required={isAdjustment} />
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

export default function RawMaterialsPage() {
  const navigate = useNavigate();
  const { rawMaterials, rawMaterialTransactions } = useStockStore();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [materialModal, setMaterialModal] = useState<MaterialModal | null>(null);
  const [stockModal, setStockModal] = useState<StockModal | null>(null);
  const [deactivating, setDeactivating] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return rawMaterials.filter(m => {
      if (!showInactive && m.status === 'inactive') return false;
      if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [rawMaterials, search, showInactive]);

  const handleDeactivate = async (m: RawMaterial) => {
    if (deactivating) return;
    const newStatus = m.status === 'active' ? 'inactive' : 'active';
    setDeactivating(m.id);
    try {
      await updateRawMaterial(m.id, { status: newStatus });
      toast.success(newStatus === 'inactive' ? `${m.name} deactivated` : `${m.name} reactivated`);
    } catch { toast.error('Failed to update status'); }
    setDeactivating(null);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <PageHeader
        title="Raw Material Stock"
        description="Manage raw materials and their stock balances."
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={() => setMaterialModal({ mode: 'add' })}>Add Material</Button>}
      />

      {/* Search & filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="w-full h-10 pl-10 pr-4 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40" placeholder="Search materials..." />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-muted)] cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
          Show inactive
        </label>
      </div>

      {/* Materials table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/5">
                <th className="text-left py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Material</th>
                <th className="text-left py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Unit</th>
                <th className="text-right py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Balance</th>
                <th className="text-center py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Status</th>
                <th className="text-right py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="text-center py-12 text-[var(--color-text-muted)] text-sm font-medium">No raw materials found.</td></tr>
              )}
              {filtered.map(m => {
                const balance = getRawMaterialBalance(m.id, rawMaterialTransactions);
                const isLow = balance <= 0;
                return (
                  <tr key={m.id} className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4 font-semibold text-[var(--color-text-main)]">{m.name}</td>
                    <td className="py-3 px-4 text-[var(--color-text-muted)]">{m.unit}</td>
                    <td className="py-3 px-4 text-right">
                      <span className={`font-bold tabular-nums ${isLow ? 'text-red-600 dark:text-red-400' : 'text-[var(--color-text-main)]'}`}>
                        {balance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} {m.unit}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={m.status === 'active' ? 'success' : 'gray'}>{m.status}</Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        {m.status === 'active' && (
                          <>
                            <button onClick={() => setStockModal({ material: m, stockType: 'opening' })} className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 text-[var(--color-text-muted)] hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" title="Opening Stock">Opening</button>
                            <button onClick={() => setStockModal({ material: m, stockType: 'purchase' })} className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 transition-colors" title="Add Stock"><TrendingUp className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setStockModal({ material: m, stockType: 'adjustment' })} className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 transition-colors" title="Adjust"><TrendingDown className="w-3.5 h-3.5" /></button>
                          </>
                        )}
                        <button onClick={() => setMaterialModal({ mode: 'edit', material: m })} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-[var(--color-text-muted)] transition-colors"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => navigate(`/stock/raw-materials/${m.id}/history`)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-[var(--color-text-muted)] transition-colors"><History className="w-4 h-4" /></button>
                        <button onClick={() => handleDeactivate(m)} disabled={deactivating === m.id} className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${m.status === 'active' ? 'bg-red-50 dark:bg-red-900/20 text-red-600 hover:bg-red-100' : 'bg-green-50 dark:bg-green-900/20 text-green-600 hover:bg-green-100'}`}>
                          {m.status === 'active' ? 'Deactivate' : 'Reactivate'}
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

      {materialModal && <MaterialForm modal={materialModal} onClose={() => setMaterialModal(null)} />}
      {stockModal && <AddStockModal modal={stockModal} onClose={() => setStockModal(null)} />}
    </div>
  );
}
