import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Package } from 'lucide-react';
import { toast } from 'sonner';
import { useDataStore } from '../../stores/dataStore';
import { addProduct, updateProduct } from '../../services/db';
import { Button, Card, PageHeader } from '../../components/ui';

export default function ProductFormPage() {
  const { products } = useDataStore();
  const { productId } = useParams<{ productId?: string }>();
  const navigate = useNavigate();
  const isEdit = !!productId;

  const existingProduct = useMemo(() => products.find(p => p.id === productId), [productId, products]);

  const [formData, setFormData] = useState({
    name: '',
    status: 'active' as 'active' | 'inactive',
    displayOrder: '',
    division: '' as import('../../types').Division | ''
  });

  useEffect(() => {
    if (existingProduct) {
      setFormData({
        name: existingProduct.name || '',
        status: existingProduct.status || 'active',
        displayOrder: existingProduct.displayOrder?.toString() || '',
        division: existingProduct.division || ''
      });
    }
  }, [existingProduct]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      toast.error('Name is required.');
      return;
    }
    if (!formData.displayOrder || isNaN(parseInt(formData.displayOrder, 10))) {
      toast.error('Valid display order is required.');
      return;
    }
    if (!formData.division) {
      toast.error('Division is required.');
      return;
    }

    const payload = {
      name: formData.name,
      status: formData.status,
      displayOrder: parseInt(formData.displayOrder, 10),
      division: formData.division
    };

    try {
      if (isEdit && productId) {
        await updateProduct(productId, payload);
        toast.success('Product updated successfully.');
      } else {
        await addProduct(payload);
        toast.success('Product created successfully.');
      }
      navigate('/products');
    } catch (error) {
      // Error handled in db.ts
    }
  };

  return (
    <div className="max-w-3xl mx-auto pb-24">
      <div className="mb-6">
        <button 
          onClick={() => navigate('/products')}
          className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-[var(--color-primary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Products
        </button>
      </div>

      <PageHeader
        title={isEdit ? 'Edit Product' : 'Add New Product'}
        description="Fill in the product details below."
      />

      <form onSubmit={handleSubmit}>
        <Card className="mb-6">
          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100 dark:border-white/[0.05]">
            <div className="w-12 h-12 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)]">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--color-text-main)]">Product Details</h2>
              <p className="text-sm font-medium text-[var(--color-text-muted)]">Basic information and pricing.</p>
            </div>
          </div>

          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-2">Product Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Kuboos"
                  className="w-full px-4 py-3 rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-sm font-medium text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-2">Display Order (1-12) <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  required
                  min="1"
                  max="12"
                  value={formData.displayOrder}
                  onChange={e => setFormData({ ...formData, displayOrder: e.target.value })}
                  placeholder="e.g. 1"
                  className="w-full px-4 py-3 rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-sm font-medium text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-colors"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-2">Status</label>
                <select
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
                  className="w-full px-4 py-3 rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-sm font-medium text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-colors appearance-none"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-2">Division <span className="text-red-500">*</span></label>
                <select
                  required
                  value={formData.division}
                  onChange={e => setFormData({ ...formData, division: e.target.value as import('../../types').Division })}
                  className="w-full px-4 py-3 rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-sm font-medium text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-colors appearance-none"
                >
                  <option value="" disabled>Select Division</option>
                  <option value="primary">Primary Foods</option>
                  <option value="bakery">Bakery Foods</option>
                </select>
              </div>
            </div>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" size="lg" icon={<Save className="w-5 h-5" />} className="shadow-lg">
            {isEdit ? 'Update Product' : 'Save Product'}
          </Button>
        </div>
      </form>
    </div>
  );
}
