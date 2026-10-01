import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useStockStore } from '../../stores/stockStore';
import { useDataStore } from '../../stores/dataStore';
import { getProductDivision } from '../../lib/utils';
import { addProduction, editProduction } from '../../services/stockDb';
import { Card, Button, Badge } from '../../components/ui';

export default function AddProductionPage() {
  const navigate = useNavigate();
  const { id: productionId } = useParams<{ id: string }>();
  const isEdit = Boolean(productionId);

  const { productions } = useStockStore();
  const { products } = useDataStore();

  const existingProduction = isEdit ? productions.find(p => p.id === productionId) : null;

  const [productId, setProductId] = useState(existingProduction?.productId || '');
  const [date, setDate] = useState(existingProduction?.date || format(new Date(), 'yyyy-MM-dd'));
  const [producedQty, setProducedQty] = useState(existingProduction?.producedQty?.toString() || '');
  const [notes, setNotes] = useState(existingProduction?.notes || '');
  const [saving, setSaving] = useState(false);

  const activeProducts = useMemo(() =>
    products.filter(p => p.status === 'active' && !p.deletedAt).sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );
  const selectedProduct = activeProducts.find(p => p.id === productId);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) return toast.error('Please select a product');
    const producedQtyNum = parseFloat(producedQty);
    if (!producedQtyNum || producedQtyNum <= 0) return toast.error('Enter a valid produced quantity');

    const division = selectedProduct ? getProductDivision(selectedProduct) : 'primary';
    const producedUnit = (selectedProduct as any)?.unit || 'PCS';

    setSaving(true);
    try {
      if (isEdit && existingProduction) {
        await editProduction(existingProduction.id, existingProduction, {
          date,
          producedQty: producedQtyNum,
          materialsUsed: existingProduction.materialsUsed, // preserve existing materials if any
          notes: notes.trim() || null,
        });
        toast.success('Production updated');
      } else {
        await addProduction({
          date,
          productId,
          productName: selectedProduct?.name || '',
          division,
          producedQty: producedQtyNum,
          producedUnit,
          materialsUsed: [], // no recipe/material tracking
          notes: notes.trim() || null,
        });
        toast.success('Production saved');
      }
      navigate('/stock/production');
    } catch { toast.error('Failed to save production entry'); }
    setSaving(false);
  };

  return (
    <div className="max-w-lg mx-auto space-y-6 pb-12">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/stock/production')}
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-[var(--color-text-muted)] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-[var(--color-text-main)]">
          {isEdit ? 'Edit Production Entry' : 'Add Production Entry'}
        </h1>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        <Card>
          <h2 className="text-sm font-bold text-[var(--color-text-main)] mb-5">Production Details</h2>
          <div className="space-y-4">
            {/* Product */}
            <div>
              <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Product *</label>
              <select
                value={productId}
                onChange={e => setProductId(e.target.value)}
                disabled={isEdit}
                className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:opacity-60"
                required
              >
                <option value="">Select product...</option>
                {activeProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {selectedProduct && (
                <div className="mt-1.5 flex gap-2">
                  <Badge variant={(selectedProduct as any).division === 'bakery' ? 'purple' : 'info'}>
                    {(selectedProduct as any).division || 'primary'}
                  </Badge>
                  {(selectedProduct as any).unit && (
                    <Badge variant="gray">{(selectedProduct as any).unit}</Badge>
                  )}
                </div>
              )}
            </div>

            {/* Date */}
            <div>
              <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Production Date *</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40"
                required
              />
            </div>

            {/* Produced Quantity */}
            <div>
              <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">
                Quantity Produced *
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={producedQty}
                  onChange={e => setProducedQty(e.target.value)}
                  className="w-48 h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40"
                  placeholder="0"
                  required
                />
                <span className="text-sm font-semibold text-[var(--color-text-muted)]">
                  {(selectedProduct as any)?.unit || 'PCS'}
                </span>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-sm font-semibold text-[var(--color-text-muted)] block mb-1.5">Notes (optional)</label>
              <input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-bg)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40"
                placeholder="e.g. Morning batch"
              />
            </div>
          </div>
        </Card>

        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => navigate('/stock/production')}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" icon={<Save className="w-4 h-4" />} loading={saving}>
            {isEdit ? 'Save Changes' : 'Save Production'}
          </Button>
        </div>
      </form>
    </div>
  );
}
