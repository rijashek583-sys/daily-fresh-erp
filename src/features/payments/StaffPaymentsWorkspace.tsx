import { useState, useMemo } from 'react';
import {
  CreditCard,
  Clock,
  CheckCircle2,
  Calendar,
  MapPin,
  Search,
  Printer,
  ShoppingBag,
  UserCheck,
  Building,
  Smartphone,
  Banknote,
  FileText,
  TrendingUp,
  Download,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useDataStore } from '../../stores/dataStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { useAuthStore } from '../../stores/authStore';
import { Button, Card, Badge } from '../../components/ui';
import { formatCurrency, cn, getProductDivision } from '../../lib/utils';
import { type Order, type Payment, type PaymentMethod, type Division, type Client } from '../../types';
import RecordPaymentModal from '../../components/payments/RecordPaymentModal';
import DirectSaleModal from '../../components/orders/DirectSaleModal';
import { printOrderInvoice, printPaymentReceipt } from '../../lib/invoicePrint';
import { getClientOutstanding, getClientMetrics } from '../../lib/billing';
import { downloadStaffCollectionsCsv } from '../../lib/csvExport';

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

export default function StaffPaymentsWorkspace() {
  const { clients, orders, payments, products, ledger } = useDataStore();
  const { activeDivision } = useDivisionStore();
  const { user } = useAuthStore();

  const [activeTab, setActiveTab] = useState<'today' | 'pending' | 'my_collections'>('today');
  const [pendingSubTab, setPendingSubTab] = useState<'bills' | 'clients'>('clients');
  const [search, setSearch] = useState('');
  const [filterRegion, setFilterRegion] = useState('');
  const [selectedDate, setSelectedDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));

  // Date range for "My Collections"
  const [myRangePreset, setMyRangePreset] = useState<'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom'>('today');
  const [myRangeFrom, setMyRangeFrom] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [myRangeTo, setMyRangeTo] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));

  // Modals state
  const [selectedOrderForPayment, setSelectedOrderForPayment] = useState<Order | null>(null);
  const [selectedClientForPayment, setSelectedClientForPayment] = useState<Client | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [directSaleModalOpen, setDirectSaleModalOpen] = useState(false);

  const todayStr = format(new Date(), 'yyyy-MM-dd');

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

  // Map of total payments per invoice ID respecting cross-division counterparts
  const invoicePaymentsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      if (p.deletedAt) continue;

      if (p.invoiceId && (activeDivision === 'all' || p.division === activeDivision)) {
        const current = map.get(p.invoiceId) || 0;
        const applied = p.appliedAmount !== undefined ? p.appliedAmount : (p.amount || 0);
        map.set(p.invoiceId, current + applied);
      }

      if (p.otherInvoiceId && (p.appliedToOtherBill || 0) > 0) {
        const otherDiv = p.division === 'bakery' ? 'primary' : 'bakery';
        if (activeDivision === 'all' || activeDivision === otherDiv) {
          const current = map.get(p.otherInvoiceId) || 0;
          map.set(p.otherInvoiceId, current + (p.appliedToOtherBill || 0));
        }
      }
    }
    return map;
  }, [payments, activeDivision]);

  // Process orders respecting active division
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

      const creditApplied = activeDivision === 'all'
        ? (o.creditApplied || ((o.primaryCreditApplied || 0) + (o.bakeryCreditApplied || 0)))
        : (activeDivision === 'primary'
            ? (o.primaryCreditApplied || (o.division === 'primary' ? (o.creditApplied || 0) : 0))
            : (o.bakeryCreditApplied || (o.division === 'bakery' ? (o.creditApplied || 0) : 0)));

      const isPurelyThisDivision = activeDivision === 'all' || o.division === activeDivision || (o.items || []).every(item => {
        const prod = products.find(p => p.id === item.productId);
        return getProductDivision(prod || { name: item.productName }) === activeDivision;
      });

      const invoicePaid = invoicePaymentsMap.get(o.id) || 0;
      const effectivePaidAmount = (activeDivision === 'all' || isPurelyThisDivision)
        ? Math.max(invoicePaid, o.paidAmount || 0)
        : (o.paymentStatus === 'paid' ? total : invoicePaid);

      const netDue = Math.max(0, total - creditApplied);
      const isPaid = (o.paymentStatus === 'paid' && (activeDivision === 'all' || isPurelyThisDivision || netDue <= (effectivePaidAmount || 0))) || (netDue - effectivePaidAmount) <= 0.01;
      const pending = isPaid ? 0 : Math.max(0, netDue - effectivePaidAmount);
      const paid = isPaid ? netDue : effectivePaidAmount;

      const isDirect = o.orderType === 'direct' || o.clientId === 'direct';
      const client = isDirect ? null : clients.find(c => c.id === o.clientId);
      const region = isDirect ? 'Direct Sale' : (client?.region || o.region || '');

      return {
        ...o,
        items: itemsToProcess,
        total,
        paid,
        pending,
        isPaid,
        region,
      };
    }).filter(o => {
      if (activeDivision !== 'all' && o.items.length === 0) return false;
      return true;
    });
  }, [orders, products, activeDivision, invoicePaymentsMap, clients]);

  // 1. Today's/Selected Date's Bills
  const dateBills = useMemo(() => {
    return processedOrders
      .filter(o => o.deliveryDate === selectedDate)
      .filter(o => (filterRegion ? o.region === filterRegion : true))
      .filter(o => {
        if (!search) return true;
        const q = search.toLowerCase();
        const isDirect = o.orderType === 'direct' || o.clientId === 'direct';
        return (
          (isDirect && 'direct sale'.includes(q)) ||
          (o.clientName || '').toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q) ||
          (o.region || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.pending - a.pending);
  }, [processedOrders, selectedDate, filterRegion, search]);

  // 2. Pending Collections (Orders with pending balance > 0 across all time)
  const pendingOrders = useMemo(() => {
    return processedOrders
      .filter(o => !o.isPaid && o.pending > 0.01)
      .filter(o => (filterRegion ? o.region === filterRegion : true))
      .filter(o => {
        if (!search) return true;
        const q = search.toLowerCase();
        const isDirect = o.orderType === 'direct' || o.clientId === 'direct';
        return (
          (isDirect && 'direct sale'.includes(q)) ||
          (o.clientName || '').toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q) ||
          (o.region || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.pending - a.pending);
  }, [processedOrders, filterRegion, search]);

  // 3. My Collections (Payments strictly attributed to logged-in staff member)
  const myAttributedPayments = useMemo(() => {
    const uid = user?.uid;
    const name = user?.name;
    const displayName = user?.displayName;

    return validPayments.filter(p => {
      const matchesUid = Boolean(uid && p.staffId === uid);
      const matchesName = Boolean(name && (p.recordedBy === name || p.staffName === name || p.updatedBy === name));
      const matchesDisplay = Boolean(displayName && (p.recordedBy === displayName || p.staffName === displayName || p.updatedBy === displayName));
      return matchesUid || matchesName || matchesDisplay;
    });
  }, [validPayments, user]);

  // Filter My Collections by selected date range and search
  const filteredMyCollections = useMemo(() => {
    return myAttributedPayments
      .filter(p => {
        const pDate = (p.paymentDate || p.billDate || p.createdAt || '').substring(0, 10);
        if (myRangeFrom && pDate < myRangeFrom) return false;
        if (myRangeTo && pDate > myRangeTo) return false;
        return true;
      })
      .filter(p => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          (p.clientName || '').toLowerCase().includes(q) ||
          (p.reference || '').toLowerCase().includes(q) ||
          (p.notes || '').toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.createdAt || b.paymentDate || '').getTime() - new Date(a.createdAt || a.paymentDate || '').getTime());
  }, [myAttributedPayments, myRangeFrom, myRangeTo, search]);

  // Quick preset helper for My Collections
  const handleMyRangePreset = (preset: 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom') => {
    setMyRangePreset(preset);
    const today = new Date();
    if (preset === 'today') {
      const d = format(today, 'yyyy-MM-dd');
      setMyRangeFrom(d);
      setMyRangeTo(d);
    } else if (preset === 'yesterday') {
      const y = new Date(today);
      y.setDate(today.getDate() - 1);
      const d = format(y, 'yyyy-MM-dd');
      setMyRangeFrom(d);
      setMyRangeTo(d);
    } else if (preset === 'week') {
      const w = new Date(today);
      w.setDate(today.getDate() - 7);
      setMyRangeFrom(format(w, 'yyyy-MM-dd'));
      setMyRangeTo(format(today, 'yyyy-MM-dd'));
    } else if (preset === 'month') {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      setMyRangeFrom(format(startOfMonth, 'yyyy-MM-dd'));
      setMyRangeTo(format(today, 'yyyy-MM-dd'));
    } else if (preset === 'all') {
      setMyRangeFrom('');
      setMyRangeTo('');
    }
  };

  // Summary Metrics
  const myTodayCollectionTotal = useMemo(() => {
    return myAttributedPayments
      .filter(p => {
        const pDate = (p.paymentDate || p.billDate || p.createdAt || '').substring(0, 10);
        return pDate === todayStr;
      })
      .reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [myAttributedPayments, todayStr]);

  const myTodayReceiptsCount = useMemo(() => {
    return myAttributedPayments.filter(p => {
      const pDate = (p.paymentDate || p.billDate || p.createdAt || '').substring(0, 10);
      return pDate === todayStr;
    }).length;
  }, [myAttributedPayments, todayStr]);

  const myRangeCollectionTotal = useMemo(() => {
    return filteredMyCollections.reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [filteredMyCollections]);

  const myAllTimeCollectionTotal = useMemo(() => {
    return myAttributedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [myAttributedPayments]);

  // Export CSV for My Collections (Feature 3A)
  const handleExportCsv = () => {
    if (filteredMyCollections.length === 0) {
      toast.info('No collections to export for the selected period.');
      return;
    }

    const dateLabel =
      myRangePreset === 'today'
        ? myRangeFrom
        : myRangeFrom === myRangeTo
        ? myRangeFrom
        : `${myRangeFrom}_to_${myRangeTo}`;

    const staffName = user?.displayName || user?.name || 'Staff';

    const result = downloadStaffCollectionsCsv(filteredMyCollections, {
      dateLabel,
      divisionFilter: activeDivision,
      staffFilterLabel: staffName,
      filePrefix: `Staff_Collections_${staffName.replace(/[^a-zA-Z0-9]/g, '_')}`,
    });

    toast.success(
      `Exported ${result.recordCount} receipts (${formatCurrency(result.totalCollected)}).`
    );
  };

  const todayAllStaffCollections = useMemo(() => {
    return validPayments
      .filter(p => (p.paymentDate || p.billDate || p.createdAt || '').substring(0, 10) === todayStr)
      .reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [validPayments, todayStr]);

  const totalPendingAmount = useMemo(() => {
    return processedOrders.reduce((sum, o) => sum + o.pending, 0);
  }, [processedOrders]);

  // Clients with pending balance across divisions (opening balance + ledger debits - payments)
  const pendingClients = useMemo(() => {
    const activeClientsList = clients.filter(c => !c.deletedAt && c.status === 'active');
    return activeClientsList.map(c => {
      const metrics = getClientMetrics(c.id, activeDivision);
      const receivable = Math.max(0, metrics.outstanding);
      return {
        client: c,
        metrics,
        outstanding: receivable,
        region: c.region || c.city || '—',
      };
    }).filter(c => c.outstanding > 0.01)
      .filter(c => (filterRegion ? c.region === filterRegion : true))
      .filter(c => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          c.client.name.toLowerCase().includes(q) ||
          (c.client.phone || '').toLowerCase().includes(q) ||
          c.region.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [clients, ledger, orders, payments, activeDivision, filterRegion, search]);

  const totalOutstandingReceivables = useMemo(() => {
    return clients
      .filter(c => !c.deletedAt && c.status === 'active')
      .reduce((sum, c) => sum + Math.max(0, getClientOutstanding(c.id, activeDivision)), 0);
  }, [clients, ledger, orders, payments, activeDivision]);

  const uniqueRegions = useMemo(() => {
    const set = new Set<string>();
    clients.forEach(c => {
      if (c.region && !c.deletedAt) set.add(c.region);
    });
    return Array.from(set).sort();
  }, [clients]);

  const handleOpenPayment = (order: Order) => {
    setSelectedClientForPayment(null);
    setSelectedOrderForPayment(order);
    setPaymentModalOpen(true);
  };

  const handleOpenClientPayment = (client: Client) => {
    setSelectedOrderForPayment(null);
    setSelectedClientForPayment(client);
    setPaymentModalOpen(true);
  };

  const handlePrintOrder = (order: Order) => {
    const client = clients.find(c => c.id === order.clientId) || null;
    printOrderInvoice({ order, client, payments, products, ledger });
  };

  const handlePrintReceipt = (payment: Payment) => {
    const client = clients.find(c => c.id === payment.clientId) || null;
    printPaymentReceipt(payment, client);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 pb-16">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-[var(--color-primary)] uppercase tracking-wider bg-red-50 dark:bg-red-950/40 px-2.5 py-0.5 rounded-full border border-red-100 dark:border-red-900/30">
              Staff Portal
            </span>
            <span className="text-xs font-semibold text-gray-400">
              {activeDivision === 'all' ? 'All Divisions' : activeDivision === 'primary' ? 'Primary Foods' : 'Bakery Foods'}
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[var(--color-text-main)] tracking-tight mt-1">
            Payment & Collection
          </h1>
          <p className="text-xs font-medium text-[var(--color-text-muted)] mt-0.5">
            Collect pending balances, track daily bills, and review personal collection history.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            size="sm"
            variant="primary"
            icon={<CreditCard className="w-4 h-4" />}
            onClick={() => {
              setSelectedOrderForPayment(null);
              setSelectedClientForPayment(null);
              setPaymentModalOpen(true);
            }}
            className="text-xs h-9 shadow-sm shadow-red-500/20"
          >
            Collect Payment
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<ShoppingBag className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
            onClick={() => setDirectSaleModalOpen(true)}
            className="text-xs h-9"
          >
            Direct Sale
          </Button>
        </div>
      </div>

      {/* ── KPI Ribbon ── */}
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="p-3.5 sm:p-4 flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider truncate">
              Today's Collections
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums truncate">
              {formatCurrency(todayAllStaffCollections)}
            </p>
            <p className="text-[10px] text-gray-400 mt-1 truncate">All staff combined</p>
          </div>
        </Card>

        <Card className="p-3.5 sm:p-4 flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider truncate">
              Total Outstanding
            </span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400 tabular-nums truncate">
              {formatCurrency(totalOutstandingReceivables)}
            </p>
            <p className="text-[10px] text-gray-400 mt-1 truncate">
              {pendingClients.length} clients with balance
            </p>
          </div>
        </Card>

        <Card className="p-3.5 sm:p-4 flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider truncate">
              My Today Collection
            </span>
            <div className="w-7 h-7 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
              <UserCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xl sm:text-2xl font-black text-[var(--color-text-main)] tabular-nums truncate">
              {formatCurrency(myTodayCollectionTotal)}
            </p>
            <p className="text-[10px] text-gray-400 mt-1 truncate">Recorded by you today</p>
          </div>
        </Card>

        <Card className="p-3.5 sm:p-4 flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider truncate">
              My All-Time Total
            </span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xl sm:text-2xl font-black text-[var(--color-primary)] tabular-nums truncate">
              {formatCurrency(myAllTimeCollectionTotal)}
            </p>
            <p className="text-[10px] text-gray-400 mt-1 truncate">{myAttributedPayments.length} receipts total</p>
          </div>
        </Card>
      </div>

      {/* ── Workspace Tab Switcher ── */}
      <div className="w-full bg-gray-100/90 dark:bg-gray-800/80 p-1.5 rounded-2xl overflow-hidden">
        <div className="flex sm:grid sm:grid-cols-3 gap-2 overflow-x-auto no-scrollbar scroll-smooth overscroll-x-contain py-0.5 px-0.5">
          <button
            type="button"
            onClick={(e) => {
              setActiveTab('today');
              e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }}
            className={cn(
              'flex-none shrink-0 sm:flex-initial py-2.5 px-4 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center gap-2 whitespace-nowrap select-none',
              activeTab === 'today'
                ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-white/50 dark:hover:bg-gray-700/50'
            )}
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span className="shrink-0">Today's Bills</span>
            <span
              className={cn(
                'shrink-0 text-[10px] px-2 py-0.5 rounded-full font-bold tabular-nums',
                activeTab === 'today'
                  ? 'bg-red-100 dark:bg-red-950/60 text-[var(--color-primary)]'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              )}
            >
              {dateBills.length}
            </span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              setActiveTab('pending');
              e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }}
            className={cn(
              'flex-none shrink-0 sm:flex-initial py-2.5 px-4 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center gap-2 whitespace-nowrap select-none',
              activeTab === 'pending'
                ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-white/50 dark:hover:bg-gray-700/50'
            )}
          >
            <Clock className="w-4 h-4 shrink-0 text-amber-500" />
            <span className="shrink-0">Pending Collections</span>
            <span
              className={cn(
                'shrink-0 text-[10px] px-2 py-0.5 rounded-full font-bold tabular-nums',
                activeTab === 'pending'
                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              )}
            >
              {pendingOrders.length > 0 ? pendingOrders.length : pendingClients.length}
            </span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              setActiveTab('my_collections');
              e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }}
            className={cn(
              'flex-none shrink-0 sm:flex-initial py-2.5 px-4 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center gap-2 whitespace-nowrap select-none',
              activeTab === 'my_collections'
                ? 'bg-white dark:bg-gray-900 text-purple-600 dark:text-purple-400 shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-white/50 dark:hover:bg-gray-700/50'
            )}
          >
            <UserCheck className="w-4 h-4 shrink-0 text-purple-500" />
            <span className="shrink-0">My Collections</span>
            <span
              className={cn(
                'shrink-0 text-[10px] px-2 py-0.5 rounded-full font-bold tabular-nums',
                activeTab === 'my_collections'
                  ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              )}
            >
              {myTodayReceiptsCount}
            </span>
          </button>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Search box */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={
                activeTab === 'my_collections'
                  ? 'Search receipt reference, client...'
                  : 'Search shop name, order ID...'
              }
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>

          {/* Region filter (for today & pending tabs) */}
          {activeTab !== 'my_collections' ? (
            <div className="relative">
              <MapPin className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <select
                value={filterRegion}
                onChange={e => setFilterRegion(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
              >
                <option value="">All Regions ({uniqueRegions.length})</option>
                {uniqueRegions.map(r => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            /* My Collections Preset Selector */
            <div className="relative">
              <select
                value={myRangePreset}
                onChange={e => handleMyRangePreset(e.target.value as any)}
                className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all cursor-pointer"
              >
                <option value="today">Today's Collections</option>
                <option value="yesterday">Yesterday</option>
                <option value="week">Last 7 Days</option>
                <option value="month">This Month</option>
                <option value="all">All-Time Collections</option>
                <option value="custom">Custom Date Range...</option>
              </select>
            </div>
          )}

          {/* Date Picker */}
          {activeTab === 'today' ? (
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs font-bold rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all cursor-pointer"
              />
            </div>
          ) : activeTab === 'my_collections' && myRangePreset === 'custom' ? (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={myRangeFrom}
                onChange={e => setMyRangeFrom(e.target.value)}
                className="w-1/2 px-2 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)]"
              />
              <span className="text-xs text-gray-400">to</span>
              <input
                type="date"
                value={myRangeTo}
                onChange={e => setMyRangeTo(e.target.value)}
                className="w-1/2 px-2 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)]"
              />
            </div>
          ) : (
            <div className="text-right flex items-center justify-end text-xs font-bold text-gray-400 pr-2">
              Showing active records
            </div>
          )}
        </div>
      </Card>

      {/* ── Tab Content Views ── */}

      {/* TAB 1: Today's Bills */}
      {activeTab === 'today' && (
        <Card padding={false} className="overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-white/[0.05] flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-[var(--color-text-main)]">
                Bills for {format(new Date(selectedDate), 'dd MMMM yyyy')}
              </h3>
              <p className="text-xs font-medium text-[var(--color-text-muted)] mt-0.5">
                Orders scheduled for delivery on this date. Record payments directly or print/share bills.
              </p>
            </div>
          </div>

          {dateBills.length === 0 ? (
            <div className="p-16 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-bold text-[var(--color-text-main)]">No Bills for this Date</p>
              <p className="text-xs text-gray-400 mt-1">
                There are no orders scheduled for {format(new Date(selectedDate), 'dd MMM yyyy')}.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
              {dateBills.map(order => {
                const isDirect = order.orderType === 'direct' || order.clientId === 'direct';
                const isPaid = order.isPaid || order.pending <= 0.01;
                const isPartial = !isPaid && (order.paid > 0.01 || (order.paidAmount || 0) > 0.01);

                return (
                  <div
                    key={order.id}
                    className="p-3.5 sm:p-4 md:px-6 hover:bg-gray-50/70 dark:hover:bg-gray-900/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[var(--color-text-main)] truncate max-w-full">
                          {isDirect ? 'Direct Sale' : order.clientName}
                        </span>
                        <Badge variant={isDirect ? 'warning' : 'gray'} className="text-[10px] shrink-0">
                          {order.region || '—'}
                        </Badge>
                        <Badge variant={isPaid ? 'success' : isPartial ? 'warning' : 'danger'} className="text-[10px] shrink-0">
                          {isPaid ? 'Fully Paid' : isPartial ? 'Partial Paid' : 'Unpaid'}
                        </Badge>
                      </div>

                      <div className="mt-1 text-xs text-gray-400 font-medium">
                        <span>Items: </span>
                        <span className="text-gray-600 dark:text-gray-300">
                          {order.items.map(i => `${i.productName} (${i.qty})`).join(', ') || 'No items listed'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-gray-800/40">
                      <div className="text-left sm:text-right min-w-0">
                        <span className="text-[10px] text-gray-400 uppercase font-bold block truncate">
                          Total: {formatCurrency(order.total)}
                        </span>
                        <span
                          className={cn(
                            'text-base font-black tabular-nums truncate block',
                            isPaid
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          )}
                        >
                          {isPaid ? 'Paid' : `Due: ${formatCurrency(order.pending)}`}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          icon={<Printer className="w-3.5 h-3.5" />}
                          onClick={() => handlePrintOrder(order)}
                          className="text-xs h-8 px-2.5"
                        >
                          Bill
                        </Button>
                        {!isPaid && (
                          <Button
                            size="sm"
                            variant="primary"
                            icon={<CreditCard className="w-3.5 h-3.5" />}
                            onClick={() => handleOpenPayment(order)}
                            className="text-xs h-8 px-3"
                          >
                            Collect
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* TAB 2: Pending Collections */}
      {activeTab === 'pending' && (
        <Card padding={false} className="overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-white/[0.05] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-[var(--color-text-main)]">
                Pending Collections
              </h3>
              <p className="text-xs font-medium text-[var(--color-text-muted)] mt-0.5">
                Outstanding balances on client accounts and active bills.
              </p>
            </div>

            {/* Sub-tab switcher when both order bills and client balances exist */}
            {pendingOrders.length > 0 && pendingClients.length > 0 && (
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setPendingSubTab('bills')}
                  className={cn(
                    'px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5',
                    pendingSubTab === 'bills'
                      ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 shadow-xs'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
                  )}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Pending Orders ({pendingOrders.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPendingSubTab('clients')}
                  className={cn(
                    'px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5',
                    pendingSubTab === 'clients'
                      ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 shadow-xs'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
                  )}
                >
                  <span>Client Balances ({pendingClients.length})</span>
                </button>
              </div>
            )}
          </div>

          {pendingOrders.length === 0 && pendingClients.length === 0 ? (
            <div className="p-16 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-bold text-[var(--color-text-main)]">
                All Balances Fully Collected!
              </p>
              <p className="text-xs text-gray-400 mt-1">There are no pending balances on any active orders or client accounts.</p>
            </div>
          ) : (pendingSubTab === 'clients' || pendingOrders.length === 0) ? (
            /* View: Clients with Outstanding Balances */
            <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
              {pendingClients.map(({ client, metrics, outstanding, region }) => (
                <div
                  key={client.id}
                  className="p-3.5 sm:p-4 md:px-6 hover:bg-gray-50/70 dark:hover:bg-gray-900/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[var(--color-text-main)] truncate max-w-full">
                        {client.name}
                      </span>
                      <Badge variant="gray" className="text-[10px] shrink-0">
                        {region}
                      </Badge>
                      <span className="text-[11px] font-semibold text-gray-400 shrink-0">
                        {client.phone || `#${client.id.slice(0, 10)}`}
                      </span>
                    </div>

                    <div className="mt-1 text-xs text-gray-400 font-medium">
                      <span>Invoiced: </span>
                      <span className="text-gray-600 dark:text-gray-300 mr-2">{formatCurrency(metrics.totalInvoiced)}</span>
                      <span>Paid: </span>
                      <span className="text-emerald-600 dark:text-emerald-400">{formatCurrency(metrics.totalPaid)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-gray-800/40">
                    <div className="text-left sm:text-right min-w-0">
                      <span className="text-[10px] text-gray-400 uppercase font-bold block truncate">
                        Total Outstanding
                      </span>
                      <span className="text-base font-black text-amber-600 dark:text-amber-400 tabular-nums truncate block">
                        Due: {formatCurrency(outstanding)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<CreditCard className="w-3.5 h-3.5" />}
                        onClick={() => handleOpenClientPayment(client)}
                        className="text-xs h-8 px-3"
                      >
                        Collect
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* View: Pending Order Bills */
            <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
              {pendingOrders.map(order => {
                const isDirect = order.orderType === 'direct' || order.clientId === 'direct';

                return (
                  <div
                    key={order.id}
                    className="p-3.5 sm:p-4 md:px-6 hover:bg-gray-50/70 dark:hover:bg-gray-900/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[var(--color-text-main)] truncate max-w-full">
                          {isDirect ? 'Direct Sale' : order.clientName}
                        </span>
                        <Badge variant={isDirect ? 'warning' : 'gray'} className="text-[10px] shrink-0">
                          {order.region || '—'}
                        </Badge>
                        <span className="text-[11px] font-semibold text-gray-400 shrink-0">
                          Date: {format(new Date(order.deliveryDate), 'dd MMM yyyy')}
                        </span>
                      </div>

                      <div className="mt-1 text-xs text-gray-400 font-medium">
                        <span>Items: </span>
                        <span className="text-gray-600 dark:text-gray-300">
                          {order.items.map(i => `${i.productName} (${i.qty})`).join(', ') || 'Order items'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-gray-800/40">
                      <div className="text-left sm:text-right min-w-0">
                        <span className="text-[10px] text-gray-400 uppercase font-bold block truncate">
                          Total: {formatCurrency(order.total)} · Paid: {formatCurrency(order.paid)}
                        </span>
                        <span className="text-base font-black text-amber-600 dark:text-amber-400 tabular-nums truncate block">
                          Due: {formatCurrency(order.pending)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          icon={<Printer className="w-3.5 h-3.5" />}
                          onClick={() => handlePrintOrder(order)}
                          className="text-xs h-8 px-2.5"
                        >
                          Bill
                        </Button>
                        {!order.isPaid && (order.pending || 0) > 0.01 ? (
                          <Button
                            size="sm"
                            variant="primary"
                            icon={<CreditCard className="w-3.5 h-3.5" />}
                            onClick={() => handleOpenPayment(order)}
                            className="text-xs h-8 px-3"
                          >
                            Collect
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled
                            className="text-xs h-8 px-3 opacity-50 cursor-not-allowed text-emerald-600 dark:text-emerald-400"
                          >
                            Paid
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* TAB 3: My Collections */}
      {activeTab === 'my_collections' && (
        <Card padding={false} className="overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-white/[0.05] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[var(--color-text-main)]">
                  My Collection Report
                </h3>
                <Badge variant="purple" className="text-[10px]">
                  Attributed: {user?.displayName || user?.name || 'Logged-in Staff'}
                </Badge>
              </div>
              <p className="text-xs font-medium text-[var(--color-text-muted)] mt-0.5">
                Showing receipts collected specifically by you.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-left sm:text-right">
                <span className="text-xs font-semibold text-gray-400">Total for selected period:</span>
                <p className="text-xl font-black text-purple-600 dark:text-purple-400 tabular-nums">
                  {formatCurrency(myRangeCollectionTotal)}
                </p>
              </div>

              {filteredMyCollections.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Download className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />}
                  onClick={handleExportCsv}
                  title="Download My Collections as CSV"
                >
                  Download CSV
                </Button>
              )}
            </div>
          </div>

          {filteredMyCollections.length === 0 ? (
            <div className="p-16 text-center">
              <CheckCircle2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-[var(--color-text-main)]">No Collections in this Period</p>
              <p className="text-xs text-gray-400 mt-1">
                You haven't recorded any payments during the selected date range.
              </p>
            </div>
          ) : (
            <>
              {/* Mobile Card List (< sm) */}
              <div className="sm:hidden divide-y divide-gray-100 dark:divide-white/[0.04]">
                {filteredMyCollections.map(payment => {
                  const MethodIcon = methodIcon[payment.method] || Banknote;
                  const dateFormatted = payment.createdAt
                    ? format(new Date(payment.createdAt), 'MMM d, h:mm a')
                    : payment.paymentDate || '—';

                  return (
                    <div key={payment.id} className="p-3.5 hover:bg-gray-50/70 dark:hover:bg-gray-900/30 transition-colors flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-xs text-[var(--color-text-main)] truncate">
                            {payment.clientName}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-gray-400 flex-wrap">
                            <span>{payment.region || '—'}</span>
                            <span>·</span>
                            <span>{dateFormatted}</span>
                          </div>
                        </div>
                        <span className="font-black text-sm tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0">
                          {formatCurrency(payment.amount)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100 dark:border-gray-800/40 text-[11px]">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-gray-500 font-semibold uppercase text-[10px]">
                            <MethodIcon className="w-3 h-3 text-gray-400" />
                            {methodLabel[payment.method] || payment.method}
                          </span>
                          <span
                            className={cn(
                              'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded',
                              payment.division === 'bakery'
                                ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                                : 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                            )}
                          >
                            {payment.division}
                          </span>
                        </div>

                        <button
                          onClick={() => handlePrintReceipt(payment)}
                          title="Print Payment Voucher"
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-gray-600 hover:text-[var(--color-primary)] hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                        >
                          <Printer className="w-3.5 h-3.5" /> Voucher
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table (sm and up) */}
              <div className="hidden sm:block overflow-x-auto no-scrollbar">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50/80 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-left">
                      <th className="px-5 py-3.5">Date & Time</th>
                      <th className="px-4 py-3.5">Client / Shop</th>
                      <th className="px-4 py-3.5">Method</th>
                      <th className="px-4 py-3.5">Division</th>
                      <th className="px-4 py-3.5">Reference</th>
                      <th className="px-4 py-3.5 text-right">Amount</th>
                      <th className="px-5 py-3.5 text-right">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                    {filteredMyCollections.map(payment => {
                      const MethodIcon = methodIcon[payment.method] || Banknote;
                      const dateFormatted = payment.createdAt
                        ? format(new Date(payment.createdAt), 'MMM d, yyyy h:mm a')
                        : payment.paymentDate || '—';

                      return (
                        <tr key={payment.id} className="hover:bg-gray-50/70 dark:hover:bg-gray-800/30 transition-colors">
                          <td className="px-5 py-3.5 text-xs font-medium text-[var(--color-text-muted)] whitespace-nowrap">
                            {dateFormatted}
                          </td>
                          <td className="px-4 py-3.5">
                            <p className="font-bold text-xs text-[var(--color-text-main)]">
                              {payment.clientName}
                            </p>
                            <span className="text-[10px] text-gray-400">
                              {payment.region || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <MethodIcon className="w-3.5 h-3.5 text-gray-400" />
                              <span className="text-xs font-semibold uppercase">
                                {methodLabel[payment.method] || payment.method}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <span
                              className={cn(
                                'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded',
                                payment.division === 'bakery'
                                  ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                                  : 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                              )}
                            >
                              {payment.division}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-gray-500 font-mono">
                            {payment.reference || '—'}
                          </td>
                          <td className="px-4 py-3.5 text-right font-black text-sm tabular-nums text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(payment.amount)}
                          </td>
                          <td className="px-5 py-3.5 text-right whitespace-nowrap">
                            <button
                              onClick={() => handlePrintReceipt(payment)}
                              title="Print Payment Voucher"
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-gray-600 hover:text-[var(--color-primary)] hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                            >
                              <Printer className="w-3.5 h-3.5" /> Voucher
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}

      {/* Record Payment Modal */}
      <RecordPaymentModal
        isOpen={paymentModalOpen}
        onClose={() => {
          setPaymentModalOpen(false);
          setSelectedOrderForPayment(null);
          setSelectedClientForPayment(null);
        }}
        order={selectedOrderForPayment}
        client={selectedClientForPayment}
      />

      {/* Direct Sale Modal */}
      <DirectSaleModal
        isOpen={directSaleModalOpen}
        onClose={() => setDirectSaleModalOpen(false)}
      />
    </div>
  );
}
