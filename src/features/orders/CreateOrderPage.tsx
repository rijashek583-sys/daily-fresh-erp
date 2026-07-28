import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Save, MapIcon, Users, Calendar, Package } from 'lucide-react';
import { toast } from 'sonner';
import { type Region, type Order } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { addOrder, updateOrder } from '../../services/db';
import { Button, Card, Badge } from '../../components/ui';
import { useDivisionStore } from '../../stores/divisionStore';
import { formatCurrency, cn, getProductDivision } from '../../lib/utils';
import { resolveProductPrice } from '../../lib/pricing';

export default function CreateOrderPage() {
  const { clients, orders, products, clientPricing, regions } = useDataStore();
  const { orderId } = useParams<{ orderId?: string }>();
  const navigate = useNavigate();
  const { activeDivision: activeTab } = useDivisionStore();

  const existingOrder = useMemo(() => orders.find(o => o.id === orderId), [orderId, orders]);
  const isEdit = !!existingOrder;

  const [deliveryDate, setDeliveryDate] = useState<string>(existingOrder?.deliveryDate || format(new Date(), 'yyyy-MM-dd'));
  const [selectedRegion, setSelectedRegion] = useState<Region | ''>(existingOrder ? (clients.find(c => c.id === existingOrder.clientId)?.region || '') : '');
  const [selectedClientId, setSelectedClientId] = useState<string>(existingOrder?.clientId || '');
  const [orderItems, setOrderItems] = useState<Record<string, number>>({});

  useEffect(() => {
    if (existingOrder) {
      const items: Record<string, number> = {};
      existingOrder.items.forEach(i => { items[i.productId] = i.qty; });
      setOrderItems(items);
    }
  }, [existingOrder]);

  const regionClients = useMemo(() => {
    if (!selectedRegion) return [];
    return clients.filter(c => c.region === selectedRegion && c.status === 'active' && !c.deletedAt);
  }, [selectedRegion, clients]);

  const selectedClient = useMemo(() => clients.find(c => c.id === selectedClientId), [selectedClientId, clients]);

  const divisionProducts = useMemo(() =>
    products.filter(p => p.status === 'active' && !p.deletedAt && (activeTab === 'all' || getProductDivision(p) === activeTab))
      .sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99)),
    [products, activeTab]
  );

  const getEffectivePrice = (productId: string) => {
    if (!selectedClient) return 0;
    const product = products.find(p => p.id === productId);
    if (!product) return 0;
    return resolveProductPrice(selectedClient.id, product.id);
  };

  const handleQuantityChange = (productId: string, qty: string) => {
    const val = parseInt(qty, 10);
    setOrderItems(prev => ({ ...prev, [productId]: isNaN(val) ? 0 : val }));
  };

  const totalAmount = useMemo(() => {
    return Object.entries(orderItems).reduce((sum, [pid, qty]) => {
      return qty > 0 ? sum + qty * getEffectivePrice(pid) : sum;
    }, 0);
  }, [orderItems, selectedClient, clientPricing, activeTab]);

  const totalItems = Object.values(orderItems).reduce((sum, qty) => sum + (qty || 0), 0);

  const handleSave = async () => {
    if (!selectedClient) { toast.error('Please select a client.'); return; }
    if (totalItems === 0) { toast.error('Please add at least one item to the order.'); return; }

    const newItems = divisionProducts
      .filter(p => (orderItems[p.id] || 0) > 0)
      .map(p => ({
        productId: p.id, productName: p.name,
        qty: orderItems[p.id] || 0,
        unitPrice: getEffectivePrice(p.id),
        total: (orderItems[p.id] || 0) * getEffectivePrice(p.id)
      }));

    try {
      const now = new Date().toISOString();
      if (existingOrder) {
        await updateOrder(existingOrder.id, {
          items: newItems, total: totalAmount, subtotal: totalAmount,
          deliveryDate, clientId: selectedClient.id, clientName: selectedClient.name,
          division: activeTab, updatedAt: now
        });
        toast.success('Order updated.');
      } else {
        const newOrder: Omit<Order, 'id'> = {
          clientId: selectedClient.id, clientName: selectedClient.name,
          items: newItems, subtotal: totalAmount, tax: 0, total: totalAmount,
          deliveryDate, division: activeTab, createdAt: now, updatedAt: now, updatedBy: 'admin'
        };
        await addOrder(newOrder);
        toast.success('Order saved successfully.');
      }
      navigate('/orders');
    } catch (error) { console.error(error); }
  };

  const divBadge = activeTab === 'primary'
    ? 'text-blue-600 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
    : 'text-amber-600 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800';

  return (
    <div className="max-w-4xl mx-auto pb-24">
      <div className="mb-6 flex items-center justify-between">
        <button onClick={() => navigate('/orders')} className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-[var(--color-primary)] transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Orders
        </button>
        {isEdit && <Badge variant="warning" dot>Editing Order {existingOrder.id}</Badge>}
      </div>

      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-main)] mb-1">{isEdit ? 'Edit Order' : 'Create New Order'}</h1>
          <p className="text-sm font-medium text-[var(--color-text-muted)]">Select delivery date, region, and client.</p>
        </div>
      </div>

      <Card className="mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-main)] mb-2">
              <Calendar className="w-4 h-4 text-gray-400" /> Delivery Date
            </label>
            <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
              className="w-full p-3 rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-sm font-bold text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-colors" />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-main)] mb-2">
              <MapIcon className="w-4 h-4 text-gray-400" /> Region
            </label>
            <select value={selectedRegion} onChange={e => { setSelectedRegion(e.target.value as Region); setSelectedClientId(''); }}
              className="w-full p-3 rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-sm font-bold text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-colors appearance-none cursor-pointer">
              <option value="">Select Region</option>
              {regions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-main)] mb-2">
              <Users className="w-4 h-4 text-gray-400" /> Client
            </label>
            <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)} disabled={!selectedRegion}
              className="w-full p-3 rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-sm font-bold text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-colors appearance-none cursor-pointer disabled:opacity-50">
              <option value="">Select Client</option>
              {regionClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </Card>

      {selectedClient ? (
        <Card padding={false} className="overflow-hidden relative animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="px-6 py-5 border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-black/10">
            <h2 className="text-base font-bold text-[var(--color-text-main)]">Products — {activeTab === 'all' ? 'All Divisions' : (activeTab === 'primary' ? 'Primary Foods' : 'Bakery Foods')}</h2>
            <p className="text-xs font-medium text-[var(--color-text-muted)] mt-1">Prices are locked to {selectedClient.name}'s custom pricing.</p>
          </div>
          {divisionProducts.length === 0 ? (
            <div className="p-12 text-center text-sm font-medium text-gray-500">No active products found for this tab.</div>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-gray-800/40">
              {divisionProducts.map(product => {
                const price = getEffectivePrice(product.id);
                const qty = orderItems[product.id] || 0;
                return (
                  <div key={product.id} className={`p-4 sm:px-6 sm:py-5 flex items-center justify-between transition-colors hover:bg-gray-50/50 dark:hover:bg-gray-800/20 ${qty > 0 ? 'bg-[var(--color-primary)]/[0.02] dark:bg-[var(--color-primary)]/[0.05]' : ''}`}>
                    <div className="flex items-center gap-4 flex-1">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${qty > 0 ? 'bg-[var(--color-primary)] text-white shadow-md shadow-red-500/20' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'}`}>
                        <Package className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-base font-semibold text-[var(--color-text-main)]">{product.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-sm font-semibold text-[var(--color-text-main)]">{formatCurrency(price)}</span>
                          {product.unit && <span className="text-xs font-medium text-[var(--color-text-muted)]">/{product.unit}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {qty > 0 && (
                        <div className="hidden sm:block text-right mr-4">
                          <p className="text-xs font-medium text-[var(--color-text-muted)] mb-0.5">Subtotal</p>
                          <p className="text-sm font-bold text-[var(--color-primary)]">{formatCurrency(price * qty)}</p>
                        </div>
                      )}
                      <input type="number" min="0" placeholder="0" value={orderItems[product.id] || ''}
                        onChange={e => handleQuantityChange(product.id, e.target.value)}
                        className="w-20 px-3 py-2 text-center text-base font-bold bg-[var(--color-input-bg)] border-2 border-transparent focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] rounded-xl outline-none transition-all" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="px-6 py-5 border-t border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-black/10 flex flex-col sm:flex-row items-center justify-between gap-4 sticky bottom-0">
            <div>
              <p className="text-sm font-semibold text-gray-500 mb-0.5">Order Total ({totalItems} items)</p>
              <p className="text-2xl font-bold text-[var(--color-text-main)]">{formatCurrency(totalAmount)}</p>
            </div>
            <Button size="lg" icon={<Save className="w-5 h-5" />} onClick={handleSave} className="w-full sm:w-auto shadow-lg shadow-red-500/20">
              {isEdit ? 'Update Order' : 'Save Order'}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="text-center py-20 bg-[var(--color-card)] rounded-3xl border border-dashed border-gray-200 dark:border-gray-800">
          <div className="w-16 h-16 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4 text-gray-400">
            <Users className="w-8 h-8" />
          </div>
          <p className="text-sm font-medium text-gray-500">Select a region and client to add products.</p>
        </div>
      )}
    </div>
  );
}
