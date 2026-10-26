import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  FileText,
  Clock,
  CheckCircle2,
  Calendar,
  Wallet,
  Search,
  ChevronRight,
  UserCheck
} from 'lucide-react';
import { format } from 'date-fns';
import { useDataStore } from '../../stores/dataStore';
import { useAuthStore } from '../../stores/authStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { getClientOutstanding, getClientCredit, getClientMetrics, getPendingCollections } from '../../lib/billing';
import { formatCurrency, cn, getProductDivision } from '../../lib/utils';
import { Card, Button, Badge } from '../../components/ui';
import RecordPaymentModal from '../../components/payments/RecordPaymentModal';
import { type Client } from '../../types';

export default function StaffDashboard() {
  const { clients, orders, payments, products } = useDataStore();
  const { user } = useAuthStore();
  const { activeDivision } = useDivisionStore();
  const navigate = useNavigate();

  const [selectedDate, setSelectedDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [clientSearch, setClientSearch] = useState<string>('');

  // Payment modal state
  const [paymentClient, setPaymentClient] = useState<Client | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const activeClientsList = useMemo(() => {
    return clients.filter(c => !c.deletedAt && c.status === 'active');
  }, [clients]);

  // Today's Date String
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const isDateToday = selectedDate === todayStr;

  // 1. Today's/Selected Date's Bills & Orders
  const dateOrders = useMemo(() => {
    return orders.filter(o => {
      if (o.deliveryDate !== selectedDate) return false;
      if (activeDivision === 'all') return true;
      if (o.division && o.division === activeDivision) return true;
      const hasDivItem = (o.items || []).some(item => {
        const prod = products.find(p => p.id === item.productId);
        return getProductDivision(prod || { name: item.productName }) === activeDivision;
      });
      return hasDivItem;
    });
  }, [orders, selectedDate, activeDivision, products]);

  const dateTotalBilled = useMemo(() => {
    return dateOrders.reduce((sum, o) => {
      if (activeDivision === 'all') return sum + (o.total || 0);
      const divItems = (o.items || []).filter(item => {
        const prod = products.find(p => p.id === item.productId);
        return getProductDivision(prod || { name: item.productName }) === activeDivision;
      });
      return sum + divItems.reduce((iSum, i) => iSum + (i.total || i.qty * i.unitPrice || 0), 0);
    }, 0);
  }, [dateOrders, activeDivision, products]);

  // 2. Today's/Selected Date's Actual Payments Collected (all staff)
  const datePaymentsCollected = useMemo(() => {
    return payments
      .filter(p => {
        if (p.deletedAt) return false;
        if (activeDivision !== 'all' && p.division && p.division !== activeDivision) return false;
        const pDate = (p.paymentDate || p.billDate || p.createdAt || '').substring(0, 10);
        return pDate === selectedDate;
      })
      .reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [payments, selectedDate, activeDivision]);

  // 3. Today's/Selected Date's Pending/Uncollected Bill Amount (using existing accounting logic)
  const pendingCollectionData = useMemo(() => {
    return getPendingCollections(activeDivision, selectedDate, activeClientsList);
  }, [activeDivision, selectedDate, activeClientsList]);

  // 4. All-Time Total Outstanding Amount (Money owed to business)
  const allTimeOutstanding = useMemo(() => {
    return activeClientsList.reduce((sum, c) => sum + Math.max(0, getClientOutstanding(c.id, activeDivision)), 0);
  }, [activeClientsList, activeDivision]);

  // 5. Total Available Client Credit (Advance payments / negative balance, kept strictly separate)
  const allTimeCredit = useMemo(() => {
    return activeClientsList.reduce((sum, c) => sum + getClientCredit(c.id, activeDivision), 0);
  }, [activeClientsList, activeDivision]);

  // 6. Logged-in Staff Member's Collection Tracking
  const staffPayments = useMemo(() => {
    const uid = user?.uid;
    const name = user?.name;
    const displayName = user?.displayName;

    return payments.filter(p => {
      if (p.deletedAt) return false;
      if (activeDivision !== 'all' && p.division && p.division !== activeDivision) return false;

      // Attribution model: match staffId or exact recorded/staff name
      const matchesUid = Boolean(uid && p.staffId === uid);
      const matchesName = Boolean(name && (p.recordedBy === name || p.staffName === name || p.updatedBy === name));
      const matchesDisplay = Boolean(displayName && (p.recordedBy === displayName || p.staffName === displayName || p.updatedBy === displayName));

      return matchesUid || matchesName || matchesDisplay;
    });
  }, [payments, user, activeDivision]);

  const staffDailyCollection = useMemo(() => {
    return staffPayments
      .filter(p => {
        const pDate = (p.paymentDate || p.billDate || p.createdAt || '').substring(0, 10);
        return pDate === selectedDate;
      })
      .reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [staffPayments, selectedDate]);

  const staffAllTimeCollection = useMemo(() => {
    return staffPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [staffPayments]);

  // 7. Highest Outstanding Clients Ranking with Oldest Pending Bill Date
  const rankedClients = useMemo(() => {
    const rows = activeClientsList
      .map(c => {
        const metrics = getClientMetrics(c.id, activeDivision);
        const outstanding = Math.max(0, metrics.outstanding);
        const credit = metrics.credit;

        if (outstanding <= 0.01) return null;

        // Find oldest pending bill date
        const clientOrders = orders
          .filter(o => {
            if (o.clientId !== c.id) return false;
            if (activeDivision === 'all') return true;
            if (o.division && o.division === activeDivision) return true;
            return (o.items || []).some(item => {
              const p = products.find(prod => prod.id === item.productId);
              return getProductDivision(p || { name: item.productName }) === activeDivision;
            });
          })
          .sort((a, b) => new Date(a.deliveryDate || a.createdAt).getTime() - new Date(b.deliveryDate || b.createdAt).getTime());

        let oldestPendingDate: string | null = null;
        for (const ord of clientOrders) {
          const ordPayments = payments.filter(p => !p.deletedAt && p.invoiceId === ord.id);
          const paidOnOrd = Math.max(
            ordPayments.reduce((sum, p) => sum + (p.appliedAmount !== undefined ? p.appliedAmount : (p.amount || 0)), 0),
            ord.paidAmount || 0
          );
          const creditApplied = ord.creditApplied || ((ord.primaryCreditApplied || 0) + (ord.bakeryCreditApplied || 0));
          const net = Math.max(0, (ord.total || 0) - creditApplied);
          const isOrdPaid = ord.paymentStatus === 'paid' || (net - paidOnOrd) <= 0.01;
          if (!isOrdPaid && net - paidOnOrd > 0.01) {
            oldestPendingDate = ord.deliveryDate || ord.createdAt;
            break;
          }
        }

        if (!oldestPendingDate && metrics.openingBalance > 0 && c.openingBalance?.asOfDate) {
          oldestPendingDate = c.openingBalance.asOfDate;
        }

        return {
          client: c,
          id: c.id,
          name: c.name,
          region: c.region || c.city || '—',
          phone: c.phone || '',
          outstanding,
          credit,
          oldestPendingDate,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Sort from HIGHEST outstanding to LOWEST net outstanding
    rows.sort((a, b) => b.outstanding - a.outstanding);

    return rows;
  }, [activeClientsList, activeDivision, orders, payments, products]);

  // Filter ranked clients by search
  const filteredRankedClients = useMemo(() => {
    if (!clientSearch.trim()) return rankedClients;
    const q = clientSearch.toLowerCase();
    return rankedClients.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.region.toLowerCase().includes(q) ||
      r.phone.includes(q)
    );
  }, [rankedClients, clientSearch]);

  const handleOpenClientLedger = (clientId: string) => {
    // Navigates to the Clients section with client preselected
    navigate(`/clients?client=${clientId}`);
  };

  const handleCollect = (client: Client, e: React.MouseEvent) => {
    e.stopPropagation();
    setPaymentClient(client);
    setPaymentModalOpen(true);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 pb-12">
      {/* ── Header & Greeting ── */}
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
            Hello, {user?.displayName || user?.name || 'Staff Member'} 👋
          </h1>
          <p className="text-xs font-medium text-[var(--color-text-muted)] mt-0.5">
            Prioritize your daily billing and client collections.
          </p>
        </div>

        {/* Date Filter */}
        <div className="flex items-center gap-2 self-start sm:self-auto bg-white dark:bg-gray-900 p-1.5 rounded-2xl border border-gray-200/80 dark:border-white/[0.08] shadow-xs">
          <Calendar className="w-4 h-4 text-gray-400 ml-2 shrink-0" />
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="text-xs font-bold bg-transparent text-[var(--color-text-main)] outline-none pr-2 py-1 cursor-pointer"
          />
          {!isDateToday && (
            <button
              onClick={() => setSelectedDate(todayStr)}
              className="text-[11px] font-bold px-2.5 py-1 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-[var(--color-primary)] transition-colors shrink-0"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* ── KPI Grid ── */}
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Today's Bills */}
        <Card className="flex flex-col justify-between p-3.5 sm:p-4 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2 sm:mb-3">
            <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider truncate">
              {isDateToday ? "Today's Bills" : "Selected Date Bills"}
            </span>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xl sm:text-2xl font-black text-[var(--color-text-main)] tabular-nums truncate">
              {formatCurrency(dateTotalBilled)}
            </p>
            <p className="text-[11px] font-semibold text-gray-400 mt-1 truncate">
              {dateOrders.length} {dateOrders.length === 1 ? 'bill generated' : 'bills generated'}
            </p>
          </div>
        </Card>

        {/* Today's Payments Collected */}
        <Card className="flex flex-col justify-between p-3.5 sm:p-4 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2 sm:mb-3">
            <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider truncate">
              {isDateToday ? "Today's Collections" : "Date Collections"}
            </span>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums truncate">
              {formatCurrency(datePaymentsCollected)}
            </p>
            <p className="text-[11px] font-semibold text-emerald-600/80 dark:text-emerald-400/80 mt-1 truncate">
              Actual collected
            </p>
          </div>
        </Card>

        {/* Today's Pending Amount */}
        <Card className="flex flex-col justify-between p-3.5 sm:p-4 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2 sm:mb-3">
            <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider truncate">
              {isDateToday ? "Today's Pending" : "Date Pending"}
            </span>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400 tabular-nums truncate">
              {formatCurrency(pendingCollectionData.totalPending)}
            </p>
            <p className="text-[11px] font-semibold text-amber-600/80 dark:text-amber-400/80 mt-1 truncate">
              {pendingCollectionData.rows.length} pending today
            </p>
          </div>
        </Card>

        {/* All-Time Outstanding */}
        <Card className="flex flex-col justify-between p-3.5 sm:p-4 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2 sm:mb-3">
            <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider truncate">
              Total Outstanding
            </span>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-red-50 dark:bg-red-950/40 text-[var(--color-primary)] flex items-center justify-center shrink-0">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xl sm:text-2xl font-black text-[var(--color-primary)] tabular-nums truncate">
              {formatCurrency(allTimeOutstanding)}
            </p>
            <p className="text-[11px] font-semibold text-gray-400 mt-1 truncate">
              All clients combined
            </p>
          </div>
        </Card>
      </div>

      {/* ── Available Credit & My Collections Banner ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {/* Available Credit Box */}
        <Card className="flex items-center justify-between p-3.5 sm:p-5 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 border-emerald-500/20">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider truncate">
                Available Client Credit
              </p>
              <p className="text-lg sm:text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5 truncate">
                {formatCurrency(allTimeCredit)}
              </p>
            </div>
          </div>
          <Badge variant="success" className="text-[10px] shrink-0">
            Advance Held
          </Badge>
        </Card>

        {/* My Collections Box */}
        <Card className="flex items-center justify-between p-3.5 sm:p-5 bg-gradient-to-br from-purple-500/5 to-indigo-500/5 border-purple-500/20">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider truncate">
                My Collections
              </p>
              <div className="flex items-baseline gap-1.5 sm:gap-2 mt-0.5 flex-wrap">
                <span className="text-lg sm:text-xl font-black text-[var(--color-text-main)] tabular-nums">
                  {formatCurrency(staffDailyCollection)}
                </span>
                <span className="text-[10px] sm:text-[11px] font-semibold text-gray-400">
                  today · {formatCurrency(staffAllTimeCollection)} total
                </span>
              </div>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate('/payments')}
            className="text-xs h-8 shrink-0 ml-2"
          >
            My Details
          </Button>
        </Card>
      </div>

      {/* ── Highest Outstanding Clients ── */}
      <Card padding={false} className="overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-gray-100 dark:border-white/[0.05] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--color-text-main)] tracking-tight">
              Highest Outstanding Clients
            </h2>
            <p className="text-xs font-medium text-[var(--color-text-muted)] mt-0.5">
              Ranked from highest to lowest net outstanding balance. Tap any client to view their ledger.
            </p>
          </div>

          {/* Client Search */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search client or region..."
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>
        </div>

        {filteredRankedClients.length === 0 ? (
          <div className="p-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-bold text-[var(--color-text-main)]">
              {clientSearch ? 'No clients match your search' : 'No Outstanding Balances!'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {clientSearch ? 'Try clearing your search query.' : 'All client accounts are currently clear.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
            {filteredRankedClients.map((row, idx) => (
              <div
                key={row.id}
                onClick={() => handleOpenClientLedger(row.id)}
                className="p-3.5 sm:p-4 md:px-6 hover:bg-gray-50/80 dark:hover:bg-gray-900/40 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
              >
                {/* Client Info */}
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-7 h-7 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs font-black text-gray-500 shrink-0 mt-0.5">
                    {idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[var(--color-text-main)] group-hover:text-[var(--color-primary)] transition-colors truncate">
                        {row.name}
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 shrink-0">
                        {row.region}
                      </span>
                      {row.credit > 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40 shrink-0">
                          +{formatCurrency(row.credit)} Credit
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                      {row.oldestPendingDate ? (
                        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium text-[11px]">
                          <Clock className="w-3 h-3 shrink-0" /> Oldest pending:{' '}
                          {format(new Date(row.oldestPendingDate), 'dd MMM yyyy')}
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400">Balance from previous records</span>
                      )}
                      {row.phone && (
                        <span className="hidden sm:inline text-[11px] text-gray-400">
                          · {row.phone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Outstanding & Quick Action */}
                <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-gray-800/40">
                  <div className="text-left sm:text-right min-w-0">
                    <span className="text-[10px] font-medium text-gray-400 block sm:hidden uppercase">Outstanding:</span>
                    <span className="text-base font-black text-amber-600 dark:text-amber-400 tabular-nums">
                      {formatCurrency(row.outstanding)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={(e) => handleCollect(row.client, e)}
                      className="text-xs h-8 px-3"
                    >
                      Collect
                    </Button>
                    <ChevronRight className="w-4 h-4 text-gray-400 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Record Payment Modal */}
      <RecordPaymentModal
        isOpen={paymentModalOpen}
        onClose={() => {
          setPaymentModalOpen(false);
          setPaymentClient(null);
        }}
        client={paymentClient}
      />
    </div>
  );
}
