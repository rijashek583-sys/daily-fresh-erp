import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReceiptText, Plus, Search, Calendar, User, Clock, CreditCard,
  CheckCircle2, Users, BarChart3, ChevronDown, ChevronUp, CalendarRange,
  Filter, Shield, PieChart, Fuel, Utensils, Car, Bus, HelpCircle,
  Edit2, Lock, RefreshCw, Settings as SettingsIcon, Download, AlertCircle,
  IndianRupee, Banknote, ShieldCheck, ChevronRight, Trash2, Ban
} from 'lucide-react';
import { format, subDays, startOfMonth } from 'date-fns';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/authStore';
import { type AppUser } from '../../types/auth.types';
import { type User as StaffUser } from '../../types';
import {
  type ExpenseDocument,
  type PredefinedExpenseCategory,
  type AdminNameDocument,
  PREDEFINED_EXPENSE_CATEGORIES,
} from '../../types/expense.types';
import {
  subscribeToExpensesByBusinessDay,
  getExpensesByBusinessDayRange,
  calculateExpenseSummary,
} from '../../services/expenseDb';
import { subscribeToAdminNames } from '../../services/adminNameService';
import { subscribeToStaffMembers } from '../../services/staffService';
import {
  getBusinessDayKey,
  getBusinessDayStatusLabel,
  formatBusinessDayDisplay,
  isCurrentBusinessDay,
} from '../../lib/businessDay';
import { Button, Card, Badge, PageHeader, Avatar, SearchInput } from '../../components/ui';
import { formatCurrency, cn } from '../../lib/utils';
import { downloadExpensesCsv } from '../../lib/csvExport';
import ExpenseFormModal from './ExpenseFormModal';
import ExpenseEditModal from './ExpenseEditModal';
import ExpenseVoidModal from './ExpenseVoidModal';

const CATEGORY_ICONS: Record<PredefinedExpenseCategory, React.ElementType> = {
  CNG: Fuel,
  Petrol: Fuel,
  Diesel: Fuel,
  'Daily Food Expense': Utensils,
  Toll: Car,
  'Bus Charge': Bus,
  'Other Expense': HelpCircle,
};

