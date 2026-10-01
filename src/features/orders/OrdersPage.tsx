import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileText, Edit2, Trash2, Search, Calendar, MapIcon, Users, Grid } from 'lucide-react';
import { format } from 'date-fns';
import { type Order, type Region } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { Button, Card, DataTable, PageHeader, type Column, Badge, SearchInput } from '../../components/ui';
import { useDivisionStore } from '../../stores/divisionStore';
import { toast } from 'sonner';
import { moveToTrash } from '../../services/db';
import { useAuthStore } from '../../stores/authStore';
import { formatCurrency, cn, getProductDivision } from '../../lib/utils';
import { resolveProductPrice } from '../../lib/pricing';
export default function OrdersPage() {
  const { clients, orders, regions, products } = useDataStore();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  
  // Filters
  const [filterDate, setFilterDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [filterRegion, setFilterRegion] = useState<Region | ''>('');
  const [filterClientId, setFilterClientId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [confirmDeleteOrderId, setConfirmDeleteOrderId] = useState<string | null>(null);
  const { activeDivision: activeTab } = useDivisionStore();
  const activeRegions = useMemo(() => regions, [regions]);
  const activeClients = useMemo(() => clients.filter(c => !c.deletedAt && (filterRegion ? c.region === filterRegion : true)), [filterRegion, clients]);

  const getClientRegion = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    return client?.region || '-';
  };

  const confirmDelete = async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (order) {
      // Pass order.id explicitly since moveToTrash now uses originalDocumentId internally
      await moveToTrash('orders', orderId, order, user?.displayName || 'Admin');
      setConfirmDeleteOrderId(null);
    }
  };

  const columns: Column<Order>[] = [
    {
      key: 'client', label: 'Client',
      render: r => <span className="text-sm font-semibold text-[var(--color-text-main)]">{r.clientName}</span>,
    },
    {
      key: 'region', label: 'Region',
      render: r => <Badge variant="gray">{getClientRegion(r.clientId)}</Badge>,
    },
    {
      key: 'deliveryDate', label: 'Delivery Date',
      render: r => <span className="text-sm font-medium text-[var(--color-text-muted)]">{format(new Date(r.deliveryDate), 'MMM d, yyyy')}</span>,
    },
    {
      key: 'products', label: 'Products',
      render: r => (
        <div className="flex flex-col gap-1">
          {r.items.map(item => (
            <span key={item.productId} className="text-xs text-[var(--color-text-muted)] font-medium">
              {item.productName} × <strong className="text-[var(--color-text-main)]">{item.qty}</strong>
            </span>
          ))}
        </div>
      )
    },
    {
      key: 'total', label: 'Total', align: 'right',
      render: r => <span className="text-sm font-bold text-[var(--color-text-main)]">{formatCurrency(r.total)}</span>,
    },


    {
      key: 'actions', label: '', align: 'right',
      render: r => (
        <div className="flex items-center justify-end gap-3">
          {user?.role === 'admin' && (
            <>
              <button 
                onClick={() => navigate(`/orders/${r.id}/edit`)} 
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors border border-transparent shadow-sm"
              >
                <Edit2 className="w-3.5 h-3.5" /> Edit
              </button>
              <button 
                onClick={() => setConfirmDeleteOrderId(r.id)} 
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 transition-colors border border-transparent shadow-sm"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  // Filter orders
  const displayOrders = useMemo(() => {
    return orders.map(o => {
      let itemsToProcess = o.items;
      if (activeTab !== 'all') {
        itemsToProcess = itemsToProcess.filter(item => {
          const product = products.find(p => p.id === item.productId);
          const div = getProductDivision(product);
          return div === activeTab;
        });
      }
      
      const dynamicallyPricedItems = itemsToProcess.map(item => {
        const product = products.find(p => p.id === item.productId);
        const unitPrice = (typeof item.unitPrice === 'number' && item.unitPrice > 0)
          ? item.unitPrice
          : (product ? resolveProductPrice(o.clientId, product.id) : (item.unitPrice || 0));
        const total = (typeof item.total === 'number' && item.total > 0)
          ? item.total
          : unitPrice * item.qty;
        return {
          ...item,
          unitPrice,
          total
        };
      });

      const orderTotal = (activeTab === 'all' && typeof o.total === 'number' && o.total > 0)
        ? o.total
        : dynamicallyPricedItems.reduce((sum, item) => sum + item.total, 0);

      return {
        ...o,
        items: dynamicallyPricedItems,
        total: orderTotal,
        subtotal: orderTotal
      };
    }).filter(o => {
      if (o.items.length === 0 && activeTab !== 'all') return false;
      // Check if order exists (deleted orders are physically moved to trash)
      let matches = true;
      if (filterDate) {
        matches = matches && o.deliveryDate === filterDate;
      }
      if (filterRegion) {
        matches = matches && getClientRegion(o.clientId) === filterRegion;
      }
      if (filterClientId) {
        matches = matches && o.clientId === filterClientId;
      }
      if (search) {
        const s = search.toLowerCase();
        matches = matches && (o.clientName.toLowerCase().includes(s) || o.id.toLowerCase().includes(s));
      }
      return matches;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orders, products, filterDate, filterRegion, filterClientId, search, activeTab]);

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <PageHeader
        title="Orders"
        description="Manage customer orders."
        actions={
          <div className="flex items-center gap-2">
            <Button size="md" variant="secondary" icon={<Grid className="w-4 h-4" />} onClick={() => navigate('/orders/bulk')}>
              Bulk Entry
            </Button>
            <Button size="md" icon={<Plus className="w-4 h-4" />} onClick={() => navigate('/orders/new')}>
              Create Order
            </Button>
          </div>
        }
      />

      <Card className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <Calendar className="w-3.5 h-3.5" /> Delivery Date
            </label>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <MapIcon className="w-3.5 h-3.5" /> Region
            </label>
            <select
              value={filterRegion}
              onChange={(e) => {
                setFilterRegion(e.target.value as Region);
                setFilterClientId(''); // reset client
              }}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
            >
              <option value="">All Regions</option>
              {activeRegions.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <Users className="w-3.5 h-3.5" /> Client
            </label>
            <select
              value={filterClientId}
              onChange={(e) => setFilterClientId(e.target.value)}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer disabled:opacity-50"
              disabled={!filterRegion}
            >
              <option value="">All Clients</option>
              {activeClients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <Search className="w-3.5 h-3.5" /> Search
            </label>
            <SearchInput
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClear={() => setSearch('')}
              placeholder="Search orders..."
              className="w-full"
            />
          </div>
        </div>
      </Card>

      <Card padding={false} className="overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
        <DataTable
          columns={columns}
          data={displayOrders}
          keyExtractor={r => r.id}
          emptyState={
            <div className="py-24 text-center flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-gray-400 mb-4">
                <FileText className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-[var(--color-text-main)] mb-1">No orders found</h3>
              <p className="text-sm font-medium text-[var(--color-text-muted)]">Try adjusting your filters or create a new order.</p>
            </div>
          }
        />
      </Card>

      {/* Delete Confirmation Modal */}
      {confirmDeleteOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--color-card)] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/[0.05] w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400 mb-4">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-[var(--color-text-main)] mb-2">Delete Order?</h3>
              <p className="text-sm font-medium text-[var(--color-text-muted)]">
                Are you sure you want to move this order to Trash?
              </p>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-black/20 border-t border-gray-100 dark:border-white/[0.05] flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmDeleteOrderId(null)}>Cancel</Button>
              <Button variant="danger" className="flex-1" onClick={() => confirmDelete(confirmDeleteOrderId)}>Move to Trash</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
