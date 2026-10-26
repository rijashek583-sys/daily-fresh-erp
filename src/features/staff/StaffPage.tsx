import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, UserCheck, CreditCard, Search, Calendar, MapPin,
  Plus, CheckCircle2, Clock, Smartphone, Banknote, Building,
  ArrowRight, Shield, UserX, AlertCircle, RefreshCw, Eye,
  KeyRound, EyeOff, CalendarRange, Filter, BarChart3, ChevronDown,
  ChevronUp, Layers, Download
} from 'lucide-react';
import { format, subDays, startOfMonth } from 'date-fns';
import { toast } from 'sonner';
import { useDataStore } from '../../stores/dataStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { type Payment, type PaymentMethod, type User, type Order } from '../../types';
import {
  subscribeToStaffMembers,
  createStaffAccount,
  updateStaffStatus,
  resetStaffPassword
} from '../../services/staffService';
import { Button, Card, Badge, PageHeader, Avatar } from '../../components/ui';
import { formatCurrency, cn } from '../../lib/utils';
import { downloadStaffCollectionsCsv } from '../../lib/csvExport';
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

  // Active view tab: payments | performance | staff
  const [currentTab, setCurrentTab] = useState<'payments' | 'performance' | 'staff'>('payments');

  // Filters
  const [selectedStaffFilter, setSelectedStaffFilter] = useState<string>('all');
  const [selectedRegionFilter, setSelectedRegionFilter] = useState<string>('all');
  const [selectedDivisionFilter, setSelectedDivisionFilter] = useState<'all' | 'primary' | 'bakery'>('all');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'all' | 'client' | 'direct'>('all');
  const [search, setSearch] = useState<string>('');

  // Date Filters: Single Date vs Date Range
  const [dateMode, setDateMode] = useState<'all' | 'single' | 'range'>('all');
  const [singleDate, setSingleDate] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [showDailyBreakdown, setShowDailyBreakdown] = useState<boolean>(false);

  // Add staff modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [createError, setCreateError] = useState('');

  // Reset password modal state
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [selectedStaffForPassword, setSelectedStaffForPassword] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState('');

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

  // Filter payments by activeDivision store & exclude trashed records
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
    if (p.orderType === 'direct' || p.clientId === 'direct') return 'Direct Sale / —';
    if (p.region) return p.region;
    const c = clientMap.get(p.clientId);
    return c?.region || '—';
  };

  // Helper to resolve client name
  const getPaymentClientName = (p: Payment): string => {
    if (p.orderType === 'direct' || p.clientId === 'direct') return 'Direct Sale';
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
      return { raw: raw.substring(0, 10), display: format(d, 'dd MMM yyyy') };
    } catch {
      return { raw: raw.substring(0, 10), display: raw };
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
      if (p.region && p.region !== 'Direct Sale') set.add(p.region);
    });
    return Array.from(set).sort();
  }, [clients, validPayments]);

  // Helper to check if payment matches date filter
  const isDateMatch = (rawDate: string): boolean => {
    if (dateMode === 'single') {
      if (!singleDate) return true;
      return rawDate === singleDate;
    }
    if (dateMode === 'range') {
      if (dateFrom && rawDate < dateFrom) return false;
      if (dateTo && rawDate > dateTo) return false;
      return true;
    }
    return true;
  };

  // Filtered Payments List
  const filteredPayments = useMemo(() => {
    return validPayments
      .filter((p) => {
        const staffName = getPaymentStaffName(p);
        const staffId = getPaymentStaffId(p);
        const clientName = getPaymentClientName(p);
        const region = getPaymentRegion(p);
        const pDateInfo = getPaymentDate(p);

        // Division filter
        if (selectedDivisionFilter !== 'all') {
          const div = p.division === 'bakery' ? 'bakery' : 'primary';
          if (div !== selectedDivisionFilter) return false;
        }

        // Order type filter
        if (selectedTypeFilter !== 'all') {
          const isDirect = p.orderType === 'direct' || p.clientId === 'direct';
          if (selectedTypeFilter === 'direct' && !isDirect) return false;
          if (selectedTypeFilter === 'client' && isDirect) return false;
        }

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
        const rawDate = pDateInfo.raw || (p.createdAt ? p.createdAt.substring(0, 10) : '');
        if (!isDateMatch(rawDate)) {
          return false;
        }

        // Search text
        if (search.trim()) {
          const q = search.toLowerCase();
          const isDirect = p.orderType === 'direct' || p.clientId === 'direct';
          const match =
            (isDirect && 'direct sale'.includes(q)) ||
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
    selectedDivisionFilter,
    selectedTypeFilter,
    selectedStaffFilter,
    selectedRegionFilter,
    dateMode,
    singleDate,
    dateFrom,
    dateTo,
    search,
    staffList,
    clientMap
  ]);

  // Aggregate Metrics
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // 1. Today's collections and payments across all staff
  const todayPayments = useMemo(() => {
    return validPayments.filter((p) => {
      const dateStr = p.paymentDate || p.billDate || (p.createdAt ? p.createdAt.substring(0, 10) : '');
      return dateStr === todayStr || (p.createdAt && p.createdAt.startsWith(todayStr));
    });
  }, [validPayments, todayStr]);

  const todayStaffCollectionsAmount = useMemo(() => {
    return todayPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [todayPayments]);

  const todayPaymentsCount = todayPayments.length;

  // 2. All-time total collections and payments across all staff
  const totalStaffCollectionsAmount = useMemo(() => {
    return validPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [validPayments]);

  const allTimePaymentsCount = validPayments.length;

  // 3. Filtered collection amounts
  const filteredTotalAmount = useMemo(() => {
    return filteredPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [filteredPayments]);

  const filteredPrimaryAmount = useMemo(() => {
    return filteredPayments
      .filter((p) => p.division !== 'bakery')
      .reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [filteredPayments]);

  const filteredBakeryAmount = useMemo(() => {
    return filteredPayments
      .filter((p) => p.division === 'bakery')
      .reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [filteredPayments]);

  // 4. Staff-wise metrics (Daily & All-time totals, payment counts, division breakdown)
  const staffMetricsMap = useMemo(() => {
    const map = new Map<
      string,
      {
        totalAmount: number;
        totalCount: number;
        todayAmount: number;
        todayCount: number;
        primaryAmount: number;
        bakeryAmount: number;
        lastPaymentDate?: string;
      }
    >();

    validPayments.forEach((p) => {
      const sName = getPaymentStaffName(p).toLowerCase();
      const existing = map.get(sName) || {
        totalAmount: 0,
        totalCount: 0,
        todayAmount: 0,
        todayCount: 0,
        primaryAmount: 0,
        bakeryAmount: 0,
        lastPaymentDate: undefined,
      };

      const amt = p.amount || 0;
      const rawDate = p.paymentDate || p.billDate || (p.createdAt ? p.createdAt.substring(0, 10) : '');
      const isTodayTx = rawDate === todayStr || (p.createdAt && p.createdAt.startsWith(todayStr));

      existing.totalAmount += amt;
      existing.totalCount += 1;
      if (isTodayTx) {
        existing.todayAmount += amt;
        existing.todayCount += 1;
      }

      if (p.division === 'bakery') {
        existing.bakeryAmount += amt;
      } else {
        existing.primaryAmount += amt;
      }

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

  // 5. Date-wise Daily Aggregate Breakdown (within the active filters)
  const dateWiseBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        date: string;
        displayDate: string;
        count: number;
        totalAmount: number;
        primaryAmount: number;
        bakeryAmount: number;
        staffSet: Set<string>;
      }
    >();

    filteredPayments.forEach((p) => {
      const rawDate = (p.paymentDate || p.billDate || (p.createdAt ? p.createdAt.substring(0, 10) : '')).substring(0, 10);
      const dateInfo = getPaymentDate(p);
      const existing = map.get(rawDate) || {
        date: rawDate,
        displayDate: dateInfo.display,
        count: 0,
        totalAmount: 0,
        primaryAmount: 0,
        bakeryAmount: 0,
        staffSet: new Set<string>(),
      };

      existing.count += 1;
      existing.totalAmount += (p.amount || 0);
      if (p.division === 'bakery') {
        existing.bakeryAmount += (p.amount || 0);
      } else {
        existing.primaryAmount += (p.amount || 0);
      }
      existing.staffSet.add(getPaymentStaffName(p));
      map.set(rawDate, existing);
    });

    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredPayments]);

  // Date preset helper functions
  const handleSetPreset = (preset: 'all' | 'today' | 'yesterday' | 'last7' | 'thisMonth') => {
    if (preset === 'all') {
      setDateMode('all');
      setSingleDate('');
      setDateFrom('');
      setDateTo('');
    } else if (preset === 'today') {
      setDateMode('single');
      setSingleDate(todayStr);
      setDateFrom('');
      setDateTo('');
    } else if (preset === 'yesterday') {
      const yDate = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      setDateMode('single');
      setSingleDate(yDate);
      setDateFrom('');
      setDateTo('');
    } else if (preset === 'last7') {
      const start7 = format(subDays(new Date(), 6), 'yyyy-MM-dd');
      setDateMode('range');
      setDateFrom(start7);
      setDateTo(todayStr);
      setSingleDate('');
    } else if (preset === 'thisMonth') {
      const startM = format(startOfMonth(new Date()), 'yyyy-MM-dd');
      setDateMode('range');
      setDateFrom(startM);
      setDateTo(todayStr);
      setSingleDate('');
    }
  };

  const isFilterActive =
    selectedStaffFilter !== 'all' ||
    selectedRegionFilter !== 'all' ||
    selectedDivisionFilter !== 'all' ||
    selectedTypeFilter !== 'all' ||
    dateMode !== 'all' ||
    singleDate !== '' ||
    dateFrom !== '' ||
    dateTo !== '' ||
    search.trim() !== '';

  const handleClearFilters = () => {
    setSelectedStaffFilter('all');
    setSelectedRegionFilter('all');
    setSelectedDivisionFilter('all');
    setSelectedTypeFilter('all');
    setDateMode('all');
    setSingleDate('');
    setDateFrom('');
    setDateTo('');
    setSearch('');
  };

  // Export Staff Collection CSV (Feature 3A)
  const handleExportCsv = () => {
    if (filteredPayments.length === 0) {
      toast.info('No staff payments to export for the selected filters.');
      return;
    }

    const dateLabel =
      dateMode === 'single' && singleDate
        ? singleDate
        : dateMode === 'range' && (dateFrom || dateTo)
        ? `${dateFrom || 'start'}_to_${dateTo || 'end'}`
        : 'All_Time';

    const staffFilterLabel =
      selectedStaffFilter === 'all'
        ? 'All Staff & Collectors'
        : selectedStaffFilter;

    const result = downloadStaffCollectionsCsv(filteredPayments, {
      dateLabel,
      divisionFilter: selectedDivisionFilter,
      staffFilterLabel,
      staffUsers: staffList,
      filePrefix: 'Staff_Collections',
    });

    toast.success(
      `Exported ${result.recordCount} collection receipts (${formatCurrency(result.totalCollected)}).`
    );
  };

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

  // Handle password change / reset
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetPasswordError('');

    if (!selectedStaffForPassword) return;

    const trimmedNew = newPassword.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (!trimmedNew) {
      setResetPasswordError('Please enter a new password.');
      return;
    }

    if (trimmedNew.length < 6) {
      setResetPasswordError('Password must be at least 6 characters long.');
      return;
    }

    if (trimmedNew !== trimmedConfirm) {
      setResetPasswordError('Passwords do not match. Please re-enter to confirm.');
      return;
    }

    setResettingPassword(true);
    try {
      await resetStaffPassword({
        uid: selectedStaffForPassword.uid,
        email: selectedStaffForPassword.email,
        newPassword: trimmedNew,
      });

      toast.success(
        `Password updated successfully for staff member ${selectedStaffForPassword.name}.`
      );
      setResetModalOpen(false);
      setSelectedStaffForPassword(null);
      setNewPassword('');
      setConfirmPassword('');
      setShowNewPassword(false);
      setShowConfirmPassword(false);
    } catch (err: any) {
      setResetPasswordError(err.message || 'Failed to reset staff password.');
    } finally {
      setResettingPassword(false);
    }
  };

  // Handle direct reset link via email
  const handleSendResetEmailDirect = async () => {
    if (!selectedStaffForPassword) return;
    setResetPasswordError('');
    setResettingPassword(true);
    try {
      await resetStaffPassword({
        uid: selectedStaffForPassword.uid,
        email: selectedStaffForPassword.email,
      });
      toast.success(
        `Secure password reset link sent directly to ${selectedStaffForPassword.email}.`
      );
      setResetModalOpen(false);
      setSelectedStaffForPassword(null);
      setNewPassword('');
      setConfirmPassword('');
      setShowNewPassword(false);
      setShowConfirmPassword(false);
    } catch (err: any) {
      setResetPasswordError(err.message || 'Failed to send password reset email.');
    } finally {
      setResettingPassword(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-16">
      {/* ── Page Header ── */}
      <PageHeader
        title="Staff Section & Collection Reports"
        description="Monitor staff recorded payments, analyze date-wise collection totals, and manage staff accounts."
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

      {/* ── Executive Summary Metric Cards ── */}
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {/* Card 1: Today's Collections across all staff */}
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
            <p className="text-[11px] text-gray-400 font-medium mt-0.5">
              {todayPaymentsCount} payment{todayPaymentsCount === 1 ? '' : 's'} recorded today
            </p>
          </div>
        </Card>

        {/* Card 2: All-Time Collections across all staff */}
        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              All-Time Collections
            </p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {formatCurrency(totalStaffCollectionsAmount)}
            </p>
            <p className="text-[11px] text-gray-400 font-medium mt-0.5">
              {allTimePaymentsCount} total payments across staff
            </p>
          </div>
        </Card>

        {/* Card 3: Today's Payment Records Count */}
        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Today's Payment Count
            </p>
            <p className="text-2xl font-bold text-[var(--color-text-main)] tabular-nums">
              {todayPaymentsCount}
            </p>
            <p className="text-[11px] text-gray-400 font-medium mt-0.5">
              {allTimePaymentsCount} recorded all-time
            </p>
          </div>
        </Card>

        {/* Card 4: Active Staff Members */}
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
            <p className="text-[11px] text-gray-400 font-medium mt-0.5">
              {allKnownStaff.length} total staff profiles
            </p>
          </div>
        </Card>
      </div>

      {/* ── Tab Switcher: Payments vs Staff Performance vs Staff Accounts ── */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex p-1 bg-gray-100 dark:bg-gray-800/80 rounded-2xl shadow-xs overflow-x-auto max-w-full no-scrollbar">
          <button
            type="button"
            onClick={() => setCurrentTab('payments')}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap',
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
            onClick={() => setCurrentTab('performance')}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap',
              currentTab === 'performance'
                ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
            )}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Staff Performance Reports</span>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-bold',
                currentTab === 'performance'
                  ? 'bg-red-50 text-[var(--color-primary)] dark:bg-red-950/60'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              )}
            >
              {allKnownStaff.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setCurrentTab('staff')}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap',
              currentTab === 'staff'
                ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
            )}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Staff Accounts & Access</span>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-bold',
                currentTab === 'staff'
                  ? 'bg-red-50 text-[var(--color-primary)] dark:bg-red-950/60'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              )}
            >
              {staffList.length}
            </span>
          </button>
        </div>
      </div>

      {/* ── TAB 1: STAFF RECORDED PAYMENTS & DATE-WISE REPORTS ── */}
      {currentTab === 'payments' && (
        <div className="space-y-6">
          {/* Quick Staff Filter Chips with Today and Total metrics */}
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
              const todayAmt = metrics ? metrics.todayAmount : 0;
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
                  {todayAmt > 0 && (
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded-md font-semibold',
                        isSelected ? 'bg-white/20 text-white' : 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400'
                      )}
                      title="Today's Collections"
                    >
                      Today: {formatCurrency(todayAmt)}
                    </span>
                  )}
                  <span
                    className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-md font-semibold',
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                    )}
                    title="All-Time Collections"
                  >
                    {formatCurrency(totalAmt)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Comprehensive Filter Card with Date Range & Division */}
          <Card className="p-4 space-y-3.5">
            {/* Quick Date Presets */}
            <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mr-1 flex items-center gap-1">
                  <CalendarRange className="w-3.5 h-3.5 text-gray-400" />
                  Date Presets:
                </span>
                <button
                  type="button"
                  onClick={() => handleSetPreset('all')}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all',
                    dateMode === 'all'
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                  )}
                >
                  All Time
                </button>
                <button
                  type="button"
                  onClick={() => handleSetPreset('today')}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all',
                    dateMode === 'single' && singleDate === todayStr
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                  )}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => handleSetPreset('yesterday')}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all',
                    dateMode === 'single' && singleDate === format(subDays(new Date(), 1), 'yyyy-MM-dd')
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                  )}
                >
                  Yesterday
                </button>
                <button
                  type="button"
                  onClick={() => handleSetPreset('last7')}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all',
                    dateMode === 'range' && dateTo === todayStr && dateFrom === format(subDays(new Date(), 6), 'yyyy-MM-dd')
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                  )}
                >
                  Last 7 Days
                </button>
                <button
                  type="button"
                  onClick={() => handleSetPreset('thisMonth')}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all',
                    dateMode === 'range' && dateFrom === format(startOfMonth(new Date()), 'yyyy-MM-dd')
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                  )}
                >
                  This Month
                </button>
              </div>

              {/* Date Mode Toggle */}
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800/80 p-0.5 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setDateMode('single')}
                  className={cn(
                    'px-2.5 py-1 rounded-md font-semibold transition-all',
                    dateMode === 'single' ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-xs' : 'text-gray-500'
                  )}
                >
                  Single Date
                </button>
                <button
                  type="button"
                  onClick={() => setDateMode('range')}
                  className={cn(
                    'px-2.5 py-1 rounded-md font-semibold transition-all',
                    dateMode === 'range' ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-xs' : 'text-gray-500'
                  )}
                >
                  From – To Range
                </button>
              </div>
            </div>

            {/* Main Filters Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              {/* 1. Search */}
              <div className="relative lg:col-span-2">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search staff, client, region, ref..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                />
              </div>

              {/* 2. Staff Select */}
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

              {/* 3. Division Filter */}
              <div className="relative">
                <Layers className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <select
                  value={selectedDivisionFilter}
                  onChange={(e) => setSelectedDivisionFilter(e.target.value as 'all' | 'primary' | 'bakery')}
                  className="w-full pl-9 pr-4 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
                >
                  <option value="all">All Divisions</option>
                  <option value="primary">Primary Foods</option>
                  <option value="bakery">Bakery Foods</option>
                </select>
              </div>

              {/* 4. Region Select */}
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

              {/* 5. Order Type Select */}
              <div className="relative">
                <select
                  value={selectedTypeFilter}
                  onChange={(e) => setSelectedTypeFilter(e.target.value as 'all' | 'client' | 'direct')}
                  className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
                >
                  <option value="all">All Transactions</option>
                  <option value="client">Client Orders</option>
                  <option value="direct">Direct Sales</option>
                </select>
              </div>
            </div>

            {/* Date Inputs based on Date Mode */}
            {dateMode === 'single' && (
              <div className="flex items-center gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Select Date:</span>
                </div>
                <input
                  type="date"
                  value={singleDate}
                  onChange={(e) => setSingleDate(e.target.value)}
                  className="px-3 py-1.5 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                />
                {singleDate && (
                  <button
                    type="button"
                    onClick={() => setSingleDate('')}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    Clear Date
                  </button>
                )}
              </div>
            )}

            {dateMode === 'range' && (
              <div className="flex items-center gap-3 pt-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <CalendarRange className="w-4 h-4 text-gray-400" />
                  <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Date Range:</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-400 font-medium">From:</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="px-3 py-1.5 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-400 font-medium">To:</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="px-3 py-1.5 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                  />
                </div>
                {(dateFrom || dateTo) && (
                  <button
                    type="button"
                    onClick={() => { setDateFrom(''); setDateTo(''); }}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    Clear Range
                  </button>
                )}
              </div>
            )}

            {/* Clear all filters row */}
            {isFilterActive && (
              <div className="flex items-center justify-between pt-2.5 border-t border-gray-100 dark:border-gray-800 text-xs">
                <span className="text-gray-400 font-medium">
                  Showing <strong>{filteredPayments.length}</strong> of <strong>{validPayments.length}</strong> payments
                </span>
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="text-[var(--color-primary)] hover:underline font-semibold"
                >
                  Reset All Filters
                </button>
              </div>
            )}
          </Card>

          {/* ── Real-Time Date-Wise Collection Totals Banner ── */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-blue-500/10 to-transparent border border-emerald-500/20 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="success">Collection Summary</Badge>
                <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                  {dateMode === 'single' && singleDate
                    ? `Date: ${singleDate}`
                    : dateMode === 'range' && (dateFrom || dateTo)
                    ? `Period: ${dateFrom || 'Start'} to ${dateTo || 'End'}`
                    : 'All Active Records'}
                </span>
              </div>
              <div className="flex items-baseline gap-3 flex-wrap">
                <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatCurrency(filteredTotalAmount)}
                </p>
                <span className="text-xs text-gray-500 font-medium">
                  ({filteredPayments.length} payment{filteredPayments.length === 1 ? '' : 's'})
                </span>
              </div>
            </div>

            {/* Division Split */}
            <div className="flex items-center gap-3">
              <div className="px-3.5 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-900/40 text-center">
                <p className="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400">
                  Primary Foods
                </p>
                <p className="text-sm font-extrabold text-blue-700 dark:text-blue-300 tabular-nums">
                  {formatCurrency(filteredPrimaryAmount)}
                </p>
              </div>
              <div className="px-3.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-900/40 text-center">
                <p className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400">
                  Bakery Foods
                </p>
                <p className="text-sm font-extrabold text-amber-700 dark:text-amber-300 tabular-nums">
                  {formatCurrency(filteredBakeryAmount)}
                </p>
              </div>

              {dateWiseBreakdown.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDailyBreakdown(!showDailyBreakdown)}
                  className="px-3 py-2 rounded-xl text-xs font-bold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/80 transition-all flex items-center gap-1.5"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>Daily Breakdown</span>
                  {showDailyBreakdown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              )}

              <button
                type="button"
                onClick={handleExportCsv}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-white dark:bg-gray-800 border border-emerald-300 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-all flex items-center gap-1.5 shadow-2xs"
                title="Download Staff Collections as Excel-compatible CSV"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Download CSV</span>
              </button>
            </div>
          </div>

          {/* Collapsible Date-Wise Aggregate Table */}
          {showDailyBreakdown && dateWiseBreakdown.length > 0 && (
            <Card padding={false} className="overflow-hidden border border-emerald-500/20">
              <div className="p-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <h4 className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider flex items-center gap-1.5">
                  <CalendarRange className="w-4 h-4 text-emerald-600" />
                  Day-by-Day Collection Breakdown ({dateWiseBreakdown.length} days)
                </h4>
                <span className="text-[11px] text-gray-400">Sorted most recent first</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50/50 dark:bg-gray-900/30 border-b border-gray-100 dark:border-gray-800 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-left">
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5 text-center">Payments</th>
                      <th className="px-4 py-2.5 text-right">Primary Foods</th>
                      <th className="px-4 py-2.5 text-right">Bakery Foods</th>
                      <th className="px-4 py-2.5 text-right font-extrabold">Total Collections</th>
                      <th className="px-4 py-2.5">Active Staff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                    {dateWiseBreakdown.map((row) => (
                      <tr key={row.date} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-2.5 font-bold text-[var(--color-text-main)]">
                          {row.displayDate}
                        </td>
                        <td className="px-4 py-2.5 text-center font-semibold">
                          <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                            {row.count}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                          {formatCurrency(row.primaryAmount)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                          {formatCurrency(row.bakeryAmount)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums text-sm">
                          {formatCurrency(row.totalAmount)}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500">
                          {Array.from(row.staffSet).join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Payments Table */}
          {filteredPayments.length === 0 ? (
            <div className="text-center py-20 bg-[var(--color-card)] rounded-3xl border border-dashed border-gray-200 dark:border-gray-800">
              <CreditCard className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
              <h3 className="text-base font-bold text-[var(--color-text-main)]">
                No Payments Found
              </h3>
              <p className="text-xs font-medium text-gray-500 mt-1">
                No staff payment records matched your selected filters or active date range.
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
                      <th className="px-4 py-3.5">Division</th>
                      <th className="px-4 py-3.5">Date</th>
                      <th className="px-5 py-3.5 text-right">Amount</th>
                      <th className="px-5 py-3.5">Payment Details</th>
                      <th className="px-4 py-3.5 text-right">Summary Flow</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                    {filteredPayments.map((p) => {
                      const staffName = getPaymentStaffName(p);
                      const isDirectSale = p.orderType === 'direct' || p.clientId === 'direct';
                      const clientName = getPaymentClientName(p);
                      const region = getPaymentRegion(p);
                      const dateInfo = getPaymentDate(p);
                      const Icon = methodIcon[p.method] || Banknote;
                      const linkedOrder = p.invoiceId ? orderMap.get(p.invoiceId) : null;
                      const div = p.division === 'bakery' ? 'Bakery Foods' : 'Primary Foods';

                      return (
                        <tr
                          key={p.id}
                          className="hover:bg-gray-50/60 dark:hover:bg-gray-800/20 transition-colors"
                        >
                          {/* 1. Staff */}
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

                          {/* 2. Shop / Client */}
                          <td className="px-5 py-3.5">
                            {isDirectSale ? (
                              <div>
                                <span className="font-bold text-xs text-amber-700 dark:text-amber-400 block">
                                  Direct Sale
                                </span>
                                <span className="text-[10px] text-gray-400 font-mono">
                                  #{p.id.slice(0, 8)}
                                </span>
                              </div>
                            ) : (
                              <>
                                <Link
                                  to={`/clients/${p.clientId}`}
                                  className="font-bold text-xs text-[var(--color-text-main)] hover:text-[var(--color-primary)] transition-colors block"
                                >
                                  {clientName}
                                </Link>
                                <span className="text-[10px] text-gray-400 font-mono">
                                  #{p.id.slice(0, 8)}
                                </span>
                              </>
                            )}
                          </td>

                          {/* 3. Region */}
                          <td className="px-4 py-3.5">
                            <Badge variant={isDirectSale ? 'warning' : 'gray'}>
                              {isDirectSale ? 'Direct Sale' : (region || '—')}
                            </Badge>
                          </td>

                          {/* 4. Division */}
                          <td className="px-4 py-3.5">
                            <Badge variant={p.division === 'bakery' ? 'warning' : 'info'}>
                              {div}
                            </Badge>
                          </td>

                          {/* 5. Date */}
                          <td className="px-4 py-3.5 text-xs font-semibold text-[var(--color-text-muted)] whitespace-nowrap">
                            {dateInfo.display}
                          </td>

                          {/* 6. Amount */}
                          <td className="px-5 py-3.5 text-right font-extrabold text-sm tabular-nums text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                            {formatCurrency(p.amount)}
                          </td>

                          {/* 7. Payment details */}
                          <td className="px-5 py-3.5">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
                                  <Icon className="w-3 h-3 text-gray-400" />
                                  {methodLabel[p.method] || p.method}
                                </span>
                                {isDirectSale && (
                                  <Badge variant="warning">Direct Sale</Badge>
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
                                  {isDirectSale ? 'Direct Sale total: ' : 'Order bill date: '}
                                  <strong className="text-gray-600 dark:text-gray-300">
                                    {format(new Date(linkedOrder.deliveryDate), 'dd MMM yyyy')}
                                  </strong>{' '}
                                  ({formatCurrency(linkedOrder.total)})
                                </p>
                              )}
                            </div>
                          </td>

                          {/* 8. Summary flow */}
                          <td className="px-4 py-3.5 text-right whitespace-nowrap">
                            {isDirectSale ? (
                              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                                <span className="font-bold text-[var(--color-text-main)]">
                                  {staffName}
                                </span>
                                <span className="text-gray-300 dark:text-gray-600">&rarr;</span>
                                <span className="font-bold text-amber-700 dark:text-amber-400">
                                  Direct Sale
                                </span>
                                <span className="text-gray-300 dark:text-gray-600">&rarr;</span>
                                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                  {formatCurrency(p.amount)}
                                </span>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-gray-50 dark:bg-gray-800/80 border border-gray-100 dark:border-gray-800 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                                <span className="font-bold text-[var(--color-text-main)]">
                                  {staffName}
                                </span>
                                <span className="text-gray-300 dark:text-gray-600">&rarr;</span>
                                <span className="truncate max-w-[100px]">{clientName}</span>
                                <span className="text-gray-300 dark:text-gray-600">&rarr;</span>
                                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                  {formatCurrency(p.amount)}
                                </span>
                              </div>
                            )}
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

      {/* ── TAB 2: STAFF PERFORMANCE & COLLECTIONS REPORT ── */}
      {currentTab === 'performance' && (
        <div className="space-y-6">
          {/* Executive Overview Table */}
          <Card padding={false} className="overflow-hidden">
            <div className="p-4 bg-gray-50/70 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--color-text-main)]">
                  Staff-Wise Collection Summary
                </h3>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Daily and all-time collections, payment counts, and division breakdown per staff member.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50/40 dark:bg-gray-900/20 border-b border-gray-100 dark:border-gray-800 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-left">
                    <th className="px-5 py-3">Staff Member</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Today's Collections</th>
                    <th className="px-4 py-3 text-center">Today's Payments</th>
                    <th className="px-4 py-3 text-right">Primary Foods</th>
                    <th className="px-4 py-3 text-right">Bakery Foods</th>
                    <th className="px-4 py-3 text-right font-extrabold">All-Time Collections</th>
                    <th className="px-4 py-3 text-center">All-Time Payments</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {allKnownStaff.map((staff) => {
                    const regUser = staffList.find(
                      (s) => s.uid === staff.id || s.name.toLowerCase() === staff.name.toLowerCase() || (s.email && staff.email && s.email.toLowerCase() === staff.email.toLowerCase())
                    );
                    const metrics = staffMetricsMap.get(staff.name.toLowerCase()) || {
                      totalAmount: 0,
                      totalCount: 0,
                      todayAmount: 0,
                      todayCount: 0,
                      primaryAmount: 0,
                      bakeryAmount: 0,
                    };
                    const isActive = regUser ? regUser.status === 'active' : true;

                    return (
                      <tr key={staff.id || staff.name} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={staff.name} size="sm" />
                            <div>
                              <p className="font-bold text-xs text-[var(--color-text-main)]">
                                {staff.name}
                              </p>
                              <p className="text-[10px] text-gray-400">
                                {staff.email || regUser?.email || 'Staff Account'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={isActive ? 'success' : 'danger'}>
                            {isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                          {formatCurrency(metrics.todayAmount)}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold">
                          <span className={cn(
                            'px-2 py-0.5 rounded-full text-[11px]',
                            metrics.todayCount > 0
                              ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                          )}>
                            {metrics.todayCount}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                          {formatCurrency(metrics.primaryAmount)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                          {formatCurrency(metrics.bakeryAmount)}
                        </td>
                        <td className="px-4 py-3 text-right font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums text-sm">
                          {formatCurrency(metrics.totalAmount)}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold">
                          <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-[11px]">
                            {metrics.totalCount}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedStaffFilter(staff.name);
                              setCurrentTab('payments');
                            }}
                            className="text-xs font-bold text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" /> View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── TAB 3: STAFF DIRECTORY & ACCOUNT MANAGEMENT ── */}
      {currentTab === 'staff' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {allKnownStaff.map((staff) => {
              const regUser = staffList.find(
                (s) => s.uid === staff.id || s.name.toLowerCase() === staff.name.toLowerCase() || (s.email && staff.email && s.email.toLowerCase() === staff.email.toLowerCase())
              );
              const metrics = staffMetricsMap.get(staff.name.toLowerCase()) || {
                totalAmount: 0,
                totalCount: 0,
                todayAmount: 0,
                todayCount: 0,
                primaryAmount: 0,
                bakeryAmount: 0,
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
                          Today's Collections
                        </p>
                        <p className="text-sm font-extrabold text-blue-600 dark:text-blue-400 tabular-nums">
                          {formatCurrency(metrics.todayAmount)}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {metrics.todayCount} today
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase text-gray-400">
                          Total Collections
                        </p>
                        <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                          {formatCurrency(metrics.totalAmount)}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {metrics.totalCount} all-time
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-4 mt-2 border-t border-gray-100 dark:border-gray-800">
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

                    <div className="flex items-center gap-1.5">
                      {regUser && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedStaffForPassword(regUser);
                            setNewPassword('');
                            setConfirmPassword('');
                            setResetPasswordError('');
                            setShowNewPassword(false);
                            setShowConfirmPassword(false);
                            setResetModalOpen(true);
                          }}
                          className="text-xs font-semibold px-2.5 py-1 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 border border-amber-200/60 dark:border-amber-900/40 transition-colors flex items-center gap-1"
                          title="Change or reset staff password"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>Change Password</span>
                        </button>
                      )}

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

      {/* ── Modal: Change / Reset Staff Password ── */}
      {resetModalOpen && selectedStaffForPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--color-card)] rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col border border-gray-100 dark:border-gray-800">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/40">
              <div>
                <h3 className="text-base font-bold text-[var(--color-text-main)] flex items-center gap-2">
                  <KeyRound className="w-5 h-5 text-amber-500" />
                  Change / Reset Password
                </h3>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Update login password securely for staff member.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResetModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Selected Staff Info Banner */}
              <div className="p-3.5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={selectedStaffForPassword.name} size="md" />
                  <div>
                    <h4 className="text-xs font-bold text-[var(--color-text-main)]">
                      {selectedStaffForPassword.name}
                    </h4>
                    <p className="text-[11px] text-[var(--color-text-muted)] font-mono">
                      {selectedStaffForPassword.email}
                    </p>
                  </div>
                </div>
                <Badge variant={selectedStaffForPassword.status === 'active' ? 'success' : 'danger'}>
                  {selectedStaffForPassword.status === 'active' ? 'Active' : 'Inactive'}
                </Badge>
              </div>

              {/* Security info note */}
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400">
                <Shield className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <p>
                  Passwords are securely managed via Firebase Authentication. Existing passwords are never retrieved or stored in plain text.
                </p>
              </div>

              <form onSubmit={handleResetPassword} className="space-y-4 pt-1">
                {/* New Password */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="staff-new-password"
                    className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider flex items-center justify-between"
                  >
                    <span>New Password <span className="text-red-500">*</span></span>
                    <span className="text-[10px] text-gray-400 font-normal lowercase">(min. 6 characters)</span>
                  </label>
                  <div className="relative">
                    <input
                      id="staff-new-password"
                      name="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      minLength={6}
                      required
                      className="w-full pl-3.5 pr-10 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1"
                      tabIndex={-1}
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="staff-confirm-password"
                    className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider"
                  >
                    Confirm New Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="staff-confirm-password"
                      name="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Re-enter new password to confirm"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      minLength={6}
                      required
                      className="w-full pl-3.5 pr-10 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1"
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {resetPasswordError && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                      {resetPasswordError}
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <button
                    type="button"
                    onClick={handleSendResetEmailDirect}
                    disabled={resettingPassword}
                    className="text-xs font-semibold text-[var(--color-primary)] hover:underline flex items-center gap-1 disabled:opacity-50"
                  >
                    <span>Send Reset Email</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setResetModalOpen(false)}
                      disabled={resettingPassword}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      loading={resettingPassword}
                      disabled={resettingPassword}
                    >
                      Update Password
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
