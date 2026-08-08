import { useState, useMemo } from 'react';
import { Search, ChevronRight, Save, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useStockStore } from '../../stores/stockStore';
import { useDataStore } from '../../stores/dataStore';
import { saveProductMaterials } from '../../services/stockDb';
import { PageHeader, Card, Button, Badge } from '../../components/ui';
import type { ProductMaterialItem } from '../../types/stock.types';

function ProductMaterialEditor({
  product,
  existingMaterials,
  onClose,
}: {
  product: { id: string; name: string; division?: string };
  existingMaterials: ProductMaterialItem[];
  onClose: () => void;
}) {
  const { rawMaterials } = useStockStore();
  const [materials, setMaterials] = useState<ProductMaterialItem[]>(existingMaterials);
  const [saving, setSaving] = useState(false);

  const activeMaterials = rawMaterials.filter(m => m.status === 'active');
  const usedIds = new Set(materials.map(m => m.rawMaterialId));
  const availableMaterials = activeMaterials.filter(m => !usedIds.has(m.id));

  const addMaterial = (rawMaterialId: string) => {
    const rm = activeMaterials.find(m => m.id === rawMaterialId);
    if (!rm) return;
    setMaterials(prev => [...prev, { rawMaterialId: rm.id, rawMaterialName: rm.name, unit: rm.unit, defaultQty: null }]);
  };

  const removeMaterial = (rawMaterialId: string) => {
    setMaterials(prev => prev.filter(m => m.rawMaterialId !== rawMaterialId));
  };

  const updateDefaultQty = (rawMaterialId: string, qty: string) => {
    const val = qty ? parseFloat(qty) : null;
    setMaterials(prev => prev.map(m => m.rawMaterialId === rawMaterialId ? { ...m, defaultQty: val } : m));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveProductMaterials(product.id, product.name, materials);
      toast.success('Materials saved for ' + product.name);
      onClose();
    } catch { toast.error('Failed to save'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-[var(--color-card)] rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-main)]">{product.name}</h2>
            <p className="text-xs font-medium text-[var(--color-text-muted)]">Configure raw material composition</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-[var(--color-text-muted)] transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* Current materials */}
        <div className="space-y-2 mb-5">
          {materials.length === 0 && (
            <p className="text-sm text-center text-[var(--color-text-muted)] py-4 font-medium">No materials configured. Add materials below.</p>
          )}
          {materials.map(m => (
            <div key={m.rawMaterialId} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--color-bg)] border border-gray-100 dark:border-white/5">
              <div className="flex-1">
                <p className="text-sm font-semibold text-[var(--color-text-main)]">{m.rawMaterialName}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{m.unit}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="0.01" step="0.01"
                  value={m.defaultQty ?? ''}
                  onChange={e => updateDefaultQty(m.rawMaterialId, e.target.value)}
                  className="w-24 h-8 px-2 rounded-lg border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-xs focus:outline-none"
                  placeholder="Ref qty"
                  title="Optional reference quantity (not enforced)"
                />
                <span className="text-xs text-[var(--color-text-muted)]">{m.unit}</span>
                <button onClick={() => removeMaterial(m.rawMaterialId)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors"><X className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>

        {/* Add new material */}
        {availableMaterials.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Add Material</p>
            <div className="flex flex-wrap gap-2">
              {availableMaterials.map(rm => (
                <button key={rm.id} onClick={() => addMaterial(rm.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-[var(--color-text-muted)] hover:bg-[var(--color-primary)] hover:text-white transition-colors">
                  <Plus className="w-3 h-3" />
                  {rm.name} ({rm.unit})
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-[var(--color-text-muted)] mb-5">
          Reference quantities are optional and will pre-fill the production form. Actual quantities must always be entered manually during production.
        </p>

        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" icon={<Save className="w-4 h-4" />} loading={saving} onClick={handleSave}>Save Materials</Button>
        </div>
      </div>
    </div>
  );
}

export default function ProductMaterialsPage() {
  const { productMaterials } = useStockStore();
  const { products } = useDataStore();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ id: string; name: string; division?: string } | null>(null);

  const activeProducts = useMemo(() =>
    products.filter(p => p.status === 'active' && !p.deletedAt).sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );

  const filtered = useMemo(() =>
    activeProducts.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase())),
    [activeProducts, search]
  );

  const getMaterialCount = (productId: string) => {
    const pm = productMaterials.find(m => m.productId === productId);
    return pm?.materials.length || 0;
  };

  const getExistingMaterials = (productId: string): ProductMaterialItem[] => {
    return productMaterials.find(m => m.productId === productId)?.materials || [];
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <PageHeader
        title="Product Materials"
        description="Configure which raw materials are used to produce each finished product."
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
        <input value={search} onChange={e => setSearch(e.target.value)} className="w-full h-10 pl-10 pr-4 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40" placeholder="Search products..." />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/5">
                <th className="text-left py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Product</th>
                <th className="text-left py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Division</th>
                <th className="text-center py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Materials</th>
                <th className="text-right py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="text-center py-12 text-[var(--color-text-muted)] text-sm font-medium">No products found.</td></tr>
              )}
              {filtered.map(p => {
                const count = getMaterialCount(p.id);
                return (
                  <tr key={p.id} className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer" onClick={() => setSelected({ id: p.id, name: p.name, division: (p as any).division })}>
                    <td className="py-3 px-4 font-semibold text-[var(--color-text-main)]">{p.name}</td>
                    <td className="py-3 px-4">
                      <Badge variant={(p as any).division === 'bakery' ? 'purple' : 'info'}>{(p as any).division || 'primary'}</Badge>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {count > 0
                        ? <Badge variant="success">{count} material{count > 1 ? 's' : ''}</Badge>
                        : <Badge variant="warning">Not configured</Badge>}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] hover:underline">
                        Configure <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {selected && (
        <ProductMaterialEditor
          product={selected}
          existingMaterials={getExistingMaterials(selected.id)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
