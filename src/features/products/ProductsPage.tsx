import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useDataStore } from '../../stores/dataStore';
import { Button, Card, SearchInput, PageHeader, EmptyState } from '../../components/ui';
import { toast } from 'sonner';
import { moveToTrash } from '../../services/db';
import { useAuthStore } from '../../stores/authStore';
import { Trash2, Edit2 } from 'lucide-react';

export default function ProductsPage() {
  const { products } = useDataStore();
  const navigate = useNavigate();

  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  
  const filtered = products
    .filter(p => !p.deletedAt && p.name.toLowerCase().includes(search.toLowerCase()))
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
        <div className="flex px-8 py-5 border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-black/10">
          <SearchInput className="w-full max-w-md" value={search} onChange={e => setSearch(e.target.value)} onClear={() => setSearch('')} placeholder="Search products…" />
        </div>

        <div className="p-4 flex flex-col gap-2">
          {filtered.length === 0 ? (
            <div className="col-span-full">
              <EmptyState title="No products found" description="Try adjusting your search query." />
            </div>
          ) : filtered.map(p => (
            <div 
              key={p.id} 
              onClick={() => navigate(`/products/${p.id}/edit`)}
              className="group rounded-xl border border-gray-100 dark:border-gray-800 p-4 flex items-center hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-primary)]/[0.02] dark:hover:bg-[var(--color-primary)]/10 transition-all duration-200 cursor-pointer bg-white dark:bg-gray-900"
            >
              <div className="flex-1">
                <h3 className="text-base font-semibold text-[var(--color-text-main)] group-hover:text-[var(--color-primary)] transition-colors duration-200">{p.name}</h3>
                <p className="text-sm font-medium text-[var(--color-text-muted)] mt-1">Order: {p.displayOrder || '-'}</p>
              </div>
              <div className="flex items-center gap-1">
                <button 
                  onClick={(e) => { e.stopPropagation(); navigate(`/products/${p.id}/edit`); }}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors" 
                  title="Edit Product"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={(e) => handleDelete(e, p.id)}
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