const CATEGORY_STYLES: Record<PredefinedExpenseCategory, { bg: string; text: string; bar: string }> = {
  CNG: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
  Petrol: { bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-600 dark:text-blue-400', bar: 'bg-blue-500' },
  Diesel: { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500' },
  'Daily Food Expense': { bg: 'bg-orange-50 dark:bg-orange-950/40', text: 'text-orange-600 dark:text-orange-400', bar: 'bg-orange-500' },
  Toll: { bg: 'bg-purple-50 dark:bg-purple-950/40', text: 'text-purple-600 dark:text-purple-400', bar: 'bg-purple-500' },
  'Bus Charge': { bg: 'bg-indigo-50 dark:bg-indigo-950/40', text: 'text-indigo-600 dark:text-indigo-400', bar: 'bg-indigo-500' },
  'Other Expense': { bg: 'bg-rose-50 dark:bg-rose-950/40', text: 'text-rose-600 dark:text-rose-400', bar: 'bg-rose-500' },
};

interface DateExpenseGroup {
  date: string;
  displayDate: string;
  isToday: boolean;
  totalAmount: number;
  count: number;
  expenses: ExpenseDocument[];
}

export default function ExpensesPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  // Navigation tab state: minimal 2-tab design
  const [activeTab, setActiveTab] = useState<'records' | 'reports'>('records');

  // Business day boundary metadata (2:00 AM IST cutoff)
  const currentBusinessDay = getBusinessDayKey();
  const businessDayInfo = getBusinessDayStatusLabel();

  // Normalized current user
  const currentUser: AppUser | null = useMemo(() => {
    if (!user) return null;
    return {
      uid: user.uid,
      name: user.name,
      displayName: user.displayName || user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      photoURL: null,
    };
  }, [user]);

  // Real-time Today's expenses (always live for current business day)
  const [todayExpenses, setTodayExpenses] = useState<ExpenseDocument[]>([]);
  const [loadingToday, setLoadingToday] = useState(true);

  // Range-based expenses for historical presets
  const [rangeExpenses, setRangeExpenses] = useState<ExpenseDocument[]>([]);
  const [loadingRange, setLoadingRange] = useState(false);

  // Registered Admin Names and Staff Members (Admin only)
  const [adminNamesList, setAdminNamesList] = useState<AdminNameDocument[]>([]);
  const [staffList, setStaffList] = useState<StaffUser[]>([]);

  // ── Simplified Primary Filters ─────────────────────────────────────────────
  // 1. Role Filter: Admin Expenses vs Staff Expenses (Admin only)
  const [roleFilter, setRoleFilter] = useState<'admin' | 'staff'>('admin');
  // 2. Person Dropdown: 'all' or specific admin name / staff UID
  const [selectedAdminName, setSelectedAdminName] = useState<string>('all');
  const [selectedStaffId, setSelectedStaffId] = useState<string>('all');

  // Category and Search filters
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  // Date Filters: Presets, Range, and Expanded Date Groups
  const [dateMode, setDateMode] = useState<'today' | 'yesterday' | 'last7' | 'thisMonth' | 'all' | 'custom'>('today');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set([currentBusinessDay]));

  // Modals
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseDocument | null>(null);
  const [voidingExpense, setVoidingExpense] = useState<ExpenseDocument | null>(null);
  const [showVoidedExpenses, setShowVoidedExpenses] = useState(false);

  // ── 1. Real-time Subscription to Today's Expenses ──────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    setLoadingToday(true);

    const unsubscribe = subscribeToExpensesByBusinessDay(
      currentBusinessDay,
      currentUser,
      (records) => {
        setTodayExpenses(records);
        setLoadingToday(false);
      },
      (err) => {
        console.error('Failed to subscribe to daily expenses:', err);
        setLoadingToday(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser, currentBusinessDay]);

  // ── 2. Admin Subscriptions: Admin Names and Staff Members ──────────────────
  useEffect(() => {
    if (!isAdmin) return;

    const unsubAdminNames = subscribeToAdminNames(
      (names) => setAdminNamesList(names),
      (err) => console.error('Failed to load admin names:', err)
    );

    const unsubStaff = subscribeToStaffMembers(
      (users) => setStaffList(users),
      (err) => console.error('Failed to load staff list:', err)
    );

    return () => {
      unsubAdminNames();
      unsubStaff();
    };
  }, [isAdmin]);

  // ── 3. Range Fetcher for non-today presets ─────────────────────────────────
  const fetchRangeExpenses = useCallback(async (from: string, to: string) => {
    if (!currentUser) return;
    setLoadingRange(true);
    try {
      const records = await getExpensesByBusinessDayRange(from, to, currentUser);
      setRangeExpenses(records);
    } catch (err: any) {
      console.error('Failed to fetch range expenses:', err);
      toast.error('Failed to load expenses for selected period: ' + (err.message || 'Unknown error'));
    } finally {
      setLoadingRange(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (dateMode === 'today') return;

    let from = currentBusinessDay;
    let to = currentBusinessDay;

    if (dateMode === 'yesterday') {
      const prevDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      from = getBusinessDayKey(prevDate);
      to = from;
    } else if (dateMode === 'last7') {
      from = format(subDays(new Date(), 6), 'yyyy-MM-dd');
      to = currentBusinessDay;
    } else if (dateMode === 'thisMonth') {
      from = format(startOfMonth(new Date()), 'yyyy-MM-dd');
      to = currentBusinessDay;
    } else if (dateMode === 'all') {
      from = '2024-01-01';
      to = currentBusinessDay;
    } else if (dateMode === 'custom') {
      if (!customFrom || !customTo) return;
      from = customFrom <= customTo ? customFrom : customTo;
      to = customFrom <= customTo ? customTo : customFrom;
    }

    fetchRangeExpenses(from, to);
  }, [dateMode, customFrom, customTo, currentBusinessDay, fetchRangeExpenses]);

  // Active dataset based on dateMode
  const activeExpenses = useMemo(() => {
    if (dateMode === 'today') {
      return todayExpenses;
    }
    return rangeExpenses;
  }, [dateMode, todayExpenses, rangeExpenses]);

  const isLoadingData = dateMode === 'today' ? loadingToday : loadingRange;

  // Distinct known contributors list
  const { allAdmins, allStaff } = useMemo(() => {
    const adminSet = new Map<string, string>();
    const staffMap = new Map<string, { uid: string; name: string }>();

    adminNamesList.forEach((a) => {
      if (a.name) adminSet.set(a.name.toLowerCase(), a.name);
    });

    staffList.forEach((s) => {
      if (s.name) staffMap.set(s.uid, { uid: s.uid, name: s.name });
    });

    [...todayExpenses, ...activeExpenses].forEach((e) => {
      if (e.creatorRole === 'admin' && e.adminName) {
        adminSet.set(e.adminName.toLowerCase(), e.adminName);
      } else if (e.creatorRole !== 'admin' && e.creatorName) {
        if (!staffMap.has(e.createdBy)) {
          staffMap.set(e.createdBy, { uid: e.createdBy, name: e.creatorName });
        }
      }
    });

    return {
      allAdmins: Array.from(adminSet.values()).sort((a, b) => a.localeCompare(b)),
      allStaff: Array.from(staffMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [adminNamesList, staffList, todayExpenses, activeExpenses]);

  // Count of voided expenses in the active dataset
  const voidedCount = useMemo(() => {
    return activeExpenses.filter((exp) => exp.isVoided).length;
  }, [activeExpenses]);

  // Person totals maps for dropdown labels (voided expenses excluded from financial totals)
  const { adminTotalsMap, staffTotalsMap, allAdminsTotal, allStaffTotal } = useMemo(() => {
    const aMap = new Map<string, number>();
    const sMap = new Map<string, number>();
    let aSum = 0;
    let sSum = 0;

    activeExpenses.forEach((exp) => {
      if (exp.isVoided) return; // Financial safety: voided expenses excluded from active totals

      if (exp.creatorRole === 'admin') {
        const nameKey = (exp.adminName || 'Admin').toLowerCase();
        aMap.set(nameKey, (aMap.get(nameKey) || 0) + exp.amount);
        aSum += exp.amount;
      } else {
        sMap.set(exp.createdBy, (sMap.get(exp.createdBy) || 0) + exp.amount);
        if (exp.creatorName) {
          sMap.set(exp.creatorName.toLowerCase(), (sMap.get(exp.creatorName.toLowerCase()) || 0) + exp.amount);
        }
        sSum += exp.amount;
      }
    });

    return {
      adminTotalsMap: aMap,
      staffTotalsMap: sMap,
      allAdminsTotal: aSum,
      allStaffTotal: sSum,
    };
  }, [activeExpenses]);

  // ── 4. In-Memory Filter Application ───────────────────────────────────────
  const filteredExpenses = useMemo(() => {
    return activeExpenses.filter((exp) => {
      // Void filter: hide voided expenses unless explicitly enabled by Admin
      if (exp.isVoided && (!isAdmin || !showVoidedExpenses)) {
        return false;
      }

      // 1. Role and Person Filter (Admin only)
      if (isAdmin) {
        if (roleFilter === 'admin') {
          if (exp.creatorRole !== 'admin') return false;
          if (selectedAdminName !== 'all') {
            if ((exp.adminName || '').toLowerCase() !== selectedAdminName.toLowerCase()) {
              return false;
            }
          }
        } else if (roleFilter === 'staff') {
          if (exp.creatorRole === 'admin') return false;
          if (selectedStaffId !== 'all') {
            const matchesUid = exp.createdBy.toLowerCase() === selectedStaffId.toLowerCase();
            const matchesName = (exp.creatorName || '').toLowerCase() === selectedStaffId.toLowerCase();
            if (!matchesUid && !matchesName) return false;
          }
        }
      }

      // 2. Category Filter
      if (selectedCategory !== 'all' && exp.category !== selectedCategory) {
        return false;
      }

      // 3. Search Query
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchesCat = exp.category.toLowerCase().includes(q);
        const matchesCustom = exp.customExpenseName?.toLowerCase().includes(q);
        const matchesNotes = exp.notes?.toLowerCase().includes(q);
        const matchesCreator = exp.creatorName?.toLowerCase().includes(q);
        const matchesAdmin = exp.adminName?.toLowerCase().includes(q);
        const matchesAmt = String(exp.amount).includes(q);
        const matchesReason = exp.voidReason?.toLowerCase().includes(q);
        return matchesCat || matchesCustom || matchesNotes || matchesCreator || matchesAdmin || matchesAmt || !!matchesReason;
      }

      return true;
    });
  }, [activeExpenses, isAdmin, showVoidedExpenses, roleFilter, selectedAdminName, selectedStaffId, selectedCategory, search]);

  // Today's total for the currently active role and person selection (excluding voided)
  const { todayRoleTotalAmount, todayRoleExpensesCount } = useMemo(() => {
    const todayFiltered = todayExpenses.filter((exp) => {
      if (exp.isVoided) return false; // Strictly exclude voided expenses from today's totals

      if (isAdmin) {
        if (roleFilter === 'admin') {
          if (exp.creatorRole !== 'admin') return false;
          if (selectedAdminName !== 'all') {
            if ((exp.adminName || '').toLowerCase() !== selectedAdminName.toLowerCase()) {
              return false;
            }
          }
        } else if (roleFilter === 'staff') {
          if (exp.creatorRole === 'admin') return false;
          if (selectedStaffId !== 'all') {
            const matchesUid = exp.createdBy.toLowerCase() === selectedStaffId.toLowerCase();
            const matchesName = (exp.creatorName || '').toLowerCase() === selectedStaffId.toLowerCase();
            if (!matchesUid && !matchesName) return false;
          }
        }
      }
      return true;
    });

    return {
      todayRoleTotalAmount: todayFiltered.reduce((sum, e) => sum + e.amount, 0),
      todayRoleExpensesCount: todayFiltered.length,
    };
  }, [todayExpenses, isAdmin, roleFilter, selectedAdminName, selectedStaffId]);

  // ── 5. Date-wise Grouping ──────────────────────────────────────────────────
  const dateGroups = useMemo<DateExpenseGroup[]>(() => {
    const map = new Map<string, DateExpenseGroup>();

    filteredExpenses.forEach((exp) => {
      const d = exp.businessDay;
      const existing = map.get(d) || {
        date: d,
        displayDate: formatBusinessDayDisplay(d),
        isToday: isCurrentBusinessDay(d),
        totalAmount: 0,
        count: 0,
        expenses: [],
      };
      // Only non-voided expenses add to the date group monetary total
      if (!exp.isVoided) {
        existing.totalAmount += exp.amount;
      }
      existing.count += 1;
      existing.expenses.push(exp);
      map.set(d, existing);
    });

    const groups = Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
    groups.forEach((g) => {
      g.expenses.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });

    return groups;
  }, [filteredExpenses]);

  // Expand / Collapse dates
  const toggleDate = (date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  const toggleAllDates = () => {
    if (expandedDates.size >= dateGroups.length) {
      setExpandedDates(new Set());
    } else {
      setExpandedDates(new Set(dateGroups.map((g) => g.date)));
    }
  };

  // ── 6. Category-wise Totals for Active Selection ───────────────────────────
  const categoryTotalsList = useMemo(() => {
    const catMap: Record<string, { totalAmount: number; count: number }> = {};
    filteredExpenses.forEach((e) => {
      if (e.isVoided) return; // Strictly exclude voided expenses from category breakdown
      if (!catMap[e.category]) catMap[e.category] = { totalAmount: 0, count: 0 };
      catMap[e.category].totalAmount += e.amount;
      catMap[e.category].count += 1;
    });
    return Object.entries(catMap)
      .map(([cat, data]) => ({ category: cat as PredefinedExpenseCategory, ...data }))
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }, [filteredExpenses]);

  const filteredTotalAmount = useMemo(() => {
    return filteredExpenses
      .filter((e) => !e.isVoided)
      .reduce((sum, e) => sum + e.amount, 0);
  }, [filteredExpenses]);

  // Comprehensive analytics summary for Reports Tab
  const analyticsSummary = useMemo(() => {
    return calculateExpenseSummary(
      filteredExpenses,
      customFrom || currentBusinessDay,
      customTo || currentBusinessDay,
      dateMode === 'today' ? `Today (${formatBusinessDayDisplay(currentBusinessDay)})` : 'Selected Period'
    );
  }, [filteredExpenses, customFrom, customTo, currentBusinessDay, dateMode]);

  // Preset setter
  const handleSetPreset = (preset: 'all' | 'today' | 'yesterday' | 'last7' | 'thisMonth') => {
    setDateMode(preset);
    if (preset === 'today') {
      setCustomFrom('');
      setCustomTo('');
      setExpandedDates(new Set([currentBusinessDay]));
    } else if (preset === 'yesterday') {
      const prevDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const prevKey = getBusinessDayKey(prevDate);
      setCustomFrom(prevKey);
      setCustomTo(prevKey);
      setExpandedDates(new Set([prevKey]));
    } else if (preset === 'last7') {
      setCustomFrom(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
      setCustomTo(currentBusinessDay);
      setExpandedDates(new Set([currentBusinessDay]));
    } else if (preset === 'thisMonth') {
      setCustomFrom(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
      setCustomTo(currentBusinessDay);
      setExpandedDates(new Set([currentBusinessDay]));
    } else if (preset === 'all') {
      setCustomFrom('');
      setCustomTo('');
      setExpandedDates(new Set([currentBusinessDay]));
    }
  };

  // CSV Export handler (Feature 3B)
  const handleExportCsv = () => {
    if (filteredExpenses.length === 0) {
      toast.info('No expenses to export for current selection.');
      return;
    }

    const dateLabel =
      dateMode === 'today'
        ? currentBusinessDay
        : dateMode === 'yesterday'
        ? getBusinessDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000))
        : dateMode === 'thisMonth'
        ? format(new Date(), 'yyyy-MM')
        : dateMode === 'custom' && (customFrom || customTo)
        ? `${customFrom || 'start'}_to_${customTo || 'end'}`
        : dateMode;

    const result = downloadExpensesCsv(filteredExpenses, {
      isAdmin,
      dateLabel,
      categoryFilter: selectedCategory,
      includeVoided: showVoidedExpenses,
      filePrefix: 'Expenses',
    });

    const voidedInfo = result.voidedCount > 0 ? ` (${result.voidedCount} voided excluded from total)` : '';
    toast.success(
      `Exported ${result.totalRecords} expense records. Active Total: ${formatCurrency(result.activeTotalAmount)}${voidedInfo}.`
    );
  };

  // Active filter label description
  const activeFilterDescription = useMemo(() => {
    if (!isAdmin) return `My Expenses (${currentUser?.displayName || currentUser?.name})`;
    const roleLabel = roleFilter === 'admin' ? 'Admin Expenses' : 'Staff Expenses';
    const personLabel =
      roleFilter === 'admin'
        ? selectedAdminName === 'all' ? 'All Admins' : `Admin: ${selectedAdminName}`
        : selectedStaffId === 'all'
        ? 'All Staff'
        : `Staff: ${allStaff.find((s) => s.uid === selectedStaffId)?.name || selectedStaffId}`;
    return `${roleLabel} • ${personLabel}`;
  }, [isAdmin, roleFilter, selectedAdminName, selectedStaffId, allStaff, currentUser]);

  if (!currentUser) {
    return (
      <div className="p-8 text-center text-gray-500">
        Please log in to view expenses.
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto pb-16 space-y-4" id="expenses-page-container">
      {/* ── Page Header: Minimal & Clean ── */}
      <PageHeader
        title={isAdmin ? 'Daily Expenses' : 'My Expenses'}
        description={`Track vehicle fuels, daily allowances, tolls, and other expenses with 2:00 AM IST cutoff.`}
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Link to="/expenses/admin-names">
                <Button
                  variant="outline"
                  size="sm"
                  icon={<SettingsIcon className="w-4 h-4 text-gray-500" />}
                  id="manage-admin-names-button"
                >
                  Admin Names
                </Button>
              </Link>
            )}

            {/* Tab Toggle: Expenses vs Reports */}
            <div className="flex p-0.5 bg-gray-100 dark:bg-gray-800 rounded-xl border border-black/[0.04] dark:border-white/[0.06]">
              <button
                type="button"
                onClick={() => setActiveTab('records')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
                  activeTab === 'records'
                    ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-xs'
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
                )}
                id="tab-records-btn"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Expenses</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('reports')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
                  activeTab === 'reports'
                    ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-xs'
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
                )}
                id="tab-reports-btn"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Reports & Analytics</span>
              </button>
            </div>

            <Button
              size="md"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setIsFormModalOpen(true)}
              id="record-expense-button"
            >
              Record Expense
            </Button>
          </div>
        }
      />

      {/* ── Minimal Controls Bar ── */}
      <Card className="p-3.5 sm:p-4 space-y-3">
        {/* Row 1: Primary Role Filter (Admin vs Staff) + Person Dropdown + Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Primary Role Filter: Admin Expenses / Staff Expenses */}
              <div className="flex p-0.5 bg-gray-100 dark:bg-gray-800 rounded-xl border border-black/[0.04] dark:border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => {
                    setRoleFilter('admin');
                    setSelectedAdminName('all');
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
                    roleFilter === 'admin'
                      ? 'bg-[var(--color-primary)] text-white shadow-xs'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                  )}
                  id="filter-admin-expenses"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Admin Expenses</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setRoleFilter('staff');
                    setSelectedStaffId('all');
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
                    roleFilter === 'staff'
                      ? 'bg-[var(--color-primary)] text-white shadow-xs'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                  )}
                  id="filter-staff-expenses"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>Staff Expenses</span>
                </button>
              </div>

              {/* Person Dropdown */}
              <div className="relative">
                {roleFilter === 'admin' ? (
                  <select
                    value={selectedAdminName}
                    onChange={(e) => setSelectedAdminName(e.target.value)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-gray-200 dark:border-gray-700 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] cursor-pointer"
                    id="admin-person-dropdown"
                  >
                    <option value="all">All Admins ({formatCurrency(allAdminsTotal)})</option>
                    {allAdmins.map((admin) => (
                      <option key={admin} value={admin}>
                        {admin} ({formatCurrency(adminTotalsMap.get(admin.toLowerCase()) || 0)})
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={selectedStaffId}
                    onChange={(e) => setSelectedStaffId(e.target.value)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-gray-200 dark:border-gray-700 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] cursor-pointer"
                    id="staff-person-dropdown"
                  >
                    <option value="all">All Staff ({formatCurrency(allStaffTotal)})</option>
                    {allStaff.map((staff) => (
                      <option key={staff.uid} value={staff.uid}>
                        {staff.name} ({formatCurrency(staffTotalsMap.get(staff.uid) || staffTotalsMap.get(staff.name.toLowerCase()) || 0)})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                My Expenses ({currentUser.displayName || currentUser.name})
              </span>
            </div>
          )}

          {/* Search Box */}
          <div className="w-full sm:w-64">
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch('')}
              placeholder="Search category, notes..."
              id="expense-search-input"
            />
          </div>
        </div>

        {/* Row 2: Date Presets & Category Dropdown */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mr-1 flex items-center gap-1">
              <CalendarRange className="w-3.5 h-3.5 text-gray-400" />
              Date:
            </span>
            {(['today', 'yesterday', 'last7', 'thisMonth', 'all'] as const).map((p) => {
              const labels = {
                today: 'Today',
                yesterday: 'Yesterday',
                last7: 'Last 7 Days',
                thisMonth: 'This Month',
                all: 'All Time',
              };
              const isSelected = dateMode === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleSetPreset(p)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                    isSelected
                      ? 'bg-[var(--color-primary)] text-white shadow-xs'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                  )}
                  id={`preset-${p}`}
                >
                  {labels[p]}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setDateMode('custom')}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                dateMode === 'custom'
                  ? 'bg-[var(--color-primary)] text-white shadow-xs'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
              )}
              id="preset-custom"
            >
              Custom
            </button>
          </div>

          {/* Category Dropdown */}
          <div className="flex items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-700 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] cursor-pointer"
              id="category-dropdown"
            >
              <option value="all">All Categories ({activeExpenses.length})</option>
              {PREDEFINED_EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            {/* Admin Voided Records Toggle */}
            {isAdmin && voidedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowVoidedExpenses(!showVoidedExpenses)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 border',
                  showVoidedExpenses
                    ? 'bg-rose-50 border-rose-300 text-rose-700 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300'
                    : 'bg-gray-100 dark:bg-gray-800 border-transparent text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                )}
                id="toggle-voided-expenses-btn"
                title="Toggle display of voided (soft-deleted) expenses"
              >
                <Ban className="w-3.5 h-3.5 text-rose-500" />
                <span>{showVoidedExpenses ? 'Hide Voided' : 'Show Voided'} ({voidedCount})</span>
              </button>
            )}

            {/* Download CSV Button */}
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filteredExpenses.length === 0}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 border border-emerald-300 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
              id="export-expenses-csv-btn"
              title="Download filtered expenses as Excel-compatible CSV"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Download CSV</span>
            </button>
          </div>
        </div>

        {/* Custom Date Pickers (Inline when Custom is active) */}
        {dateMode === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100 dark:border-gray-800 animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">From:</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">To:</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)]"
              />
            </div>
          </div>
        )}
      </Card>

      {/* ── TAB 1: EXPENSES VIEW (Minimal & Focused) ── */}
      {activeTab === 'records' && (
        <div className="space-y-4">
          {/* Summary Total Banner: Clear distinction between Period and Today totals + Category badges */}
          <Card className="p-4 sm:p-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Primary Period Total */}
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 shadow-xs">
                  <Banknote className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    {dateMode === 'today' ? "Today's Total" : "Selected Period Total"}
                  </p>
                  <p className="text-2xl sm:text-3xl font-bold text-[var(--color-text-main)] tabular-nums" id="period-total-amount">
                    {formatCurrency(filteredTotalAmount)}
                  </p>
                  <p className="text-xs text-gray-400 font-medium">
                    {filteredExpenses.length} entr{filteredExpenses.length === 1 ? 'y' : 'ies'} • {activeFilterDescription}
                  </p>
                </div>
              </div>

              {/* Today's Live Total (Distinguished when viewing past dates or ranges) */}
              {dateMode !== 'today' && (
                <div className="flex items-center gap-3 lg:border-l lg:border-gray-100 lg:dark:border-gray-800 lg:pl-5">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                      Today's Live Total
                    </p>
                    <p className="text-lg font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                      {formatCurrency(todayRoleTotalAmount)}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {todayRoleExpensesCount} entries today
                    </p>
                  </div>
                </div>
              )}

              {/* Category-Wise Quick Totals Badges */}
              <div className="flex flex-wrap items-center gap-1.5 lg:justify-end max-w-xl">
                {categoryTotalsList.map((cat) => {
                  const isSelected = selectedCategory === cat.category;
                  return (
                    <button
                      key={cat.category}
                      type="button"
                      onClick={() => setSelectedCategory(isSelected ? 'all' : cat.category)}
                      className={cn(
                        'text-xs px-2.5 py-1 rounded-xl font-medium flex items-center gap-1 border transition-all cursor-pointer',
                        isSelected
                          ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] font-bold shadow-xs'
                          : 'bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-100'
                      )}
                      title={`Filter by ${cat.category}`}
                    >
                      <span className="opacity-80">{cat.category}:</span>
                      <span className="font-bold tabular-nums">{formatCurrency(cat.totalAmount)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* Date-Grouped Records Table */}
          <div className="space-y-3">
            {/* Header with expand/collapse all */}
            <div className="flex items-center justify-between px-1 text-xs">
              <span className="text-gray-500 font-medium">
                {dateGroups.length} business date{dateGroups.length === 1 ? '' : 's'} recorded
              </span>

              {dateGroups.length > 1 && (
                <button
                  type="button"
                  onClick={toggleAllDates}
                  className="text-xs font-semibold text-[var(--color-primary)] hover:underline cursor-pointer"
                >
                  {expandedDates.size >= dateGroups.length ? 'Collapse All Dates' : 'Expand All Dates'}
                </button>
              )}
            </div>

            {isLoadingData ? (
              <Card className="p-12 text-center text-gray-500 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
                <p className="text-sm font-medium">Loading expenses...</p>
              </Card>
            ) : dateGroups.length === 0 ? (
              <Card className="p-16 text-center text-gray-400">
                <ReceiptText className="w-12 h-12 mx-auto mb-3 opacity-30 text-[var(--color-primary)]" />
                <h3 className="text-base font-semibold text-[var(--color-text-main)] mb-1">
                  No Expenses Found
                </h3>
                <p className="text-xs text-gray-500 max-w-sm mx-auto mb-4">
                  {search || selectedCategory !== 'all'
                    ? 'No expenses match your search or category filter.'
                    : `No expenses recorded for ${activeFilterDescription}.`}
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setIsFormModalOpen(true)}
                  icon={<Plus className="w-4 h-4" />}
                >
                  Record Expense
                </Button>
              </Card>
            ) : (
              dateGroups.map((group) => {
                const isExpanded = expandedDates.has(group.date);

                return (
                  <Card key={group.date} className="overflow-hidden p-0 border border-black/[0.04] dark:border-white/[0.04]">
                    {/* Date Accordion Header */}
                    <div
                      onClick={() => toggleDate(group.date)}
                      className="flex items-center justify-between p-3 sm:p-3.5 bg-gray-50/80 dark:bg-gray-800/60 hover:bg-gray-100/80 dark:hover:bg-gray-800 transition-colors cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-2.5">
                        <button type="button" className="text-gray-400 hover:text-gray-600">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <span className="font-bold text-sm text-[var(--color-text-main)]">
                          {group.displayDate}
                        </span>
                        {group.isToday && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 font-bold">
                            Today
                          </span>
                        )}
                        <span className="text-xs text-gray-400 font-medium">
                          ({group.count} entr{group.count === 1 ? 'y' : 'ies'})
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-sm font-bold font-mono text-[var(--color-text-main)]">
                          {formatCurrency(group.totalAmount)}
                        </span>
                      </div>
                    </div>

                    {/* Expanded Individual Records Table */}
                    {isExpanded && (
                      <div className="overflow-x-auto custom-scrollbar border-t border-black/[0.04] dark:border-white/[0.04]">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-gray-50/40 dark:bg-gray-800/30 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-black/[0.04] dark:border-white/[0.04]">
                            <tr>
                              <th className="py-2.5 px-4">Category & Details</th>
                              <th className="py-2.5 px-4">Amount</th>
                              <th className="py-2.5 px-4">Attribution</th>
                              <th className="py-2.5 px-4">Time</th>
                              <th className="py-2.5 px-4 text-center">Status</th>
                              <th className="py-2.5 px-4 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                            {group.expenses.map((exp) => {
                              const Icon = CATEGORY_ICONS[exp.category] || HelpCircle;
                              const style = CATEGORY_STYLES[exp.category] || { bg: 'bg-gray-100', text: 'text-gray-700' };
                              const isTodayRecord = isCurrentBusinessDay(exp.businessDay);

                              return (
                                <tr
                                  key={exp.id}
                                  className={cn(
                                    'transition-colors',
                                    exp.isVoided
                                      ? 'bg-rose-50/20 dark:bg-rose-950/20 opacity-75'
                                      : 'hover:bg-gray-50/60 dark:hover:bg-gray-800/30'
                                  )}
                                  id={`expense-row-${exp.id}`}
                                >
                                  {/* Category & Details */}
                                  <td className="py-2.5 px-4">
                                    <div className="flex items-center gap-2.5">
                                      <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-xs', style.bg, style.text)}>
                                        <Icon className="w-4 h-4" />
                                      </div>
                                      <div>
                                        <div className="font-semibold text-xs sm:text-sm text-[var(--color-text-main)] flex items-center gap-1.5 flex-wrap">
                                          <span>{exp.category}</span>
                                          {exp.customExpenseName && (
                                            <span className="text-xs font-semibold text-[var(--color-primary)]">
                                              • {exp.customExpenseName}
                                            </span>
                                          )}
                                        </div>
                                        {exp.notes && (
                                          <p className="text-[11px] text-gray-400 truncate max-w-xs" title={exp.notes}>
                                            {exp.notes}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </td>

                                  {/* Amount */}
                                  <td className="py-2.5 px-4 font-mono font-bold text-sm text-[var(--color-text-main)]">
                                    <span className={cn(exp.isVoided && 'line-through text-gray-400 dark:text-gray-500')}>
                                      {formatCurrency(exp.amount)}
                                    </span>
                                  </td>

                                  {/* Attribution */}
                                  <td className="py-2.5 px-4 text-xs">
                                    {exp.creatorRole === 'admin' ? (
                                      <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-primary)]">
                                        <Shield className="w-3 h-3" />
                                        Admin: {exp.adminName || 'Admin'}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 font-semibold text-gray-700 dark:text-gray-300">
                                        <User className="w-3 h-3 text-gray-400" />
                                        Staff: {exp.creatorName}
                                      </span>
                                    )}
                                  </td>

                                  {/* Timestamp */}
                                  <td className="py-2.5 px-4 text-xs text-gray-400 font-mono">
                                    {new Date(exp.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </td>

                                  {/* Status */}
                                  <td className="py-2.5 px-4 text-center">
                                    {exp.isVoided ? (
                                      <span title={exp.voidReason ? `Voided: ${exp.voidReason}` : 'Voided'}>
                                        <Badge
                                          variant="danger"
                                          className="text-[10px]"
                                        >
                                          VOIDED
                                        </Badge>
                                      </span>
                                    ) : exp.isEdited ? (
                                      <Badge variant="warning" className="text-[10px]" dot>
                                        Edited ({exp.editCount}x)
                                      </Badge>
                                    ) : (
                                      <Badge variant="success" className="text-[10px]">
                                        Original
                                      </Badge>
                                    )}
                                  </td>

                                  {/* Actions */}
                                  <td className="py-2.5 px-4 text-right">
                                    {exp.isVoided ? (
                                      <span
                                        className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 dark:text-rose-400 italic max-w-xs truncate"
                                        title={`Voided by ${exp.voidedByAdminName || exp.voidedByName || 'Admin'}: ${exp.voidReason || 'No reason'}`}
                                      >
                                        <Ban className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{exp.voidReason || 'Voided'}</span>
                                      </span>
                                    ) : (
                                      <div className="inline-flex items-center gap-1.5 justify-end">
                                        {isTodayRecord ? (
                                          <button
                                            type="button"
                                            onClick={() => setEditingExpense(exp)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors cursor-pointer"
                                            id={`edit-expense-${exp.id}`}
                                          >
                                            <Edit2 className="w-3 h-3 text-gray-500" />
                                            Edit
                                          </button>
                                        ) : (
                                          <span
                                            className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400"
                                            title="Closed after 2:00 AM IST cutoff"
                                          >
                                            <Lock className="w-3 h-3" />
                                            Locked
                                          </span>
                                        )}

                                        {isAdmin && (
                                          <button
                                            type="button"
                                            onClick={() => setVoidingExpense(exp)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer"
                                            id={`void-expense-${exp.id}`}
                                            title="Void / Soft Delete this expense"
                                          >
                                            <Trash2 className="w-3 h-3 text-rose-500" />
                                            Void
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: REPORTS & ANALYTICS VIEW ── */}
      {activeTab === 'reports' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          {/* Action Header for Reports */}
          <div className="flex items-center justify-between flex-wrap gap-2 p-3 bg-gray-50 dark:bg-gray-900/60 rounded-2xl border border-black/[0.04] dark:border-white/[0.06]">
            <div>
              <h4 className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                Analytics for: {activeFilterDescription}
              </h4>
              <p className="text-[11px] text-gray-500">
                Period: {dateMode === 'today' ? formatBusinessDayDisplay(currentBusinessDay) : `${customFrom || '2024-01-01'} to ${customTo || currentBusinessDay}`}
              </p>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportCsv}
              disabled={filteredExpenses.length === 0}
              icon={<Download className="w-3.5 h-3.5" />}
              id="export-report-csv-btn"
            >
              Export Report (CSV)
            </Button>
          </div>

          {/* 4 Summary StatCards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="flex items-center gap-3.5 p-4">
              <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                <IndianRupee className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  Total Expenses
                </p>
                <p className="text-xl font-bold text-red-600 dark:text-red-400 tabular-nums">
                  {formatCurrency(analyticsSummary.totalAmount)}
                </p>
              </div>
            </Card>

            <Card className="flex items-center gap-3.5 p-4">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Filter className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  Total Entries
                </p>
                <p className="text-xl font-bold text-[var(--color-text-main)] tabular-nums">
                  {analyticsSummary.totalCount}
                </p>
              </div>
            </Card>

            <Card className="flex items-center gap-3.5 p-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <PieChart className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  Average Ticket
                </p>
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatCurrency(analyticsSummary.totalCount > 0 ? analyticsSummary.totalAmount / analyticsSummary.totalCount : 0)}
                </p>
              </div>
            </Card>

            <Card className="flex items-center gap-3.5 p-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Fuel className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  Top Category
                </p>
                <p className="text-xl font-bold text-[var(--color-text-main)] tabular-nums truncate max-w-[150px]">
                  {categoryTotalsList[0] ? categoryTotalsList[0].category : 'None'}
                </p>
              </div>
            </Card>
          </div>

          {/* 2-Column Grid: Category Breakdown Progress Bars & Itemized Other Expense */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Category Breakdown */}
            <Card className="p-5 space-y-3.5">
              <h4 className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider flex items-center gap-1.5">
                <PieChart className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                Category Distribution
              </h4>
              <div className="space-y-3">
                {analyticsSummary.categories.map((cat) => {
                  const style = CATEGORY_STYLES[cat.category] || { bar: 'bg-gray-400' };
                  const Icon = CATEGORY_ICONS[cat.category] || HelpCircle;

                  return (
                    <div key={cat.category} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                          <Icon className="w-3.5 h-3.5 text-gray-500" />
                          {cat.category}
                        </span>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-gray-400 text-[11px]">({cat.count})</span>
                          <span className="font-bold text-[var(--color-text-main)]">
                            {formatCurrency(cat.totalAmount)}
                          </span>
                          <span className="text-[11px] font-semibold text-gray-500 w-10 text-right">
                            {cat.percentage}%
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all duration-300', style.bar)}
                          style={{ width: `${cat.percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Itemized Other Expense Breakdown */}
            <Card className="p-5 space-y-3.5">
              <h4 className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                Itemized "Other Expense" Breakdown
              </h4>
              {analyticsSummary.customOtherExpenses.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-gray-400">
                  <AlertCircle className="w-6 h-6 mb-1 opacity-40" />
                  <p className="text-xs">No "Other Expense" items in this period.</p>
                </div>
              ) : (
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-black/[0.04] dark:border-white/[0.04] text-gray-400 font-bold uppercase text-[10px]">
                        <th className="pb-2">Custom Item Name</th>
                        <th className="pb-2 text-center">Entries</th>
                        <th className="pb-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                      {analyticsSummary.customOtherExpenses.map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="py-2 font-semibold text-gray-800 dark:text-gray-200">
                            {item.customExpenseName}
                          </td>
                          <td className="py-2 text-center text-gray-500 font-mono">
                            {item.count}
                          </td>
                          <td className="py-2 text-right font-bold text-[var(--color-text-main)] font-mono">
                            {formatCurrency(item.totalAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ── Modals: Record & Edit ── */}
      {currentUser && (
        <ExpenseFormModal
          isOpen={isFormModalOpen}
          onClose={() => setIsFormModalOpen(false)}
          currentUser={currentUser}
          onSuccess={() => {
            if (dateMode !== 'today') {
              fetchRangeExpenses(customFrom || currentBusinessDay, customTo || currentBusinessDay);
            }
          }}
        />
      )}

      {currentUser && (
        <ExpenseEditModal
          isOpen={editingExpense !== null}
          onClose={() => setEditingExpense(null)}
          expense={editingExpense}
          currentUser={currentUser}
          onSuccess={() => {
            if (dateMode !== 'today') {
              fetchRangeExpenses(customFrom || currentBusinessDay, customTo || currentBusinessDay);
            }
          }}
        />
      )}

      {/* ── Admin-Only Expense Void Modal ── */}
      {currentUser && isAdmin && (
        <ExpenseVoidModal
          isOpen={voidingExpense !== null}
          onClose={() => setVoidingExpense(null)}
          expense={voidingExpense}
          currentUser={currentUser}
          adminNamesList={adminNamesList}
          onSuccess={() => {
            setVoidingExpense(null);
            if (dateMode !== 'today') {
              fetchRangeExpenses(customFrom || currentBusinessDay, customTo || currentBusinessDay);
            }
          }}
        />
      )}
    </div>
  );
}
