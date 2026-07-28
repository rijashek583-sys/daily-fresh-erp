import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronDown } from 'lucide-react';
import { useDataStore } from '../../stores/dataStore';
import { Button, Card, SearchInput, PageHeader, EmptyState } from '../../components/ui';
import { useDivisionStore } from '../../stores/divisionStore';
import { getProductDivision } from '../../lib/utils';
import { moveToTrash } from '../../services/db';
import { useAuthStore } from '../../stores/authStore';
import { Trash2, Edit2 } from 'lucide-react';
import { type FilterDivision } from '../../types';

/** Human-readable label for each division value */
const DIVISION_LABELS: Record<string, string> = {
  all: 'All',
  primary: 'Primary Foods',
  bakery: 'Bakery Foods',
};

export default function ProductsPage() {
  const { products } = useDataStore();
  const navigate = useNavigate();

  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  const { activeDivision: activeTab, setDivision } = useDivisionStore();

  /** Build the dynamic option list from all non-deleted products' divisions */
  const categoryOptions = useMemo<{ id: FilterDivision; label: string }[]>(() => {
    const divSet = new Set<string>();
    products
      .filter(p => !p.deletedAt)
      .forEach(p => divSet.add(getProductDivision(p)));

    const options: { id: FilterDivision; label: string }[] = [
      { id: 'all', label: 'All' },
    ];

    // Stable order: primary, bakery, then any future divisions alphabetically
    const ordered = [
      'primary',
      'bakery',
      ...Array.from(divSet).filter(d => d !== 'primary' && d !== 'bakery').sort(),
    ];

    ordered
      .filter(d => divSet.has(d))
      .forEach(d => {
        options.push({
          id: d as FilterDivision,
          label: DIVISION_LABELS[d] ?? d.charAt(0).toUpperCase() + d.slice(1),
        });
      });

    return options;
  }, [products]);

  const filtered = products
    .filter(p => !p.deletedAt && p.name.toLowerCase().includes(search.toLowerCase()))
    .filter(p => activeTab === 'all' || getProductDivision(p) === activeTab)
    .sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99));

  const handleDelete = async (e: React.MouseEvent, productId: string) => {
    e.stopPropagation();
    if (window.confirm('Move product to Trash?')) {
      const product = products.find(p => p.id === productId);
      if (product) {
        await moveToTrash('products', productId, product, user?.displayName || 'Admin');
      }
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Products"
        description={`Manage ${products.filter(p => p.status === 'active' && !p.deletedAt).length} active products in your catalog.`}
        actions={
          <Button size="md" icon={<Plus className="w-4 h-4" />} onClick={() => navigate('/products/new')}>
            Add Product
          </Button>
        }
      />

      <Card padding={false} className="overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col px-4 sm:px-8 py-4 sm:py-5 border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-black/10 gap-3">

          {/* ── Mobile-only category dropdown (hidden on md+) ── */}
          <div className="md:hidden">
            <label
              htmlFor="product-category-select"
              className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5"
            >
              Category
            </label>
            <div className="relative">
              <select
                id="product-category-select"
                value={activeTab}
                onChange={e => setDivision(e.target.value as FilterDivision)}
                className="
                  w-full appearance-none pl-4 pr-10 py-3
                  bg-white dark:bg-gray-900
                  border border-gray-200 dark:border-gray-700
                  rounded-2xl
                  text-sm font-semibold text-[var(--color-text-main)]
                  outline-none
                  focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20
                  transition-all duration-200
                  cursor-pointer
                  shadow-sm
                "
              >
                {categoryOptions.map(opt => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {/* Custom caret */}
              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* Search — always visible */}
          <SearchInput
            className="w-full"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onClear={() => setSearch('')}
            placeholder="Search products…"
          />
        </div>

        <div className="p-4 flex flex-col gap-2">
          {filtered.length === 0 ? (
            <div className="col-span-full">
              <EmptyState
                title="No products found"
                description="Try adjusting your search query or category filter."
              />
            </div>
          ) : filtered.map(p => (
            <div
              key={p.id}
              onClick={() => navigate(`/products/${p.id}/edit`)}
              className="group rounded-xl border border-gray-100 dark:border-gray-800 p-4 flex items-center hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-primary)]/[0.02] dark:hover:bg-[var(--color-primary)]/10 transition-all duration-200 cursor-pointer bg-white dark:bg-gray-900"
            >
              <div className="flex-1">
                <h3 className="text-base font-semibold text-[var(--color-text-main)] group-hover:text-[var(--color-primary)] transition-colors duration-200">
                  {p.name}
                </h3>
                <p className="text-sm font-medium text-[var(--color-text-muted)] mt-1">
                  Order: {p.displayOrder || '-'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={e => { e.stopPropagation(); navigate(`/products/${p.id}/edit`); }}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors"
                  title="Edit Product"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={e => handleDelete(e, p.id)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  title="Delete Product"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
