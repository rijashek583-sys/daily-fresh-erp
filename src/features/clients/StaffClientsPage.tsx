import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Users,
  Search,
  MapPin,
  Calendar,
  Clock,
  TrendingUp,
  TrendingDown,
  Wallet,
  Printer,
  CreditCard,
  Phone,
} from 'lucide-react';
import { format } from 'date-fns';
import { useDataStore } from '../../stores/dataStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { getClientMetrics } from '../../lib/billing';
import { formatCurrency, cn } from '../../lib/utils';
import { Card, Button, Badge } from '../../components/ui';
import RecordPaymentModal from '../../components/payments/RecordPaymentModal';
import { printOrderInvoice, printClientStatement, printPaymentReceipt } from '../../lib/invoicePrint';
import { type Client, type Region, type Payment } from '../../types';

interface LedgerEntry {
  id: string;
  date: string;
  displayDate: string;
  type: 'invoice' | 'payment' | 'opening_balance';
  description: string;
  debit: number;
  credit: number;
  balance: number;
  division?: string;
  invoiceId?: string;
  paymentId?: string;
  paymentMethod?: string;
  recordedBy?: string;
  excessCredit?: number;
  creditApplied?: number;
  appliedAmount?: number;
  appliedToPrevious?: number;
}

export default function StaffClientsPage() {
  const { clients, regions, ledger, orders, payments, products } = useDataStore();
  const { activeDivision } = useDivisionStore();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<Region | ''>('');
  const [selectedClientId, setSelectedClientId] = useState<string>('');

  // Date filters for ledger statement
  const [datePreset, setDatePreset] = useState<'all' | 'this_month' | 'last_30' | 'custom'>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  // Payment modal state
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  // Auto-select client from URL param (e.g. ?client=ID or ?clientId=ID)
  useEffect(() => {
    const urlClient = searchParams.get('client') || searchParams.get('clientId') || searchParams.get('id');
    if (urlClient && clients.some(c => c.id === urlClient && !c.deletedAt)) {
      setSelectedClientId(urlClient);
    }
  }, [searchParams, clients]);

  const activeClients = useMemo(() => {
    return clients.filter(c => !c.deletedAt && c.status === 'active');
  }, [clients]);

  // Clients matching search and region
  const filteredClients = useMemo(() => {
    return activeClients.filter(c => {
      if (selectedRegion && c.region !== selectedRegion) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        (c.region || '').toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q)
      );
    });
  }, [activeClients, selectedRegion, searchQuery]);

  const selectedClient = useMemo(() => {
    return clients.find(c => c.id === selectedClientId && !c.deletedAt) || null;
  }, [clients, selectedClientId]);

  // Set date preset helpers
  const applyPreset = (preset: 'all' | 'this_month' | 'last_30' | 'custom') => {
    setDatePreset(preset);
    const today = new Date();
    if (preset === 'all') {
      setFromDate('');
      setToDate('');
    } else if (preset === 'this_month') {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      setFromDate(format(startOfMonth, 'yyyy-MM-dd'));
      setToDate(format(today, 'yyyy-MM-dd'));
    } else if (preset === 'last_30') {
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);
      setFromDate(format(thirtyDaysAgo, 'yyyy-MM-dd'));
      setToDate(format(today, 'yyyy-MM-dd'));
    }
  };

  // Client metrics (All-time)
  const clientMetrics = useMemo(() => {
    if (!selectedClient) return null;
    return getClientMetrics(selectedClient.id, activeDivision);
  }, [selectedClient, activeDivision]);

  // Client Ledger Entries (reusing existing ledger logic)
  const { ledgerEntries, periodDebit, periodCredit } = useMemo(() => {
    if (!selectedClient) {
      return { ledgerEntries: [], periodDebit: 0, periodCredit: 0 };
    }

    const clientLedger = ledger.filter(l => {
      if (l.clientId !== selectedClient.id) return false;
      if (activeDivision !== 'all') {
        const d = l.division;
        if (d && d !== 'all' && d !== activeDivision) return false;
      }
      return true;
    });

    // Map all raw entries
    const rawEntries: Omit<LedgerEntry, 'balance'>[] = clientLedger.map(l => {
      const rawDate = l.paymentDate || l.billDate || l.createdAt;
      const parsedDate = new Date(rawDate.length === 10 ? `${rawDate}T12:00:00` : rawDate);
      const isInvoice = l.type === 'invoice';
      const isOpening = l.type === 'opening_balance';
      const isPayment = l.type === 'payment';

      return {
        id: l.id,
        date: rawDate,
        displayDate: format(parsedDate, isInvoice || isOpening ? 'MMM d, yyyy' : 'MMM d, yyyy h:mm a'),
        type: l.type,
        description:
          l.description ||
          (isOpening
            ? 'Opening Balance'
            : isPayment
              ? `Payment received (${l.paymentMethod?.replace('_', ' ') || 'Cash'})`
              : 'Daily Bill'),
        debit: isInvoice || isOpening ? l.amount || 0 : 0,
        credit: isPayment ? l.amount || 0 : 0,
        division: l.division,
        invoiceId: l.invoiceId,
        paymentId: l.paymentId,
        paymentMethod: l.paymentMethod,
        recordedBy: l.recordedBy || l.staffName,
        excessCredit: l.excessCredit,
        creditApplied: l.creditApplied,
        appliedAmount: l.appliedAmount,
        appliedToPrevious: l.appliedToPrevious,
      };
    });

    // Sort chronologically ascending
    rawEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Calculate period opening balance if fromDate is set
    let periodOpening = 0;
    const filteredByDate: Omit<LedgerEntry, 'balance'>[] = [];

    for (const entry of rawEntries) {
      const entryDay = entry.date.substring(0, 10);
      if (fromDate && entryDay < fromDate) {
        periodOpening += entry.debit - entry.credit;
        continue;
      }
      if (toDate && entryDay > toDate) {
        continue;
      }
      filteredByDate.push(entry);
    }

    // Build final entries with running balance
    let runningBalance = periodOpening;
    let tDebit = 0;
    let tCredit = 0;

    const computedEntries: LedgerEntry[] = [];

    if (fromDate && periodOpening !== 0) {
      computedEntries.push({
        id: 'period-opening-balance',
        date: fromDate,
        displayDate: format(new Date(`${fromDate}T00:00:00`), 'MMM d, yyyy'),
        type: 'opening_balance',
        description: `Previous Balance as of ${format(new Date(`${fromDate}T00:00:00`), 'dd MMM yyyy')}`,
        debit: periodOpening > 0 ? periodOpening : 0,
        credit: periodOpening < 0 ? Math.abs(periodOpening) : 0,
        balance: periodOpening,
      });
    }

    for (const e of filteredByDate) {
      tDebit += e.debit;
      tCredit += e.credit;
      runningBalance += e.debit - e.credit;
      computedEntries.push({ ...e, balance: runningBalance });
    }

    return {
      ledgerEntries: computedEntries.reverse(),
      periodDebit: tDebit,
      periodCredit: tCredit,
      periodOpeningBalance: periodOpening,
      finalBalance: runningBalance,
    };
  }, [selectedClient, ledger, activeDivision, fromDate, toDate]);

  // Handle invoice print
  const handlePrintInvoice = (entry: LedgerEntry) => {
    const invId = entry.invoiceId || entry.id;
    const order = orders.find(o => o.id === invId);
    if (order) {
      printOrderInvoice({ order, client: selectedClient, payments, products, ledger });
    } else {
      // Create a fallback order representation from ledger entry
      const fallbackOrder = {
        id: invId,
        clientId: selectedClient?.id || '',
        clientName: selectedClient?.name || '',
        deliveryDate: entry.date.substring(0, 10),
        items: [{ productName: entry.description, qty: 1, unitPrice: entry.debit, total: entry.debit }],
        subtotal: entry.debit,
        tax: 0,
        total: entry.debit,
        createdAt: entry.date,
        updatedAt: entry.date,
      };
      printOrderInvoice({ order: fallbackOrder as any, client: selectedClient, payments, products, ledger });
    }
  };

  // Handle payment receipt print
  const handlePrintPaymentReceipt = (entry: LedgerEntry) => {
    const pId = entry.paymentId || entry.id;
    const payment = payments.find(p => p.id === pId) || {
      id: pId,
      clientId: selectedClient?.id || '',
      clientName: selectedClient?.name || '',
      region: selectedClient?.region || '',
      amount: entry.credit,
      method: (entry.paymentMethod || 'cash') as any,
      division: (entry.division || 'primary') as any,
      paymentDate: entry.date.substring(0, 10),
      createdAt: entry.date,
      recordedBy: entry.recordedBy,
    };
    printPaymentReceipt(payment as Payment, selectedClient);
  };

  // Handle statement print
  const handlePrintStatement = () => {
    if (!selectedClient || !clientMetrics) return;
    printClientStatement({
      client: selectedClient,
      entries: ledgerEntries,
      metrics: clientMetrics,
      division: activeDivision,
      dateRange: fromDate || toDate ? { from: fromDate, to: toDate } : undefined,
    });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16">
      {/* ── Section Title ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-[var(--color-text-main)] tracking-tight">
            Client Accounts & Ledger
          </h1>
          <p className="text-xs font-medium text-[var(--color-text-muted)] mt-0.5">
            Quickly look up client receivables, available advance credit, and statement history.
          </p>
        </div>

        {selectedClient && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button
              size="sm"
              variant="outline"
              icon={<Printer className="w-3.5 h-3.5" />}
              onClick={handlePrintStatement}
              className="text-xs h-9"
            >
              Print Statement
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<CreditCard className="w-3.5 h-3.5" />}
              onClick={() => setPaymentModalOpen(true)}
              className="text-xs h-9"
            >
              Collect Payment
            </Button>
          </div>
        )}
      </div>

      {/* ── Client Search & Selector Card ── */}
      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
          {/* Search box */}
          <div className="sm:col-span-5 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by shop/client name, phone, or region..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>

          {/* Region Filter */}
          <div className="sm:col-span-3 relative">
            <MapPin className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={selectedRegion}
              onChange={e => setSelectedRegion(e.target.value as Region)}
              className="w-full pl-9 pr-8 py-2.5 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
            >
              <option value="">All Regions ({regions.length})</option>
              {regions.map(r => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Client Dropdown */}
          <div className="sm:col-span-4 relative">
            <Users className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={selectedClientId}
              onChange={e => {
                setSelectedClientId(e.target.value);
                setSearchParams(e.target.value ? { client: e.target.value } : {});
              }}
              className="w-full pl-9 pr-8 py-2.5 text-xs font-bold rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
            >
              <option value="">
                {filteredClients.length === 0
                  ? 'No matching clients'
                  : `-- Select Client (${filteredClients.length}) --`}
              </option>
              {filteredClients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.region || '—'})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Quick matching pills if searching */}
        {searchQuery && filteredClients.length > 0 && !selectedClientId && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/[0.04] flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-semibold text-gray-400 mr-1">Suggested:</span>
            {filteredClients.slice(0, 6).map(c => (
              <button
                key={c.id}
                onClick={() => {
                  setSelectedClientId(c.id);
                  setSearchParams({ client: c.id });
                }}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-red-50 hover:text-[var(--color-primary)] dark:hover:bg-red-950/40 transition-colors"
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* ── Client Details & Statement Section ── */}
      {selectedClient && clientMetrics ? (
        <div className="space-y-6">
          {/* Client Header Info Banner */}
          <Card className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-red-500/5 via-transparent to-amber-500/5 border-red-500/10">
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center font-black text-lg shrink-0">
                {selectedClient.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-black text-[var(--color-text-main)] leading-tight">
                    {selectedClient.name}
                  </h2>
                  <Badge variant="gray" className="text-[10px]">
                    {selectedClient.region || '—'}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 font-medium">
                  {selectedClient.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3 text-gray-400" /> {selectedClient.phone}
                    </span>
                  )}
                  {selectedClient.address && <span>· {selectedClient.address}</span>}
                </div>
              </div>
            </div>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setSelectedClientId('');
                setSearchParams({});
              }}
              className="text-xs self-start sm:self-center"
            >
              Change Client
            </Button>
          </Card>

          {/* Outstanding & Available Credit Cards */}
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Outstanding Due */}
            <Card className="p-3.5 sm:p-5 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider truncate">
                  Outstanding Due
                </span>
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
              </div>
              <p className="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400 tabular-nums truncate">
                {formatCurrency(clientMetrics.outstanding)}
              </p>
              {activeDivision === 'all' && (
                <p className="text-[10px] text-gray-400 mt-1 truncate">
                  Primary: {formatCurrency(clientMetrics.primaryOutstanding)} · Bakery:{' '}
                  {formatCurrency(clientMetrics.bakeryOutstanding)}
                </p>
              )}
            </Card>

            {/* Available Credit */}
            <Card className="p-3.5 sm:p-5 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider truncate">
                  Available Credit
                </span>
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Wallet className="w-4 h-4" />
                </div>
              </div>
              <p className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums truncate">
                {formatCurrency(clientMetrics.credit)}
              </p>
              {activeDivision === 'all' && (
                <p className="text-[10px] text-gray-400 mt-1 truncate">
                  Primary: {formatCurrency(clientMetrics.primaryCredit)} · Bakery:{' '}
                  {formatCurrency(clientMetrics.bakeryCredit)}
                </p>
              )}
            </Card>

            {/* Total Invoiced */}
            <Card className="p-3.5 sm:p-5 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider truncate">
                  Total Invoiced
                </span>
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <p className="text-xl sm:text-2xl font-black text-[var(--color-text-main)] tabular-nums truncate">
                {formatCurrency(fromDate || toDate ? periodDebit : clientMetrics.totalInvoiced)}
              </p>
              <p className="text-[11px] font-semibold text-gray-400 mt-1 truncate">
                {fromDate || toDate ? 'In selected range' : 'All-time total'}
              </p>
            </Card>

            {/* Total Paid */}
            <Card className="p-3.5 sm:p-5 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider truncate">
                  Total Paid
                </span>
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400 flex items-center justify-center shrink-0">
                  <TrendingDown className="w-4 h-4" />
                </div>
              </div>
              <p className="text-xl sm:text-2xl font-black text-green-600 dark:text-green-400 tabular-nums truncate">
                {formatCurrency(fromDate || toDate ? periodCredit : clientMetrics.totalPaid)}
              </p>
              <p className="text-[11px] font-semibold text-gray-400 mt-1 truncate">
                {fromDate || toDate ? 'In selected range' : 'All-time total'}
              </p>
            </Card>
          </div>

          {/* ── Ledger Statement Table Card ── */}
          <Card padding={false} className="overflow-hidden">
            {/* Table Header & Date Filter Toolbar */}
            <div className="p-4 sm:p-6 border-b border-gray-100 dark:border-white/[0.05] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-[var(--color-text-main)]">
                    Account Statement & Ledger
                  </h3>
                  <p className="text-xs font-medium text-[var(--color-text-muted)] mt-0.5">
                    {activeDivision === 'all'
                      ? 'Combined Primary & Bakery Foods records'
                      : activeDivision === 'primary'
                        ? 'Primary Foods records only'
                        : 'Bakery Foods records only'}
                  </p>
                </div>

                {/* Date Preset Buttons */}
                <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl self-start sm:self-auto">
                  <button
                    onClick={() => applyPreset('all')}
                    className={cn(
                      'px-3 py-1 text-xs font-bold rounded-lg transition-all',
                      datePreset === 'all'
                        ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-xs'
                        : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                    )}
                  >
                    All-Time
                  </button>
                  <button
                    onClick={() => applyPreset('this_month')}
                    className={cn(
                      'px-3 py-1 text-xs font-bold rounded-lg transition-all',
                      datePreset === 'this_month'
                        ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-xs'
                        : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                    )}
                  >
                    This Month
                  </button>
                  <button
                    onClick={() => applyPreset('last_30')}
                    className={cn(
                      'px-3 py-1 text-xs font-bold rounded-lg transition-all',
                      datePreset === 'last_30'
                        ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-xs'
                        : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                    )}
                  >
                    Last 30 Days
                  </button>
                </div>
              </div>

              {/* Custom Date Range Inputs */}
              <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-100 dark:border-white/[0.04]">
                <span className="text-xs font-bold text-gray-500 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> Date Filter:
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={fromDate}
                    onChange={e => {
                      setFromDate(e.target.value);
                      setDatePreset('custom');
                    }}
                    className="px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] cursor-pointer"
                  />
                  <span className="text-xs text-gray-400">to</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={e => {
                      setToDate(e.target.value);
                      setDatePreset('custom');
                    }}
                    className="px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] cursor-pointer"
                  />
                  {(fromDate || toDate) && (
                    <button
                      onClick={() => applyPreset('all')}
                      className="text-xs text-red-600 hover:text-red-700 font-bold ml-1"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-left">
                    <th className="px-5 py-3.5">Date</th>
                    <th className="px-4 py-3.5">Type</th>
                    <th className="px-4 py-3.5">Description</th>
                    <th className="px-4 py-3.5 text-right">Debit</th>
                    <th className="px-4 py-3.5 text-right">Credit</th>
                    <th className="px-4 py-3.5 text-right">Balance</th>
                    <th className="px-5 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                  {ledgerEntries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-xs font-medium text-gray-500">
                        No transactions recorded for this client in the selected period.
                      </td>
                    </tr>
                  ) : (
                    ledgerEntries.map(entry => (
                      <tr
                        key={entry.id}
                        className={cn(
                          'hover:bg-gray-50/70 dark:hover:bg-gray-800/30 transition-colors',
                          entry.type === 'invoice'
                            ? ''
                            : entry.type === 'opening_balance'
                              ? 'bg-purple-50/20 dark:bg-purple-950/10'
                              : 'bg-emerald-50/10 dark:bg-emerald-950/10'
                        )}
                      >
                        <td className="px-5 py-3.5 text-xs font-medium text-[var(--color-text-muted)] whitespace-nowrap">
                          {entry.displayDate}
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge
                            variant={
                              entry.type === 'invoice'
                                ? 'info'
                                : entry.type === 'opening_balance'
                                  ? 'purple'
                                  : 'success'
                            }
                            className="text-[10px]"
                          >
                            {entry.type === 'invoice'
                              ? 'Invoice'
                              : entry.type === 'opening_balance'
                                ? 'Opening'
                                : 'Payment'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-[var(--color-text-main)]">
                              {entry.description}
                            </span>
                            {entry.division && entry.division !== 'all' && (
                              <span
                                className={cn(
                                  'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded',
                                  entry.division === 'bakery'
                                    ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                                    : 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                                )}
                              >
                                {entry.division}
                              </span>
                            )}
                          </div>
                          {entry.appliedToPrevious && entry.appliedToPrevious > 0 ? (
                            <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 block mt-0.5">
                              Applied to Previous: {formatCurrency(entry.appliedToPrevious)}
                            </span>
                          ) : null}
                          {entry.recordedBy && (
                            <span className="text-[10px] text-gray-400 block mt-0.5">
                              Recorded by: {entry.recordedBy}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold text-xs tabular-nums text-[var(--color-text-main)]">
                          {entry.debit > 0 ? formatCurrency(entry.debit) : '—'}
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                          {entry.credit > 0 ? formatCurrency(entry.credit) : '—'}
                        </td>
                        <td className="px-4 py-3.5 text-right font-bold text-xs tabular-nums">
                          <span
                            className={cn(
                              entry.balance > 0.01
                                ? 'text-amber-600 dark:text-amber-400'
                                : entry.balance < -0.01
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-gray-400'
                            )}
                          >
                            {entry.balance < -0.01
                              ? `${formatCurrency(Math.abs(entry.balance))} CR`
                              : formatCurrency(entry.balance)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          {entry.type === 'invoice' && (
                            <button
                              onClick={() => handlePrintInvoice(entry)}
                              title="Print/Share Invoice"
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors"
                            >
                              <Printer className="w-3.5 h-3.5" /> Print Bill
                            </button>
                          )}
                          {entry.type === 'payment' && (
                            <button
                              onClick={() => handlePrintPaymentReceipt(entry)}
                              title="Print Payment Receipt"
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg transition-colors"
                            >
                              <Printer className="w-3.5 h-3.5" /> Receipt
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : (
        /* Empty State: No Client Selected */
        <Card className="py-20 text-center flex flex-col items-center border-dashed border-gray-200 dark:border-gray-800">
          <div className="w-14 h-14 rounded-2xl bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-gray-400 mb-3">
            <Users className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-[var(--color-text-main)] mb-1">
            No Client Selected
          </h3>
          <p className="text-xs font-medium text-gray-500 max-w-sm">
            Use the search box or client dropdown above to select a client and inspect their ledger statement, outstanding balances, and historical bills.
          </p>
        </Card>
      )}

      {/* Record Payment Modal */}
      <RecordPaymentModal
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        client={selectedClient}
      />
    </div>
  );
}
