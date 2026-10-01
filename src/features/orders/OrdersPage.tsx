import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Edit2, Trash2, Calendar, Plus, CreditCard, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { type Order, type Region } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { Button, Card, DataTable, PageHeader, type Column, Badge } from '../../components/ui';
import { useDivisionStore } from '../../stores/divisionStore';
import { moveToTrash } from '../../services/db';
import { useAuthStore } from '../../stores/authStore';
import { formatCurrency, getProductDivision } from '../../lib/utils';
import RecordPaymentModal from '../../components/payments/RecordPaymentModal';
import OrderPaymentHistoryModal from '../../components/payments/OrderPaymentHistoryModal';

export default function OrdersPage() {
  const { clients, orders, regions, products, payments } = useDataStore();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  
  // Filters
  const [filterDate, setFilterDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [filterRegion, setFilterRegion] = useState<Region | ''>('');
  const [filterClientId, setFilterClientId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [confirmDeleteOrderId, setConfirmDeleteOrderId] = useState<string | null>(null);
  const { activeDivision: activeTab } = useDivisionStore();

  // Modal states for recording and viewing payment history
  const [selectedOrderForPayment, setSelectedOrderForPayment] = useState<Order | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [historyModalOrder, setHistoryModalOrder] = useState<Order | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

  const getClientRegion = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    return client?.region || '-';
  };

  const confirmDelete = async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (order) {
      await moveToTrash('orders', orderId, order, user?.displayName || 'Admin');
      setConfirmDeleteOrderId(null);
    }
  };

  const columns: Column<Order>[] = [
    {
      key: 'client', label: 'Client / Shop',
      render: r => (
        <div>
          <span className="text-sm font-semibold text-[var(--color-text-main)] block">{r.clientName}</span>
          <span className="text-[10px] text-gray-400 font-mono">#{r.id.slice(0, 8)}</span>
        </div>
      ),
    },
    {
      key: 'region', label: 'Region',
      render: r => <Badge variant="gray">{getClientRegion(r.clientId)}</Badge>,
    },
    {
      key: 'deliveryDate', label: 'Delivery Date',
      render: r => <span className="text-sm font-medium text-[var(--color-text-muted)] whitespace-nowrap">{format(new Date(r.deliveryDate), 'MMM d, yyyy')}</span>,
    },
    {
      key: 'products', label: 'Products & Quantities',
      render: r => (
        <div className="flex flex-col gap-1 max-w-xs">
          {r.items.map(item => (
            <span key={item.productId} className="text-xs text-[var(--color-text-muted)] font-medium">
              {item.productName} × <strong className="text-[var(--color-text-main)]">{item.qty}</strong>
              {typeof item.unitPrice === 'number' && (
                <span className="text-[10px] text-gray-400 font-normal ml-1">
                  (@ {formatCurrency(item.unitPrice)})
                </span>
              )}
            </span>
          ))}
        </div>
      )
    },
    {
      key: 'total', label: 'Total', align: 'right',
      render: r => <span className="text-sm font-bold text-[var(--color-text-main)] tabular-nums">{formatCurrency(r.total)}</span>,
    },
    {
      key: 'paid', label: 'Paid', align: 'right',
      render: r => {
        const orderPayments = payments.filter(p => !p.deletedAt && p.invoiceId === r.id);
        const paid = orderPayments.reduce((s, p) => s + (p.amount || 0), 0);
        return (
          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {formatCurrency(paid)}
          </span>
        );
      }
    },
    {
      key: 'pending', label: 'Pending', align: 'right',
      render: r => {
        const orderPayments = payments.filter(p => !p.deletedAt && p.invoiceId === r.id);
        const paid = orderPayments.reduce((s, p) => s + (p.amount || 0), 0);
        const pending = Math.max(0, r.total - paid);
        return pending <= 0.01 ? (
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full whitespace-nowrap">
            Paid
          </span>
        ) : (
          <span className="text-xs font-bold text-amber-600 dark:text-amber-400 tabular-nums bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full whitespace-nowrap">
            {formatCurrency(pending)}
          </span>
        );
      }
    },
    {
      key: 'actions', label: '', align: 'right',
      render: r => {
        const orderPayments = payments.filter(p => !p.deletedAt && p.invoiceId === r.id);
        const paid = orderPayments.reduce((s, p) => s + (p.amount || 0), 0);
        const pending = Math.max(0, r.total - paid);

        return (
          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
            {/* View Payment History */}
            {orderPayments.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setHistoryModalOrder(r);
                  setHistoryModalOpen(true);
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title="View payments for this order"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>History ({orderPayments.length})</span>
              </button>
            )}

            {/* Record Payment */}
            {pending > 0.01 && (
              <button
                type="button"
                onClick={() => {
                  setSelectedOrderForPayment(r);
                  setPaymentModalOpen(true);
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold bg-red-50 text-[var(--color-primary)] hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/60 transition-colors border border-transparent shadow-xs"
              >
                <CreditCard className="w-3.5 h-3.5" /> Pay
              </button>
            )}

            {/* Admin only actions */}
            {isAdmin && (
              <>
                <button 
                  onClick={() => navigate(`/orders/${r.id}/edit`)} 
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors border border-transparent shadow-xs"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Edit
                </button>
                <button 
                  onClick={() => setConfirmDeleteOrderId(r.id)} 
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 transition-colors border border-transparent shadow-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </>
            )}
          </div>
        );
      },
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
      
      const processedItems = itemsToProcess.map(item => {
        const unitPrice = typeof item.unitPrice === 'number' ? item.unitPrice : 0;
        const total = typeof item.total === 'number' ? item.total : unitPrice * item.qty;
        return {
          ...item,
          unitPrice,
          total
        };
      });

      const orderTotal = activeTab === 'all' && typeof o.total === 'number'
        ? o.total
        : processedItems.reduce((sum, item) => sum + item.total, 0);

      return {
        ...o,
        items: processedItems,
        total: orderTotal,
        subtotal: orderTotal
      };
    }).filter(o => {
      if (o.items.length === 0 && activeTab !== 'all') return false;
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
  }, [orders, products, filterDate, filterRegion, filterClientId, search, activeTab, clients]);

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <PageHeader
        title="Orders"
        description="View customer orders, historical item prices, and record payments."
        actions={
          isAdmin ? (
            <Button size="md" icon={<Plus className="w-4 h-4" />} onClick={() => navigate('/orders/bulk')}>
              New Order
            </Button>
          ) : null
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
              onChange={e => setFilterDate(e.target.value)}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Region
            </label>
            <select
              value={filterRegion}
              onChange={e => setFilterRegion(e.target.value as Region | '')}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            >
              <option value="">All Regions</option>
              {regions.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Client
            </label>
            <select
              value={filterClientId}
              onChange={e => setFilterClientId(e.target.value)}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            >
              <option value="">All Clients</option>
              {clients
                .filter(c => !c.deletedAt && (!filterRegion || c.region === filterRegion))
                .map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Search
            </label>
            <input
              type="text"
              placeholder="Search by client or order ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>
        </div>
      </Card>

      <Card padding={false} className="overflow-hidden">
        <DataTable
          columns={columns}
          data={displayOrders}
          keyExtractor={r => r.id}
        />
      </Card>

      {/* Record Payment Modal */}
      <RecordPaymentModal
        isOpen={paymentModalOpen}
        onClose={() => {
          setPaymentModalOpen(false);
          setSelectedOrderForPayment(null);
        }}
        order={selectedOrderForPayment}
      />

      {/* Order Payment History Modal */}
      {historyModalOrder && (
        <OrderPaymentHistoryModal
          isOpen={historyModalOpen}
          onClose={() => {
            setHistoryModalOpen(false);
            setHistoryModalOrder(null);
          }}
          order={historyModalOrder}
          payments={payments.filter(p => !p.deletedAt && p.invoiceId === historyModalOrder.id)}
          onRecordPayment={() => {
            setSelectedOrderForPayment(historyModalOrder);
            setPaymentModalOpen(true);
          }}
        />
      )}

      {/* Confirm Delete Order Modal (Admin Only) */}
      {confirmDeleteOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-[var(--color-card)] rounded-3xl shadow-2xl border border-gray-100 dark:border-white/[0.06] w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-[var(--color-text-main)] mb-1">Delete Order?</h2>
            <p className="text-sm font-medium text-[var(--color-text-muted)] mb-6">
              This order will be moved to the Trash. You can recover it later if needed.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmDeleteOrderId(null)}>Cancel</Button>
              <Button variant="danger" className="flex-1" onClick={() => confirmDelete(confirmDeleteOrderId)}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
