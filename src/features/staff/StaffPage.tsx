import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, UserCheck, CreditCard, Search, Calendar, MapPin,
  Plus, CheckCircle2, Clock, Smartphone, Banknote, Building,
  ArrowRight, Shield, UserX, AlertCircle, RefreshCw, Eye
} from 'lucide-react';
import { format, isToday } from 'date-fns';
import { toast } from 'sonner';
import { useDataStore } from '../../stores/dataStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { type Payment, type PaymentMethod, type User, type Order } from '../../types';
import {
  subscribeToStaffMembers,
  createStaffAccount,
  updateStaffStatus
} from '../../services/staffService';
import { Button, Card, Badge, PageHeader, Avatar } from '../../components/ui';
import { formatCurrency, cn } from '../../lib/utils';
import { Link } from 'react-router-dom';

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

export default function StaffPage() {
  const { clients, orders, payments } = useDataStore();
  const { activeDivision } = useDivisionStore();

  const [staffList, setStaffList] = useState<User[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);

  // Active view tab
  const [currentTab, setCurrentTab] = useState<'payments' | 'staff'>('payments');

  // Filters
  const [selectedStaffFilter, setSelectedStaffFilter] = useState<string>('all');
  const [selectedRegionFilter, setSelectedRegionFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('');

  // Add staff modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [createError, setCreateError] = useState('');

  // Subscribe to registered staff members in Firestore
  useEffect(() => {
    setLoadingStaff(true);
    const unsub = subscribeToStaffMembers(
      (users) => {
        setStaffList(users);
        setLoadingStaff(false);
      },
      (err) => {
        console.error('Failed to load staff list:', err);
        setLoadingStaff(false);
      }
    );
    return () => unsub();
  }, []);

  // Map of client by ID for fast lookup
  const clientMap = useMemo(() => {
    const map = new Map<string, (typeof clients)[0]>();
    clients.forEach((c) => map.set(c.id, c));
    return map;
  }, [clients]);

  // Map of order by ID for fast lookup
  const orderMap = useMemo(() => {
    const map = new Map<string, Order>();
    orders.forEach((o) => map.set(o.id, o));
    return map;
  }, [orders]);

  // Filter payments by division & exclude trashed
  const validPayments = useMemo(() => {
    return payments.filter((p) => {
      if (p.deletedAt) return false;
      if (activeDivision !== 'all' && p.division && p.division !== activeDivision) {
        return false;
      }
      return true;
    });
  }, [payments, activeDivision]);

  // Helper to resolve staff name from payment record
  const getPaymentStaffName = (p: Payment): string => {
    return p.staffName || p.recordedBy || p.updatedBy || 'Staff';
  };

  // Helper to resolve staff ID from payment record
  const getPaymentStaffId = (p: Payment): string => {
    if (p.staffId) return p.staffId;
    const name = getPaymentStaffName(p).toLowerCase();
    const found = staffList.find((s) => s.name.toLowerCase() === name || s.displayName?.toLowerCase() === name);
    return found ? found.uid : name;
  };

  // Helper to resolve client region
  const getPaymentRegion = (p: Payment): string => {
    if (p.region) return p.region;
    const c = clientMap.get(p.clientId);
    return c?.region || '—';
  };

  // Helper to resolve client name
  const getPaymentClientName = (p: Payment): string => {
    if (p.clientName) return p.clientName;
    const c = clientMap.get(p.clientId);
    return c?.name || '—';
  };

  // Helper to resolve formatted payment date
  const getPaymentDate = (p: Payment): { raw: string; display: string } => {
    const raw = p.paymentDate || p.billDate || (p.createdAt ? p.createdAt.substring(0, 10) : '');
    if (!raw) return { raw: '', display: '—' };
    try {
      const d = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
      return { raw, display: format(d, 'dd MMM yyyy') };
    } catch {
      return { raw, display: raw };
    }
  };

  // Unique list of all staff names/identifiers across users and existing payments
  const allKnownStaff = useMemo(() => {
    const map = new Map<string, { id: string; name: string; email?: string }>();
    
    // Add registered staff users
    staffList.forEach((s) => {
      map.set(s.name.toLowerCase(), { id: s.uid, name: s.name, email: s.email });
    });

    // Add any recorded staff from payments
    validPayments.forEach((p) => {
      const sName = getPaymentStaffName(p);
      const key = sName.toLowerCase();
      if (!map.has(key)) {
        map.set(key, { id: p.staffId || key, name: sName });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [staffList, validPayments]);

  // Unique regions
  const uniqueRegions = useMemo(() => {
    const set = new Set<string>();
    clients.forEach((c) => {
      if (c.region && !c.deletedAt) set.add(c.region);
    });
    validPayments.forEach((p) => {
      if (p.region) set.add(p.region);
    });
    return Array.from(set).sort();
  }, [clients, validPayments]);

  // Filtered Payments List
  const filteredPayments = useMemo(() => {
    return validPayments
      .filter((p) => {
        const staffName = getPaymentStaffName(p);
        const staffId = getPaymentStaffId(p);
        const clientName = getPaymentClientName(p);
        const region = getPaymentRegion(p);
        const pDateInfo = getPaymentDate(p);

        // Staff filter
        if (selectedStaffFilter !== 'all') {
          const matchStaff =
            staffId === selectedStaffFilter ||
            staffName.toLowerCase() === selectedStaffFilter.toLowerCase();
          if (!matchStaff) return false;
        }

        // Region filter
        if (selectedRegionFilter !== 'all') {
          if (region.toLowerCase() !== selectedRegionFilter.toLowerCase()) return false;
        }

        // Date filter
        if (dateFilter) {
          if (pDateInfo.raw !== dateFilter && !p.createdAt?.startsWith(dateFilter)) {
            return false;
          }
        }

        // Search text
        if (search.trim()) {
          const q = search.toLowerCase();
          const match =
            staffName.toLowerCase().includes(q) ||
            clientName.toLowerCase().includes(q) ||
            region.toLowerCase().includes(q) ||
            (p.reference || '').toLowerCase().includes(q) ||
            (p.notes || '').toLowerCase().includes(q) ||
            (p.invoiceId || '').toLowerCase().includes(q);
          if (!match) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [
    validPayments,
    selectedStaffFilter,
    selectedRegionFilter,
    dateFilter,
    search,
    staffList,
    clientMap
  ]);

  // Aggregate Metrics
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const totalStaffCollectionsAmount = useMemo(() => {
    return validPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [validPayments]);

  const todayStaffCollectionsAmount = useMemo(() => {
    return validPayments
      .filter((p) => {
        const dateStr = p.paymentDate || p.billDate || (p.createdAt ? p.createdAt.substring(0, 10) : '');
        return dateStr === todayStr || (p.createdAt && p.createdAt.startsWith(todayStr));
      })
      .reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [validPayments, todayStr]);

  // Staff summary performance metrics (for cards / breakdown)
  const staffMetricsMap = useMemo(() => {
    const map = new Map<
      string,
      { totalAmount: number; todayAmount: number; count: number; lastPaymentDate?: string }
    >();

    validPayments.forEach((p) => {
      const sName = getPaymentStaffName(p).toLowerCase();
      const existing = map.get(sName) || {
        totalAmount: 0,
        todayAmount: 0,
        count: 0,
        lastPaymentDate: undefined,
      };

      const amt = p.amount || 0;
      const isTodayTx =
        (p.paymentDate && p.paymentDate === todayStr) ||
        (p.billDate && p.billDate === todayStr) ||
        (p.createdAt && p.createdAt.startsWith(todayStr));

      existing.totalAmount += amt;
      existing.count += 1;
      if (isTodayTx) existing.todayAmount += amt;

      const pDate = p.paymentDate || p.billDate || p.createdAt;
      if (
        pDate &&
        (!existing.lastPaymentDate ||
          new Date(pDate).getTime() > new Date(existing.lastPaymentDate).getTime())
      ) {
        existing.lastPaymentDate = pDate;
      }

      map.set(sName, existing);
    });

    return map;
  }, [validPayments, todayStr]);

  // Handle staff account creation
  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreatingStaff(true);

    try {
      await createStaffAccount({
        name: newStaffName,
        email: newStaffEmail,
        password: newStaffPassword,
        role: 'staff',
      });

      toast.success(`Staff account for ${newStaffName} created successfully!`);
      setAddModalOpen(false);
      setNewStaffName('');
      setNewStaffEmail('');
      setNewStaffPassword('');
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create staff account');
    } finally {
      setCreatingStaff(false);
    }
  };

  // Handle toggle active/inactive status
  const handleToggleStatus = async (user: User) => {
    const nextStatus = user.status === 'active' ? 'inactive' : 'active';
    try {
      await updateStaffStatus(user.uid, nextStatus);
      toast.success(
        `Staff member "${user.name}" marked as ${nextStatus.toUpperCase()}`
      );
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-16">
      {/* ── Page Header ── */}
      <PageHeader
        title="Staff Section"
        description="Monitor staff recorded payments, shop visits, and manage staff accounts."
        actions={
          <Button
            size="md"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => {
              setCreateError('');
              setAddModalOpen(true);
            }}
          >
            Add Staff Member
          </Button>
        }
      />

      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Total Staff Collections
            </p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {formatCurrency(totalStaffCollectionsAmount)}
            </p>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Today's Collections
            </p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">
              {formatCurrency(todayStaffCollectionsAmount)}
            </p>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Active Staff Members
            </p>
            <p className="text-2xl font-bold text-[var(--color-text-main)] tabular-nums">
              {staffList.filter((s) => s.status === 'active').length || allKnownStaff.length}
            </p>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/40 text-[var(--color-primary)] flex items-center justify-center shrink-0">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Staff Payments Recorded
            </p>
            <p className="text-2xl font-bold text-[var(--color-text-main)] tabular-nums">
              {validPayments.length}
            </p>
          </div>
        </Card>
      </div>

      {/* ── Tab Switcher: Payments vs Staff Accounts ── */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex p-1 bg-gray-100 dark:bg-gray-800/80 rounded-2xl shadow-xs">
          <button
            type="button"
            onClick={() => setCurrentTab('payments')}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2',
              currentTab === 'payments'
                ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
            )}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Staff Recorded Payments</span>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-bold',
                currentTab === 'payments'
                  ? 'bg-red-50 text-[var(--color-primary)] dark:bg-red-950/60'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              )}
            >
              {filteredPayments.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setCurrentTab('staff')}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2',
              currentTab === 'staff'
                ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
            )}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Staff Accounts & Performance</span>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-bold',
                currentTab === 'staff'
                  ? 'bg-red-50 text-[var(--color-primary)] dark:bg-red-950/60'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              )}
            >
              {allKnownStaff.length}
            </span>
          </button>
        </div>
      </div>

      {/* ── TAB 1: STAFF RECORDED PAYMENTS ── */}
      {currentTab === 'payments' && (
        <div className="space-y-6">
          {/* Quick Staff Filter Chips */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
            <button
              type="button"
              onClick={() => setSelectedStaffFilter('all')}
              className={cn(
                'px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap border flex items-center gap-1.5',
                selectedStaffFilter === 'all'
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-xs'
                  : 'bg-[var(--color-card)] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
              )}
            >
              All Staff
              <span className="opacity-75">({validPayments.length})</span>
            </button>

            {allKnownStaff.map((staff) => {
              const metrics = staffMetricsMap.get(staff.name.toLowerCase());
              const totalAmt = metrics ? metrics.totalAmount : 0;
              const isSelected =
                selectedStaffFilter === staff.id ||
                selectedStaffFilter.toLowerCase() === staff.name.toLowerCase();

              return (
                <button
                  key={staff.id || staff.name}
                  type="button"
                  onClick={() => setSelectedStaffFilter(isSelected ? 'all' : staff.name)}
                  className={cn(
                    'px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap border flex items-center gap-1.5',
                    isSelected
                      ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-xs'
                      : 'bg-[var(--color-card)] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
                  )}
                >
                  <span>{staff.name}</span>
                  <span
                    className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-md font-semibold',
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                    )}
                  >
                    {formatCurrency(totalAmt)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Filter Bar */}
          <Card className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search staff, shop, region, ref..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                />
              </div>

              {/* Staff Select */}
              <div className="relative">
                <Users className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <select
                  value={selectedStaffFilter}
                  onChange={(e) => setSelectedStaffFilter(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
                >
                  <option value="all">All Staff Members</option>
                  {allKnownStaff.map((s) => (
                    <option key={s.id || s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Region Select */}
              <div className="relative">
                <MapPin className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <select
                  value={selectedRegionFilter}
                  onChange={(e) => setSelectedRegionFilter(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
                >
                  <option value="all">All Regions</option>
                  {uniqueRegions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date Filter */}
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                />
              </div>
            </div>

            {(selectedStaffFilter !== 'all' ||
              selectedRegionFilter !== 'all' ||
              dateFilter ||
              search) && (
              <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-100 dark:border-gray-800 text-xs">
                <span className="text-gray-400 font-medium">
                  Showing {filteredPayments.length} of {validPayments.length} payments
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStaffFilter('all');
                    setSelectedRegionFilter('all');
                    setDateFilter('');
                    setSearch('');
                  }}
                  className="text-[var(--color-primary)] hover:underline font-semibold"
                >
                  Clear Filters
                </button>
              </div>
            )}
          </Card>

          {/* Payments Table */}
          {filteredPayments.length === 0 ? (
            <div className="text-center py-20 bg-[var(--color-card)] rounded-3xl border border-dashed border-gray-200 dark:border-gray-800">
              <CreditCard className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
              <h3 className="text-base font-bold text-[var(--color-text-main)]">
                No Payments Found
              </h3>
              <p className="text-xs font-medium text-gray-500 mt-1">
                No staff payment records matched your selected filters.
              </p>
            </div>
          ) : (
            <Card padding={false} className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50/80 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-left">
                      <th className="px-5 py-3.5">Staff Member</th>
                      <th className="px-5 py-3.5">Shop / Client</th>
                      <th className="px-4 py-3.5">Region</th>
                      <th className="px-4 py-3.5">Date</th>
                      <th className="px-5 py-3.5 text-right">Amount</th>
                      <th className="px-5 py-3.5">Payment & Order Details</th>
                      <th className="px-4 py-3.5 text-right">Summary Flow</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                    {filteredPayments.map((p) => {
                      const staffName = getPaymentStaffName(p);
                      const clientName = getPaymentClientName(p);
                      const region = getPaymentRegion(p);
                      const dateInfo = getPaymentDate(p);
                      const Icon = methodIcon[p.method] || Banknote;
                      const linkedOrder = p.invoiceId ? orderMap.get(p.invoiceId) : null;

                      return (
                        <tr
                          key={p.id}
                          className="hover:bg-gray-50/60 dark:hover:bg-gray-800/20 transition-colors"
                        >
                          {/* 1. Which staff recorded it */}
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <Avatar name={staffName} size="sm" />
                              <div>
                                <p className="font-bold text-xs text-[var(--color-text-main)]">
                                  {staffName}
                                </p>
                                <span className="text-[10px] font-medium text-gray-400 capitalize">
                                  Staff
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* 2. Which shop/client */}
                          <td className="px-5 py-3.5">
                            <Link
                              to={`/clients/${p.clientId}`}
                              className="font-bold text-xs text-[var(--color-text-main)] hover:text-[var(--color-primary)] transition-colors block"
                            >
                              {clientName}
                            </Link>
                            <span className="text-[10px] text-gray-400 font-mono">
                              #{p.id.slice(0, 8)}
                            </span>
                          </td>

                          {/* 3. Which region */}
                          <td className="px-4 py-3.5">
                            <Badge variant="gray">{region || '—'}</Badge>
                          </td>

                          {/* 4. Date */}
                          <td className="px-4 py-3.5 text-xs font-semibold text-[var(--color-text-muted)] whitespace-nowrap">
                            {dateInfo.display}
                          </td>

                          {/* 5. Amount */}
                          <td className="px-5 py-3.5 text-right font-extrabold text-sm tabular-nums text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                            {formatCurrency(p.amount)}
                          </td>

                          {/* 6. Payment & order details */}
                          <td className="px-5 py-3.5">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
                                  <Icon className="w-3 h-3 text-gray-400" />
                                  {methodLabel[p.method] || p.method}
                                </span>
                                {p.division && (
                                  <Badge
                                    variant={p.division === 'primary' ? 'info' : 'warning'}
                                  >
                                    {p.division}
                                  </Badge>
                                )}
                              </div>

                              {p.reference && (
                                <p className="text-[11px] text-gray-400 font-mono">
                                  Ref: {p.reference}
                                </p>
                              )}
                              {p.notes && (
                                <p className="text-[11px] text-gray-400 italic">
                                  "{p.notes}"
                                </p>
                              )}

                              {linkedOrder && (
                                <p className="text-[10px] font-medium text-gray-400">
                                  Order bill date:{' '}
                                  <strong className="text-gray-600 dark:text-gray-300">
                                    {format(new Date(linkedOrder.deliveryDate), 'dd MMM yyyy')}
                                  </strong>{' '}
                                  ({formatCurrency(linkedOrder.total)})
                                </p>
                              )}
                            </div>
                          </td>

                          {/* 7. Summary Flow badge: Anil → ABC Shop → Ernakulam → ₹5,000 → 05 Oct */}
                          <td className="px-4 py-3.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-gray-50 dark:bg-gray-800/80 border border-gray-100 dark:border-gray-800 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                              <span className="font-bold text-[var(--color-text-main)]">
                                {staffName}
                              </span>
                              <span className="text-gray-300 dark:text-gray-600">&rarr;</span>
                              <span className="truncate max-w-[100px]">{clientName}</span>
                              <span className="text-gray-300 dark:text-gray-600">&rarr;</span>
                              <span className="text-gray-400">{region}</span>
                              <span className="text-gray-300 dark:text-gray-600">&rarr;</span>
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                {formatCurrency(p.amount)}
                              </span>
                              <span className="text-gray-300 dark:text-gray-600">&rarr;</span>
                              <span className="text-gray-500">
                                {dateInfo.display.replace(/\s\d{4}$/, '')}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── TAB 2: STAFF DIRECTORY & PERFORMANCE ── */}
      {currentTab === 'staff' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {allKnownStaff.map((staff) => {
              const regUser = staffList.find((s) => s.name.toLowerCase() === staff.name.toLowerCase());
              const metrics = staffMetricsMap.get(staff.name.toLowerCase()) || {
                totalAmount: 0,
                todayAmount: 0,
                count: 0,
              };

              const isActive = regUser ? regUser.status === 'active' : true;

              return (
                <Card key={staff.id || staff.name} className="p-5 flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={staff.name} size="md" />
                        <div>
                          <h3 className="font-bold text-sm text-[var(--color-text-main)]">
                            {staff.name}
                          </h3>
                          <p className="text-xs text-[var(--color-text-muted)] truncate max-w-[180px]">
                            {staff.email || regUser?.email || 'Individual Staff Account'}
                          </p>
                        </div>
                      </div>

                      <Badge variant={isActive ? 'success' : 'danger'}>
                        {isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3 py-3 px-3.5 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800/60 text-center">
                      <div>
                        <p className="text-[10px] font-semibold uppercase text-gray-400">
                          Total Collections
                        </p>
                        <p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                          {formatCurrency(metrics.totalAmount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase text-gray-400">
                          Payments Logged
                        </p>
                        <p className="text-base font-extrabold text-[var(--color-text-main)] tabular-nums">
                          {metrics.count}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-4 mt-2 border-t border-gray-100 dark:border-gray-800">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStaffFilter(staff.name);
                        setCurrentTab('payments');
                      }}
                      className="text-xs font-bold text-[var(--color-primary)] hover:underline flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" /> View Recorded Payments
                    </button>

                    {regUser && (
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(regUser)}
                        className={cn(
                          'text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors',
                          isActive
                            ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40'
                            : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                        )}
                      >
                        {isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Modal: Add Staff Member ── */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--color-card)] rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col border border-gray-100 dark:border-gray-800">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/40">
              <div>
                <h3 className="text-base font-bold text-[var(--color-text-main)] flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-[var(--color-primary)]" />
                  Create Staff Account
                </h3>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Provisions individual login credentials for a staff member.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateStaff} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                  Staff Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Anil Kumar"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                  Login Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  placeholder="anil@dailyfresh.com"
                  value={newStaffEmail}
                  onChange={(e) => setNewStaffEmail(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                  Password <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  placeholder="Minimum 6 characters"
                  value={newStaffPassword}
                  onChange={(e) => setNewStaffPassword(e.target.value)}
                  minLength={6}
                  required
                  className="w-full px-3.5 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                />
              </div>

              {createError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                    {createError}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddModalOpen(false)}
                  disabled={creatingStaff}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={creatingStaff} disabled={creatingStaff}>
                  Create Staff Account
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
