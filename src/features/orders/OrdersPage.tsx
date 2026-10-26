import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Edit2, 
  Trash2, 
  Calendar, 
  Plus, 
  CreditCard, 
  Clock, 
  ShoppingBag, 
  AlertTriangle, 
  AlertCircle, 
  Loader2,
  Printer
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { type Order, type Region } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { Button, Card, DataTable, PageHeader, type Column, Badge } from '../../components/ui';
import { useDivisionStore } from '../../stores/divisionStore';
import { moveToTrash, bulkDeleteOrders, type BulkDeleteOrdersResult } from '../../services/db';
import { useAuthStore } from '../../stores/authStore';
import { formatCurrency, getProductDivision, cn } from '../../lib/utils';
import RecordPaymentModal from '../../components/payments/RecordPaymentModal';
import OrderPaymentHistoryModal from '../../components/payments/OrderPaymentHistoryModal';
import DirectSaleModal from '../../components/orders/DirectSaleModal';
import { printOrderInvoice } from '../../lib/invoicePrint';

export default function OrdersPage() {
  const { clients, orders, regions, products, payments, ledger } = useDataStore();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  
  // Filters
  const [filterDate, setFilterDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [filterRegion, setFilterRegion] = useState<Region | ''>('');
  const [filterClientId, setFilterClientId] = useState<string>('');
  const [filterOrderType, setFilterOrderType] = useState<'all' | 'client' | 'direct'>('all');
  const [search, setSearch] = useState('');
  const { activeDivision: activeTab } = useDivisionStore();

  // Selection state
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

  // Bulk Deletion Modal states
  const [deleteSelectedModalOpen, setDeleteSelectedModalOpen] = useState(false);
  const [deleteAllModalOpen, setDeleteAllModalOpen] = useState(false);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionResult, setDeletionResult] = useState<BulkDeleteOrdersResult | null>(null);
  const [resultModalOpen, setResultModalOpen] = useState(false);

  // Single order delete state
  const [confirmDeleteOrderId, setConfirmDeleteOrderId] = useState<string | null>(null);

  // Modal states for recording and viewing payment history
  const [selectedOrderForPayment, setSelectedOrderForPayment] = useState<Order | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [historyModalOrder, setHistoryModalOrder] = useState<Order | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [directSaleModalOpen, setDirectSaleModalOpen] = useState(false);

  const getClientRegion = (clientId: string) => {
    if (clientId === 'direct') return 'Direct Sale / —';
    const client = clients.find(c => c.id === clientId);
    return client?.region || '-';
  };

  const getOrderPayments = (orderId: string) => {
    return payments.filter(p => !p.deletedAt && p.invoiceId === orderId);
  };

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
      if (filterOrderType !== 'all') {
        const isDirect = o.orderType === 'direct' || o.clientId === 'direct';
        if (filterOrderType === 'direct' && !isDirect) return false;
        if (filterOrderType === 'client' && isDirect) return false;
      }
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
        const isDirect = o.orderType === 'direct' || o.clientId === 'direct';
        matches = matches && (
          (isDirect && 'direct sale'.includes(s)) ||
          (o.clientName || '').toLowerCase().includes(s) ||
          (o.id || '').toLowerCase().includes(s)
        );
      }
      return matches;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orders, products, filterDate, filterRegion, filterClientId, filterOrderType, search, activeTab, clients]);

  // Selection calculations
  const displayedOrderIds = useMemo(() => displayOrders.map(o => o.id), [displayOrders]);

  const allDisplayedSelected = useMemo(() => {
    return displayedOrderIds.length > 0 && displayedOrderIds.every(id => selectedOrderIds.has(id));
  }, [displayedOrderIds, selectedOrderIds]);

  const someDisplayedSelected = useMemo(() => {
    return displayedOrderIds.some(id => selectedOrderIds.has(id));
  }, [displayedOrderIds, selectedOrderIds]);

  const handleToggleSelectAll = () => {
    if (allDisplayedSelected) {
      // Deselect all orders displayed by active filters
      setSelectedOrderIds(prev => {
        const next = new Set(prev);
        displayedOrderIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      // Select all orders currently displayed by active filters
      setSelectedOrderIds(prev => {
        const next = new Set(prev);
        displayedOrderIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const handleToggleSelectOrder = (orderId: string) => {
    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedOrderIds(new Set());
  };

  // Selected orders breakdown for Delete Selected
  const selectedOrdersList = useMemo(() => {
    return orders.filter(o => selectedOrderIds.has(o.id));
  }, [orders, selectedOrderIds]);

  const { selectedEligibleOrders, selectedBlockedOrders } = useMemo(() => {
    const eligible: Order[] = [];
    const blocked: Array<{ order: Order; payments: typeof payments; paidAmount: number }> = [];

    for (const o of selectedOrdersList) {
      const orderPayments = getOrderPayments(o.id);
      const paid = orderPayments.reduce((s, p) => s + (p.amount || 0), 0);
      if (orderPayments.length > 0 || paid > 0.01) {
        blocked.push({ order: o, payments: orderPayments, paidAmount: paid });
      } else {
        eligible.push(o);
      }
    }

    return { selectedEligibleOrders: eligible, selectedBlockedOrders: blocked };
  }, [selectedOrdersList, payments]);

  // All orders breakdown for Delete All Orders (entire DB scope)
  const { allEligibleOrders, allBlockedOrders } = useMemo(() => {
    const eligible: Order[] = [];
    const blocked: Array<{ order: Order; payments: typeof payments; paidAmount: number }> = [];

    for (const o of orders) {
      const orderPayments = getOrderPayments(o.id);
      const paid = orderPayments.reduce((s, p) => s + (p.amount || 0), 0);
      if (orderPayments.length > 0 || paid > 0.01) {
        blocked.push({ order: o, payments: orderPayments, paidAmount: paid });
      } else {
        eligible.push(o);
      }
    }

    return { allEligibleOrders: eligible, allBlockedOrders: blocked };
  }, [orders, payments]);

  // Execute bulk delete
  const executeBulkDelete = async (ordersToDelete: Order[], isAll: boolean) => {
    if (isDeleting) return;
    if (!isAdmin) {
      toast.error('Unauthorized: Only administrators can delete orders');
      return;
    }

    setIsDeleting(true);
    try {
      const result = await bulkDeleteOrders(ordersToDelete, user?.displayName || 'Admin');
      setDeletionResult(result);

      // Update selectedOrderIds to remove deleted orders
      setSelectedOrderIds(prev => {
        const next = new Set(prev);
        result.deletedOrderIds.forEach(id => next.delete(id));
        return next;
      });

      if (isAll) {
        setDeleteAllModalOpen(false);
        setDeleteAllConfirmText('');
      } else {
        setDeleteSelectedModalOpen(false);
      }

      if (result.failedCount === 0 && result.successCount > 0) {
        toast.success(`Successfully deleted ${result.successCount} order(s)`);
      } else if (result.successCount > 0 && result.failedCount > 0) {
        toast.warning(`Deleted ${result.successCount} order(s). ${result.failedCount} order(s) could not be deleted.`);
        setResultModalOpen(true);
      } else if (result.failedCount > 0 && result.successCount === 0) {
        toast.error(`Could not delete orders. ${result.failedCount} order(s) were blocked due to payment dependencies.`);
        setResultModalOpen(true);
      }
    } catch (err: any) {
      console.error('Bulk delete error:', err);
      toast.error(err.message || 'An error occurred during deletion');
    } finally {
      setIsDeleting(false);
    }
  };

  // Single order delete handling
  const orderToDelete = useMemo(() => {
    return confirmDeleteOrderId ? orders.find(o => o.id === confirmDeleteOrderId) || null : null;
  }, [confirmDeleteOrderId, orders]);

  const orderToDeletePayments = useMemo(() => {
    return orderToDelete ? getOrderPayments(orderToDelete.id) : [];
  }, [orderToDelete, payments]);

  const orderToDeletePaid = useMemo(() => {
    return orderToDeletePayments.reduce((s, p) => s + (p.amount || 0), 0);
  }, [orderToDeletePayments]);

  const confirmSingleDelete = async (orderId: string) => {
    if (isDeleting) return;
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    if (orderToDeletePayments.length > 0) {
      toast.error('Cannot delete order with existing payments');
      return;
    }

    setIsDeleting(true);
    try {
      await moveToTrash('orders', orderId, order, user?.displayName || 'Admin');
      toast.success('Order moved to trash');
      setConfirmDeleteOrderId(null);
      setSelectedOrderIds(prev => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    } catch (err: any) {
      console.error('Single delete error:', err);
      toast.error(err.message || 'Failed to delete order');
    } finally {
      setIsDeleting(false);
    }
  };

  const columns: Column<Order>[] = [
    {
      key: 'select',
      label: (
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            checked={allDisplayedSelected}
            ref={el => {
              if (el) {
                el.indeterminate = someDisplayedSelected && !allDisplayedSelected;
              }
            }}
            onChange={handleToggleSelectAll}
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500 cursor-pointer accent-red-600"
            aria-label="Select all displayed orders"
          />
        </div>
      ),
      width: 'w-12',
      align: 'center',
      render: r => (
        <div className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selectedOrderIds.has(r.id)}
            onChange={() => handleToggleSelectOrder(r.id)}
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500 cursor-pointer accent-red-600"
            aria-label={`Select order ${r.id}`}
          />
        </div>
      ),
    },
    {
      key: 'client', label: 'Client / Shop',
      render: r => {
        const isDirect = r.orderType === 'direct' || r.clientId === 'direct';
        return (
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold text-[var(--color-text-main)]">
                {isDirect ? 'Direct Sale' : r.clientName}
              </span>
              <span
                className={cn(
                  'text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap',
                  isDirect
                    ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                    : 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                )}
              >
                {isDirect ? 'Direct Sale' : 'Client Order'}
              </span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">#{r.id.slice(0, 8)}</span>
          </div>
        );
      },
    },
    {
      key: 'region', label: 'Region',
      render: r => {
        const isDirect = r.orderType === 'direct' || r.clientId === 'direct';
        return (
          <Badge variant={isDirect ? 'warning' : 'gray'}>
            {isDirect ? 'Direct Sale / —' : getClientRegion(r.clientId)}
          </Badge>
        );
      },
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
      render: r => {
        const credit = r.creditApplied || 0;
        return (
          <div className="flex flex-col items-end">
            <span className="text-sm font-bold text-[var(--color-text-main)] tabular-nums">{formatCurrency(r.total)}</span>
            {credit > 0 && (
              <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">
                -{formatCurrency(credit)} credit
              </span>
            )}
          </div>
        );
      }
    },
    {
      key: 'paid', label: 'Paid', align: 'right',
      render: r => {
        const orderPayments = payments.filter(p => !p.deletedAt && p.invoiceId === r.id);
        const paymentsPaid = orderPayments.reduce((s, p) => s + (p.appliedAmount !== undefined ? p.appliedAmount : (p.amount || 0)), 0);
        const paid = Math.max(paymentsPaid, r.paidAmount || 0);
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
        const paymentsPaid = orderPayments.reduce((s, p) => s + (p.appliedAmount !== undefined ? p.appliedAmount : (p.amount || 0)), 0);
        const paid = Math.max(paymentsPaid, r.paidAmount || 0);
        const credit = r.creditApplied || ((r.primaryCreditApplied || 0) + (r.bakeryCreditApplied || 0)) || 0;
        const netDue = Math.max(0, r.total - credit);
        const isPaid = r.paymentStatus === 'paid' || (netDue - paid) <= 0.01;
        const pending = isPaid ? 0 : Math.max(0, netDue - paid);
        return isPaid ? (
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
        const paymentsPaid = orderPayments.reduce((s, p) => s + (p.appliedAmount !== undefined ? p.appliedAmount : (p.amount || 0)), 0);
        const paid = Math.max(paymentsPaid, r.paidAmount || 0);
        const credit = r.creditApplied || ((r.primaryCreditApplied || 0) + (r.bakeryCreditApplied || 0)) || 0;
        const netDue = Math.max(0, r.total - credit);
        const isPaid = r.paymentStatus === 'paid' || (netDue - paid) <= 0.01;
        const pending = isPaid ? 0 : Math.max(0, netDue - paid);

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

            {/* View / Print Unified Invoice */}
            <button
              type="button"
              onClick={() => {
                const client = clients.find(c => c.id === r.clientId) || null;
                printOrderInvoice({ order: r, client, payments, products, ledger });
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-bold text-gray-700 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-800 transition-colors border border-gray-200 dark:border-gray-700 shadow-xs"
              title="Print / View Invoice"
            >
              <Printer className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
              <span>Invoice</span>
            </button>

            {/* Record Payment */}
            {!isPaid && pending > 0.01 && (
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

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <PageHeader
        title="Orders"
        description="View customer orders, direct sales, historical item prices, and record payments."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="md"
              variant="secondary"
              icon={<ShoppingBag className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
              onClick={() => setDirectSaleModalOpen(true)}
            >
              New Direct Sale
            </Button>
            {isAdmin && (
              <Button
                size="md"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => navigate('/orders/bulk')}
              >
                New Order
              </Button>
            )}
          </div>
        }
      />

      <Card className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
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
              Order Type
            </label>
            <select
              value={filterOrderType}
              onChange={e => setFilterOrderType(e.target.value as 'all' | 'client' | 'direct')}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            >
              <option value="all">All Types</option>
              <option value="client">Client Orders</option>
              <option value="direct">Direct Sales</option>
            </select>
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

      {/* Selection Action Bar */}
      {selectedOrderIds.size > 0 && (
        <div className="mb-4 p-4 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex flex-wrap items-center justify-between gap-3 shadow-xs animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-full bg-red-600 text-white font-bold text-xs shadow-xs">
              {selectedOrderIds.size}
            </span>
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {selectedOrderIds.size} {selectedOrderIds.size === 1 ? 'order' : 'orders'} selected
            </span>
            <button
              type="button"
              onClick={handleClearSelection}
              className="text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 underline decoration-dotted ml-2 transition-colors cursor-pointer"
            >
              Clear Selection
            </button>
          </div>

          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="w-4 h-4" />}
                onClick={() => setDeleteSelectedModalOpen(true)}
              >
                Delete Selected ({selectedOrderIds.size})
              </Button>
            )}
          </div>
        </div>
      )}

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

      {/* Direct Sale Modal */}
      <DirectSaleModal
        isOpen={directSaleModalOpen}
        onClose={() => setDirectSaleModalOpen(false)}
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

      {/* Delete Selected Orders Confirmation Modal (Admin Only) */}
      {deleteSelectedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-[var(--color-card)] rounded-3xl shadow-2xl border border-gray-200 dark:border-white/10 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[var(--color-text-main)]">Delete Selected Orders</h2>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {selectedOrdersList.length} order(s) selected
                </p>
              </div>
            </div>

            {selectedBlockedOrders.length > 0 && (
              <div className="mb-4 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-300 text-xs">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  <div className="w-full">
                    <p className="font-bold">
                      {selectedBlockedOrders.length} order(s) cannot be deleted:
                    </p>
                    <p className="mt-0.5 text-amber-700 dark:text-amber-400">
                      These orders have recorded payments. Deletion is blocked to protect payment history and ledger balances.
                    </p>
                    <div className="mt-2 max-h-28 overflow-y-auto divide-y divide-amber-200/50 dark:divide-amber-800/30">
                      {selectedBlockedOrders.map(({ order, paidAmount, payments: ordPayments }) => (
                        <div key={order.id} className="py-1 flex justify-between font-mono text-[11px]">
                          <span>#{order.id.slice(0, 8)} ({order.clientName || 'Direct Sale'})</span>
                          <span className="font-semibold">{formatCurrency(paidAmount)} ({ordPayments.length} payment{ordPayments.length > 1 ? 's' : ''})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {selectedEligibleOrders.length === 0 ? (
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/40 text-center mb-6">
                <p className="text-sm font-semibold text-[var(--color-text-main)]">
                  No orders eligible for deletion
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  All selected orders have associated payments. Remove or reassign payment records first if you wish to delete them.
                </p>
              </div>
            ) : (
              <div className="mb-6">
                <p className="text-sm font-medium text-[var(--color-text-main)] mb-2">
                  You are about to delete <strong className="text-red-600 font-bold">{selectedEligibleOrders.length}</strong> order(s).
                </p>
                <ul className="text-xs text-[var(--color-text-muted)] space-y-1 list-disc list-inside">
                  <li>Orders will be moved to Trash and can be restored later.</li>
                  <li>Associated invoice ledger debits will be removed to clear client balances.</li>
                  <li>Product stock deductions will be safely reversed.</li>
                  <li>Client records, products, staff, and payments remain completely untouched.</li>
                </ul>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                disabled={isDeleting}
                onClick={() => setDeleteSelectedModalOpen(false)}
              >
                Cancel
              </Button>
              {selectedEligibleOrders.length > 0 && (
                <Button
                  variant="danger"
                  disabled={isDeleting}
                  icon={isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  onClick={() => executeBulkDelete(selectedEligibleOrders, false)}
                >
                  {isDeleting ? 'Deleting...' : `Delete ${selectedEligibleOrders.length} Order(s)`}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete All Orders Confirmation Modal (Admin Only) */}
      {deleteAllModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-[var(--color-card)] rounded-3xl shadow-2xl border border-red-300 dark:border-red-900/60 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-red-600 text-white flex items-center justify-center shrink-0 shadow-md">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-red-600 dark:text-red-400">Delete All Orders</h2>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Entire database scope ({orders.length} total orders)
                </p>
              </div>
            </div>

            <div className="mb-4 p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-900 dark:text-red-200 text-xs space-y-2">
              <p className="font-bold text-sm flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                CRITICAL WARNING: Database-Wide Action
              </p>
              <p>
                This action targets <strong>EVERY</strong> order in the database (total: <strong>{orders.length}</strong> orders), <strong>including orders outside your current filters, dates, and regions.</strong>
              </p>
              <p className="text-red-700 dark:text-red-300">
                To protect accounting integrity, any orders with recorded payments ({allBlockedOrders.length}) will NOT be deleted. Only unpaid orders ({allEligibleOrders.length}) will be moved to Trash.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-center">
              <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
                <div className="text-xs text-[var(--color-text-muted)] uppercase font-semibold">Eligible to Delete</div>
                <div className="text-xl font-bold text-red-600 mt-0.5">{allEligibleOrders.length}</div>
              </div>
              <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
                <div className="text-xs text-[var(--color-text-muted)] uppercase font-semibold">Protected (Has Payments)</div>
                <div className="text-xl font-bold text-emerald-600 mt-0.5">{allBlockedOrders.length}</div>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
                Type <span className="font-mono font-bold text-red-600 select-all">DELETE ALL</span> to confirm:
              </label>
              <input
                type="text"
                value={deleteAllConfirmText}
                onChange={e => setDeleteAllConfirmText(e.target.value)}
                placeholder="Type DELETE ALL"
                disabled={isDeleting}
                className="w-full px-4 py-2.5 text-sm font-semibold rounded-xl border border-red-200 dark:border-red-900/60 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-red-500 uppercase transition-all"
              />
            </div>

            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                disabled={isDeleting}
                onClick={() => {
                  setDeleteAllModalOpen(false);
                  setDeleteAllConfirmText('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={deleteAllConfirmText !== 'DELETE ALL' || isDeleting || allEligibleOrders.length === 0}
                icon={isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                onClick={() => executeBulkDelete(allEligibleOrders, true)}
              >
                {isDeleting ? 'Deleting All Orders...' : `Delete All Eligible Orders (${allEligibleOrders.length})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Deletion Results Summary Modal */}
      {resultModalOpen && deletionResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-[var(--color-card)] rounded-3xl shadow-2xl border border-gray-200 dark:border-white/10 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-[var(--color-text-main)] mb-1">
              Deletion Summary
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] mb-4">
              Results of the bulk deletion operation
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 text-center">
                <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 uppercase">Deleted</span>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{deletionResult.successCount}</p>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-center">
                <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase">Blocked / Failed</span>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{deletionResult.failedCount}</p>
              </div>
            </div>

            {deletionResult.failures.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                  Blocked Orders & Reasons:
                </h3>
                <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800 border border-gray-100 dark:border-gray-800 rounded-xl">
                  {deletionResult.failures.map(f => (
                    <div key={f.orderId} className="p-3 text-xs">
                      <div className="flex justify-between items-center font-semibold text-[var(--color-text-main)]">
                        <span className="font-mono">#{f.orderId.slice(0, 8)}</span>
                        <span>{f.clientName}</span>
                      </div>
                      <p className="text-amber-600 dark:text-amber-400 text-[11px] mt-1">
                        {f.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={() => {
                  setResultModalOpen(false);
                  setDeletionResult(null);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Single Delete Order Modal (Admin Only) */}
      {confirmDeleteOrderId && orderToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-[var(--color-card)] rounded-3xl shadow-2xl border border-gray-100 dark:border-white/[0.06] w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-[var(--color-text-main)] mb-1">Delete Order?</h2>
            {orderToDeletePayments.length > 0 ? (
              <>
                <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-300 text-xs">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="font-bold">Deletion Blocked</p>
                      <p className="mt-1">
                        This order has {orderToDeletePayments.length} recorded payment(s) totalling {formatCurrency(orderToDeletePaid)}.
                      </p>
                      <p className="mt-1">
                        Cannot delete orders with active payments to protect ledger integrity.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => setConfirmDeleteOrderId(null)}>
                    Close
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-[var(--color-text-muted)] mb-6">
                  This order will be moved to the Trash. You can recover it later if needed.
                </p>
                <div className="flex gap-3">
                  <Button variant="outline" disabled={isDeleting} className="flex-1" onClick={() => setConfirmDeleteOrderId(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    disabled={isDeleting}
                    className="flex-1"
                    icon={isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
                    onClick={() => confirmSingleDelete(confirmDeleteOrderId)}
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
