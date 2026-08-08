import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Info } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useStockStore } from '../../stores/stockStore';
import { useDataStore } from '../../stores/dataStore';
import { getProductDivision } from '../../lib/utils';
import { addProduction, editProduction, getFinishedStockBalanceBeforeDate, getTodayOrderQty, getTodayProductionQty } from '../../services/stockDb';
import { Card, Button, Badge } from '../../components/ui';
import type { ProductionMaterialUsed, Production } from '../../types/stock.types';

interface MaterialRow {
  rawMaterialId: string;
  rawMaterialName: string;
  unit: string;
  usedQty: string; // string for controlled input
}

function PlanningPanel({ productId, date, actualQty }: { productId: string; date: string; actualQty: number }) {
  const { finishedStockTransactions, productions } = useStockStore();

  const physicalBalance = useMemo(() =>
    finishedStockTransactions.filter(t => t.productId === productId).reduce((s, t) => s + t.signedQty, 0),
    [finishedStockTransactions, productId]
  );

  const usableOpeningStock = useMemo(() =>
    getFinishedStockBalanceBeforeDate(productId, date, finishedStockTransactions),
    [finishedStockTransactions, productId, date]
  );

  const todayOrders = useMemo(() => getTodayOrderQty(productId, date), [productId, date]);
  const todayProduced = useMemo(() => getTodayProductionQty(productId, date, productions), [productions, productId, date]);
  const requiredProduction = Math.max(0, todayOrders - usableOpeningStock);
  const netResult = (todayProduced + actualQty) - requiredProduction;

  return (
    <div className="bg-blue-50 dark:bg-blue-900/10 rounded-2xl border border-blue-100 dark:border-blue-900/30 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        <h3 className="text-sm font-bold text-blue-800 dark:text-blue-300">Production Planning — {date ? format(new Date(date), 'dd MMM yyyy') : 'Today'}</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Physical Stock Balance</p>
          <p className="font-bold text-blue-900 dark:text-blue-200 tabular-nums">{physicalBalance.toLocaleString()} PCS</p>
        </div>
        <div>
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Usable Opening Stock</p>
          <p className="font-bold text-blue-900 dark:text-blue-200 tabular-nums">{usableOpeningStock.toLocaleString()} PCS</p>
        </div>
        <div>
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Today's Orders</p>
          <p className="font-bold text-blue-900 dark:text-blue-200 tabular-nums">{todayOrders.toLocaleString()} PCS</p>
        </div>
        <div>
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Required Production</p>
          <p className="font-bold text-blue-900 dark:text-blue-200 tabular-nums">{requiredProduction.toLocaleString()} PCS</p>
        </div>
        <div>
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Today Produced (so far)</p>
          <p className="font-bold text-blue-900 dark:text-blue-200 tabular-nums">{todayProduced.toLocaleString()} PCS</p>
        </div>
        {actualQty > 0 && (
          <div>
            <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Net Result</p>
            <p className={`font-bold tabular-nums ${netResult >= 0 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {netResult >= 0 ? `▲ Excess +${netResult.toLocaleString()}` : `▼ Shortage ${netResult.toLocaleString()}`} PCS
            </p>
          </div>
        )}
      </div>
      <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-3">This panel is informational only. Actual production can be any quantity.</p>
    </div>
  );
}

export default function AddProductionPage() {
  const navigate = useNavigate();
  const { id: productionId } = useParams<{ id: string }>();
  const isEdit = Boolean(productionId);

  const { productions, productMaterials } = useStockStore();
  const { products } = useDataStore();

  const existingProduction = isEdit ? productions.find(p => p.id === productionId) : null;

  const [productId, setProductId] = useState(existingProduction?.productId || '');
  const [date, setDate] = useState(existingProduction?.date || format(new Date(), 'yyyy-MM-dd'));
  const [producedQty, setProducedQty] = useState(existingProduction?.producedQty?.toString() || '');
  const [materials, setMaterials] = useState<MaterialRow[]>(
    existingProduction?.materialsUsed.map(m => ({ ...m, usedQty: m.usedQty.toString() })) || []
  );
  const [notes, setNotes] = useState(existingProduction?.notes || '');
  const [saving, setSaving] = useState(false);

  const activeProducts = useMemo(() => products.filter(p => p.status === 'active' && !p.deletedAt).sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const selectedProduct = activeProducts.find(p => p.id === productId);

  // Auto-populate materials when product changes
  useEffect(() => {
    if (!productId || isEdit) return;
    const pm = productMaterials.find(m => m.productId === productId);
    if (pm) {
      setMaterials(pm.materials.map(m => ({
        rawMaterialId: m.rawMaterialId,
        rawMaterialName: m.rawMaterialName,
        unit: m.unit,
        usedQty: m.defaultQty != null ? m.defaultQty.toString() : '',
      })));
    } else {
      setMaterials([]);
    }
  }, [productId, productMaterials]);

  const updateMaterialQty = (rawMaterialId: string, qty: string) => {
    setMaterials(prev => prev.map(m => m.rawMaterialId === rawMaterialId ? { ...m, usedQty: qty } : m));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) return toast.error('Please select a product');
    const producedQtyNum = parseFloat(producedQty);
    if (!producedQtyNum || producedQtyNum <= 0) return toast.error('Enter a valid produced quantity');

    const materialsUsed: ProductionMaterialUsed[] = materials
      .filter(m => m.usedQty && parseFloat(m.usedQty) > 0)
      .map(m => ({ rawMaterialId: m.rawMaterialId, rawMaterialName: m.rawMaterialName, unit: m.unit, usedQty: parseFloat(m.usedQty) }));

    const division = selectedProduct ? getProductDivision(selectedProduct) : 'primary';
    const producedUnit = (selectedProduct as any)?.unit || 'PCS';

    setSaving(true);
    try {
      if (isEdit && existingProduction) {
        await editProduction(existingProduction.id, existingProduction, { date, producedQty: producedQtyNum, materialsUsed, notes: notes.trim() || null });
        toast.success('Production updated');
      } else {
        await addProduction({ date, productId, productName: selectedProduct?.name || '', division, producedQty: producedQtyNum, producedUnit, materialsUsed, notes: notes.trim() || null });
        toast.success('Production saved');
      }
      navigate('/stock/production');
    } catch (err) { toast.error('Failed to save production entry'); }
    setSaving(false);
  };

  const producedQtyNum = parseFloat(producedQty) || 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/stock/production')} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-[var(--color-text-muted)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-[var(--color-text-main)]">{isEdit ? 'Edit Production Entry' : 'Add Production Entry'}</h1>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <h2 className="text-sm font-bold text-[var(--color-text-main)] mb-5">Production Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Product *</label>
              <select value={productId} onChange={e => setProductId(e.target.value)} disabled={isEdit} className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:opacity-60" required>
                <option value="">Select product...</option>
                {activeProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {selectedProduct && (
                <div className="mt-1.5 flex gap-2">
                  <Badge variant={(selectedProduct as any).division === 'bakery' ? 'purple' : 'info'}>{(selectedProduct as any).division || 'primary'}</Badge>
                  {(selectedProduct as any).unit && <Badge variant="gray">{(selectedProduct as any).unit}</Badge>}
                </div>
              )}
            </div>

            <div>
              <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Production Date *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40" required />
            </div>

            <div className="sm:col-span-2">
              <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Actual Production Quantity *</label>
              <div className="flex items-center gap-3">
                <input type="number" min="1" step="1" value={producedQty} onChange={e => setProducedQty(e.target.value)} className="w-48 h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40" placeholder="0" required />
                <span className="text-sm font-semibold text-[var(--color-text-muted)]">{(selectedProduct as any)?.unit || 'PCS'}</span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Enter the actual quantity produced — do not use theoretical calculations.</p>
            </div>

            <div className="sm:col-span-2">
              <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Notes (optional)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40" placeholder="e.g. Morning batch, batch ID..." />
            </div>
          </div>
        </Card>

        {/* Production planning panel */}
        {productId && date && <PlanningPanel productId={productId} date={date} actualQty={producedQtyNum} />}

        {/* Raw materials used */}
        <Card>
          <h2 className="text-sm font-bold text-[var(--color-text-main)] mb-1">Raw Materials Used</h2>
          <p className="text-xs font-medium text-[var(--color-text-muted)] mb-5">
            {isEdit ? 'Edit actual quantities used for this batch.' : 'Materials are pre-populated from the product configuration. Edit actual quantities used.'}
          </p>

          {materials.length === 0 && !productId && (
            <p className="text-sm text-center text-[var(--color-text-muted)] py-6">Select a product to load its materials.</p>
          )}
          {materials.length === 0 && productId && (
            <p className="text-sm text-center text-[var(--color-text-muted)] py-6">
              No materials configured for this product.
              <button type="button" onClick={() => navigate('/stock/product-materials')} className="ml-1 text-[var(--color-primary)] hover:underline">Configure materials →</button>
            </p>
          )}

          {materials.length > 0 && (
            <div className="space-y-3">
              {materials.map(m => (
                <div key={m.rawMaterialId} className="flex items-center gap-4 p-3 rounded-xl bg-[var(--color-bg)] border border-gray-100 dark:border-white/5">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[var(--color-text-main)]">{m.rawMaterialName}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{m.unit}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="0" step="0.01"
                      value={m.usedQty}
                      onChange={e => updateMaterialQty(m.rawMaterialId, e.target.value)}
                      className="w-28 h-9 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40"
                      placeholder="0.00"
                    />
                    <span className="text-xs font-semibold text-[var(--color-text-muted)] w-8">{m.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => navigate('/stock/production')}>Cancel</Button>
          <Button type="submit" className="flex-1" icon={<Save className="w-4 h-4" />} loading={saving}>
            {isEdit ? 'Save Changes' : 'Save Production'}
          </Button>
        </div>
      </form>
    </div>
  );
}
