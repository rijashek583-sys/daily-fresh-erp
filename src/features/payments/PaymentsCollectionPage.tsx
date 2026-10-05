import { useState, useMemo } from 'react';
import {
  CreditCard, Search, Calendar, MapPin, CheckCircle2, Clock,
  ArrowRight, Filter, Receipt, RefreshCw, Banknote, Smartphone, Building
} from 'lucide-react';
import { format, isToday } from 'date-fns';
import { useDataStore } from '../../stores/dataStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { useAuthStore } from '../../stores/authStore';
import { Button, Card, Badge } from '../../components/ui';
import { formatCurrency, cn, getProductDivision } from '../../lib/utils';
import { type Order, type Payment, type PaymentMethod, type Division } from '../../types';
import RecordPaymentModal from '../../components/payments/RecordPaymentModal';
import OrderPaymentHistoryModal from '../../components/payments/OrderPaymentHistoryModal';

const methodIcon: Record<PaymentMethod, React.ElementType> = {
  upi: Smartphone,
  cash: Banknote,
  bank_transfer: Building,
  card: CreditCard,
};

const methodLabel: Record<PaymentMethod, string> = {
  upi: 'UPI',
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
};

export default function PaymentsCollectionPage() {
  const { clients, orders, payments, products } = useDataStore();
  const { activeDivision } = useDivisionStore();
  const { user } = useAuthStore();

  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [search, setSearch] = useState('');
  const [filterRegion, setFilterRegion] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  // Modals state
  const [selectedOrderForPayment, setSelectedOrderForPayment] = useState<Order | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [historyModalOrder, setHistoryModalOrder] = useState<Order | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

  // Filter payments by active division
  const validPayments = useMemo(() => {
    return payments.filter(p => {
      if (p.deletedAt) return false;
      if (activeDivision !== 'all' && p.division && p.division !== activeDivision) {
        return false;
      }
      return true;
    });
  }, [payments, activeDivision]);

  // Payment totals mapped by invoiceId
  const invoicePaymentsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of validPayments) {
      if (p.invoiceId) {
        const current = map.get(p.invoiceId) || 0;
        map.set(p.invoiceId, current + (p.amount || 0));
      }
    }
    return map;
  }, [validPayments]);

  // Calculate order items and totals respecting division
  const processedOrders = useMemo(() => {
    return orders.map(o => {
      let itemsToProcess = o.items || [];
      if (activeDivision !== 'all') {
        itemsToProcess = itemsToProcess.filter(item => {
          const prod = products.find(p => p.id === item.productId);
          return getProductDivision(prod || { name: item.productName }) === activeDivision;
        });
      }

      const total = activeDivision === 'all' && typeof o.total === 'number'
        ? o.total
        : itemsToProcess.reduce((sum, i) => sum + (i.total || (i.qty * i.unitPrice) || 0), 0);

      const paid = invoicePaymentsMap.get(o.id) || 0;
      const pending = Math.max(0, total - paid);

      const client = clients.find(c => c.id === o.clientId);
      const region = client?.region || '';

      return {
        ...o,
        items: itemsToProcess,
        total,
        paid,
        pending,
        region,
      };
    }).filter(o => {
      if (activeDivision !== 'all' && o.items.length === 0) return false;
      return true;
    });
  }, [orders, products, activeDivision, invoicePaymentsMap, clients]);

  // Orders with Pending Balance > 0
  const pendingOrders = useMemo(() => {
    return processedOrders
      .filter(o => o.pending > 0.01)
      .filter(o => (filterRegion ? o.region === filterRegion : true))
      .filter(o => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          o.clientName.toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q) ||
          o.region.toLowerCase().includes(q)
        );
      })
      .filter(o => (dateFilter ? o.deliveryDate === dateFilter : true))
      .sort((a, b) => b.pending - a.pending);
  }, [processedOrders, filterRegion, search, dateFilter]);

  // Historical payments list
  const filteredHistory = useMemo(() => {
    return validPayments
      .filter(p => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          (p.clientName || '').toLowerCase().includes(q) ||
          (p.reference || '').toLowerCase().includes(q) ||
          (p.updatedBy || '').toLowerCase().includes(q) ||
          (p.notes || '').toLowerCase().includes(q)
        );
      })
      .filter(p => {
        if (!dateFilter) return true;
        const pDate = p.createdAt ? p.createdAt.substring(0, 10) : '';
        return pDate === dateFilter;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [validPayments, search, dateFilter]);

  // Summary Metrics
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayCollectionsTotal = useMemo(() => {
    return validPayments
      .filter(p => (p.createdAt && p.createdAt.startsWith(todayStr)) || p.billDate === todayStr)
      .reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [validPayments, todayStr]);

  const totalPendingAmount = useMemo(() => {
    return processedOrders.reduce((sum, o) => sum + o.pending, 0);
  }, [processedOrders]);

  const uniqueRegions = useMemo(() => {
    const set = new Set<string>();
    clients.forEach(c => {
      if (c.region && !c.deletedAt) set.add(c.region);
    });
    return Array.from(set).sort();
  }, [clients]);

  // Open modal helpers
  const handleOpenPayment = (order: Order) => {
    setSelectedOrderForPayment(order);
    setPaymentModalOpen(true);
  };

  const handleOpenHistory = (order: Order) => {
    setHistoryModalOrder(order);
    setHistoryModalOpen(true);
  };

  return (
    <div className="max-w-7xl mx-auto pb-16">
      
      {/* ── Page Header ── */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-main)] mb-1">
            Payments & Collections
          </h1>
          <p className="text-sm font-medium text-[var(--color-text-muted)]">
            Collect pending amounts from shops and track payment history.
          </p>
        </div>

        {/* Tab switch pills */}
        <div className="flex p-1 bg-gray-100 dark:bg-gray-800/80 rounded-2xl self-start sm:self-auto shadow-xs">
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2',
              activeTab === 'pending'
                ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
            )}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Pending Collections</span>
            <span className={cn(
              'text-[10px] px-1.5 py-0.2 rounded-full font-bold',
              activeTab === 'pending'
                ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
            )}>
              {pendingOrders.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2',
              activeTab === 'history'
                ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
            )}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Payment History</span>
            <span className={cn(
              'text-[10px] px-1.5 py-0.2 rounded-full font-bold',
              activeTab === 'history'
                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
            )}>
              {filteredHistory.length}
            </span>
          </button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Today's Collections
            </p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {formatCurrency(todayCollectionsTotal)}
            </p>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Total Outstanding
            </p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
              {formatCurrency(totalPendingAmount)}
            </p>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/40 text-[var(--color-primary)] flex items-center justify-center shrink-0">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Pending Orders
            </p>
            <p className="text-2xl font-bold text-[var(--color-text-main)] tabular-nums">
              {pendingOrders.length}
            </p>
          </div>
        </Card>
      </div>

      {/* ── Filter Bar ── */}
      <Card className="mb-6 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={activeTab === 'pending' ? 'Search by shop name or order ID...' : 'Search payments...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>

          {activeTab === 'pending' && (
            <div className="relative">
              <MapPin className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <select
                value={filterRegion}
                onChange={e => setFilterRegion(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
              >
                <option value="">All Regions</option>
                {uniqueRegions.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          )}

          <div className="relative">
            <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="date"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>
        </div>
      </Card>

      {/* ── Content View ── */}
      {activeTab === 'pending' ? (
        pendingOrders.length === 0 ? (
          <div className="text-center py-20 bg-[var(--color-card)] rounded-3xl border border-dashed border-gray-200 dark:border-gray-800">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
            <h3 className="text-base font-bold text-[var(--color-text-main)]">
              No Pending Collections
            </h3>
            <p className="text-xs font-medium text-gray-500 mt-1">
              All matching customer orders have been fully paid.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Desktop Table */}
            <div className="hidden md:block">
              <Card padding={false} className="overflow-hidden">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50/80 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-left">
                      <th className="px-5 py-3.5">Shop / Client</th>
                      <th className="px-4 py-3.5">Region</th>
                      <th className="px-4 py-3.5">Delivery Date</th>
                      <th className="px-4 py-3.5">Items</th>
                      <th className="px-4 py-3.5 text-right">Order Total</th>
                      <th className="px-4 py-3.5 text-right">Paid</th>
                      <th className="px-4 py-3.5 text-right">Pending Amount</th>
                      <th className="px-5 py-3.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                    {pendingOrders.map(order => (
                      <tr key={order.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/20 transition-colors">
                        <td className="px-5 py-3.5">
                          <p className="font-bold text-xs text-[var(--color-text-main)]">
                            {order.clientName}
                          </p>
                          <span className="text-[10px] text-gray-400 font-mono">
                            #{order.id.slice(0, 10)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge variant="gray">{order.region || '—'}</Badge>
                        </td>
                        <td className="px-4 py-3.5 text-xs font-medium text-[var(--color-text-muted)] whitespace-nowrap">
                          {format(new Date(order.deliveryDate), 'MMM d, yyyy')}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-[var(--color-text-muted)]">
                          {order.items.map(i => `${i.productName} (${i.qty})`).join(', ')}
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold text-xs tabular-nums text-[var(--color-text-main)]">
                          {formatCurrency(order.total)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-medium text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(order.paid)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-bold text-sm tabular-nums text-amber-600 dark:text-amber-400">
                          {formatCurrency(order.pending)}
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            {order.paid > 0 && (
                              <button
                                type="button"
                                onClick={() => handleOpenHistory(order)}
                                className="text-[11px] font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:underline mr-1"
                              >
                                History
                              </button>
                            )}
                            <Button
                              size="sm"
                              onClick={() => handleOpenPayment(order)}
                              className="shadow-sm shadow-red-500/20"
                            >
                              Record Payment
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
              {pendingOrders.map(order => (
                <Card key={order.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-sm text-[var(--color-text-main)]">
                        {order.clientName}
                      </h4>
                      <p className="text-[11px] text-gray-400 font-medium">
                        {order.region ? `${order.region} &middot; ` : ''}
                        {format(new Date(order.deliveryDate), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <Badge variant="warning">
                      Pending
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-2 py-2 px-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 text-center text-xs">
                    <div>
                      <span className="text-[10px] text-gray-400 uppercase">Total</span>
                      <p className="font-semibold text-[var(--color-text-main)]">{formatCurrency(order.total)}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 uppercase">Paid</span>
                      <p className="font-semibold text-emerald-600">{formatCurrency(order.paid)}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 uppercase">Pending</span>
                      <p className="font-bold text-amber-600">{formatCurrency(order.pending)}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    {order.paid > 0 ? (
                      <button
                        type="button"
                        onClick={() => handleOpenHistory(order)}
                        className="text-xs font-semibold text-gray-500 hover:text-gray-900"
                      >
                        View History
                      </button>
                    ) : <span />}

                    <Button
                      size="sm"
                      onClick={() => handleOpenPayment(order)}
                      className="w-full sm:w-auto shadow-sm"
                    >
                      Record Payment
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )
      ) : (
        /* History View */
        filteredHistory.length === 0 ? (
          <div className="text-center py-20 bg-[var(--color-card)] rounded-3xl border border-dashed border-gray-200 dark:border-gray-800">
            <Receipt className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-[var(--color-text-main)]">
              No Payments Recorded
            </h3>
            <p className="text-xs font-medium text-gray-500 mt-1">
              Recorded payments will appear here in chronological order.
            </p>
          </div>
        ) : (
          <Card padding={false} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-left">
                    <th className="px-5 py-3.5">Date</th>
                    <th className="px-5 py-3.5">Client / Shop</th>
                    <th className="px-4 py-3.5">Region</th>
                    <th className="px-4 py-3.5">Method</th>
                    <th className="px-4 py-3.5">Reference / Notes</th>
                    <th className="px-4 py-3.5">Recorded By</th>
                    <th className="px-5 py-3.5 text-right">Amount Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                  {filteredHistory.map(p => {
                    const Icon = methodIcon[p.method] || Banknote;
                    const region = p.region || clients.find(c => c.id === p.clientId)?.region || '—';
                    const staffName = p.staffName || p.recordedBy || p.updatedBy || 'Staff';
                    return (
                      <tr key={p.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/20 transition-colors">
                        <td className="px-5 py-3.5 text-xs font-medium text-[var(--color-text-muted)] whitespace-nowrap">
                          {p.createdAt ? format(new Date(p.createdAt), 'MMM d, yyyy h:mm a') : '—'}
                        </td>
                        <td className="px-5 py-3.5 font-bold text-xs text-[var(--color-text-main)]">
                          {p.clientName || '—'}
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge variant="gray">{region}</Badge>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5 text-gray-400" />
                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                              {methodLabel[p.method] || p.method}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-gray-500">
                          {p.reference ? <span className="font-mono">{p.reference}</span> : ''}
                          {p.notes ? <span className="text-gray-400 ml-1">({p.notes})</span> : ''}
                          {!p.reference && !p.notes && '—'}
                        </td>
                        <td className="px-4 py-3.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
                          {staffName}
                        </td>
                        <td className="px-5 py-3.5 text-right font-bold text-sm tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(p.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      {/* Record Payment Modal */}
      <RecordPaymentModal
        isOpen={paymentModalOpen}
        onClose={() => {
          setPaymentModalOpen(false);
          setSelectedOrderForPayment(null);
        }}
        order={selectedOrderForPayment}
      />

      {/* Payment History Modal */}
      {historyModalOrder && (
        <OrderPaymentHistoryModal
          isOpen={historyModalOpen}
          onClose={() => {
            setHistoryModalOpen(false);
            setHistoryModalOrder(null);
          }}
          order={historyModalOrder}
          payments={validPayments.filter(p => p.invoiceId === historyModalOrder.id)}
          onRecordPayment={() => handleOpenPayment(historyModalOrder)}
        />
      )}
    </div>
  );
}
