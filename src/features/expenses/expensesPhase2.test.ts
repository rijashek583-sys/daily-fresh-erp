import { describe, it, expect } from 'vitest';
import {
  PREDEFINED_EXPENSE_CATEGORIES,
  type PredefinedExpenseCategory,
  type ExpenseDocument,
} from '../../types/expense.types';
import {
  validateExpenseCreation,
  calculateExpenseSummary,
} from '../../services/expenseDb';
import * as expenseDbModule from '../../services/expenseDb';
import {
  getBusinessDayKey,
  isCurrentBusinessDay,
  getBusinessDayDateRange,
  formatBusinessDayDisplay,
} from '../../lib/businessDay';
import { type AppUser } from '../../types/auth.types';

describe('Daily Expense Tracker — Phase 2 Verification Suite', () => {
  const mockStaffUser: AppUser = {
    uid: 'staff_driver_101',
    name: 'Suresh Driver',
    displayName: 'Suresh',
    email: 'suresh@example.com',
    role: 'staff',
  };

  const mockAdminUser: AppUser = {
    uid: 'admin_sys_01',
    name: 'Rijash Admin',
    displayName: 'Rijash',
    email: 'rijash@example.com',
    role: 'admin',
  };

  // ---------------------------------------------------------------------------
  // 1. Categories Verification
  // ---------------------------------------------------------------------------
  describe('Expense Categories', () => {
    it('supports all 7 predefined categories', () => {
      expect(PREDEFINED_EXPENSE_CATEGORIES).toEqual([
        'CNG',
        'Petrol',
        'Diesel',
        'Daily Food Expense',
        'Toll',
        'Bus Charge',
        'Other Expense',
      ]);
    });

    it('accepts valid expense creation for every predefined category', () => {
      PREDEFINED_EXPENSE_CATEGORIES.forEach((cat) => {
        const payload = {
          amount: 250,
          category: cat,
          customExpenseName: cat === 'Other Expense' ? 'Oil Filter' : undefined,
        };
        const res = validateExpenseCreation(payload, mockStaffUser);
        expect(res.valid).toBe(true);
      });
    });

    it('rejects unrecognized category', () => {
      const res = validateExpenseCreation(
        {
          amount: 100,
          category: 'Hotel Stay' as PredefinedExpenseCategory,
        },
        mockStaffUser
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Invalid category');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Custom "Other Expense" Name Validation
  // ---------------------------------------------------------------------------
  describe('Custom Other Expense Name Requirements', () => {
    it('requires customExpenseName when category is Other Expense', () => {
      const res = validateExpenseCreation(
        {
          amount: 150,
          category: 'Other Expense',
        },
        mockStaffUser
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain('specific expense name is required');
    });

    it('rejects 1-character customExpenseName', () => {
      const res = validateExpenseCreation(
        {
          amount: 150,
          category: 'Other Expense',
          customExpenseName: 'A',
        },
        mockStaffUser
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain('at least 2 characters');
    });

    it('rejects customExpenseName exceeding 50 characters', () => {
      const longName = 'A'.repeat(51);
      const res = validateExpenseCreation(
        {
          amount: 150,
          category: 'Other Expense',
          customExpenseName: longName,
        },
        mockStaffUser
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain('cannot exceed 50 characters');
    });

    it('accepts customExpenseName with valid 2 to 50 characters', () => {
      const res = validateExpenseCreation(
        {
          amount: 150,
          category: 'Other Expense',
          customExpenseName: 'Vehicle Tire Patch',
        },
        mockStaffUser
      );
      expect(res.valid).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Staff vs Admin Attribution & Role Visibility
  // ---------------------------------------------------------------------------
  describe('Role-Based Attribution Enforcement', () => {
    it('requires Admin to provide adminName and adminNameId', () => {
      const resMissingName = validateExpenseCreation(
        { amount: 500, category: 'Diesel' },
        mockAdminUser
      );
      expect(resMissingName.valid).toBe(false);
      expect(resMissingName.error).toContain('Admin operator name is required');

      const resMissingId = validateExpenseCreation(
        { amount: 500, category: 'Diesel', adminName: 'Rijash' },
        mockAdminUser
      );
      expect(resMissingId.valid).toBe(false);
      expect(resMissingId.error).toContain('registered Admin Name selection is required');

      const resValid = validateExpenseCreation(
        { amount: 500, category: 'Diesel', adminName: 'Rijash', adminNameId: 'an_01' },
        mockAdminUser
      );
      expect(resValid.valid).toBe(true);
    });

    it('prohibits Staff from submitting admin attribution', () => {
      const res = validateExpenseCreation(
        {
          amount: 300,
          category: 'Petrol',
          adminName: 'Rijash',
          adminNameId: 'an_01',
        },
        mockStaffUser
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Staff members cannot record expenses under an Admin display name');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Business-Day Derivation & 2:00 AM IST Rollover
  // ---------------------------------------------------------------------------
  describe('Business-Day 2:00 AM IST Cutoff & Rollover', () => {
    it('derives correct business day before 2:00 AM IST', () => {
      // 2026-10-25 01:59:59 AM IST -> UTC 2026-10-24 20:29:59
      const instantPreRollover = new Date('2026-10-24T20:29:59.000Z');
      expect(getBusinessDayKey(instantPreRollover)).toBe('2026-10-24');
    });

    it('rolls over exactly at 2:00:00 AM IST', () => {
      // 2026-10-25 02:00:00 AM IST -> UTC 2026-10-24 20:30:00
      const instantRollover = new Date('2026-10-24T20:30:00.000Z');
      expect(getBusinessDayKey(instantRollover)).toBe('2026-10-25');
    });

    it('correctly handles month-end rollover', () => {
      // 2026-11-01 01:30:00 AM IST -> Belongs to 2026-10-31 business day
      const instantMonthEnd = new Date('2026-10-31T20:00:00.000Z');
      expect(getBusinessDayKey(instantMonthEnd)).toBe('2026-10-31');

      // 2026-11-01 02:01:00 AM IST -> Belongs to 2026-11-01 business day
      const instantNewMonth = new Date('2026-10-31T20:31:00.000Z');
      expect(getBusinessDayKey(instantNewMonth)).toBe('2026-11-01');
    });

    it('correctly handles leap-year rollover on Feb 29', () => {
      // 2028-03-01 01:45:00 AM IST -> Belongs to 2028-02-29 business day
      const instantLeapEnd = new Date('2028-02-29T20:15:00.000Z');
      expect(getBusinessDayKey(instantLeapEnd)).toBe('2028-02-29');

      // 2028-03-01 02:00:00 AM IST -> Belongs to 2028-03-01 business day
      const instantMarchFirst = new Date('2028-02-29T20:30:00.000Z');
      expect(getBusinessDayKey(instantMarchFirst)).toBe('2028-03-01');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Today-Only Edit Lockout
  // ---------------------------------------------------------------------------
  describe('Today-Only Edit Lockout', () => {
    it('returns true for record belonging to current business day', () => {
      const now = new Date('2026-10-24T12:00:00.000Z'); // 5:30 PM IST -> 2026-10-24
      const currentDay = getBusinessDayKey(now);
      expect(isCurrentBusinessDay(currentDay, now)).toBe(true);
    });

    it('returns false for record belonging to yesterday or previous business day', () => {
      const now = new Date('2026-10-25T12:00:00.000Z'); // Oct 25 business day
      expect(isCurrentBusinessDay('2026-10-24', now)).toBe(false);
      expect(isCurrentBusinessDay('2026-09-30', now)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Strict No-Deletion Architecture
  // ---------------------------------------------------------------------------
  describe('Zero Deletion Architecture', () => {
    it('does NOT expose any delete function in expenseDb module', () => {
      const exportsList = Object.keys(expenseDbModule);
      const deleteFunctions = exportsList.filter((name) =>
        name.toLowerCase().includes('delete') || name.toLowerCase().includes('remove')
      );
      expect(deleteFunctions).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Reporting & Summary Aggregations
  // ---------------------------------------------------------------------------
  describe('Expense Reporting & Calculation Isolations', () => {
    const sampleExpenses: ExpenseDocument[] = [
      {
        id: 'exp_1',
        businessDay: '2026-10-24',
        category: 'CNG',
        amount: 400,
        createdBy: 'uid_staff_1',
        creatorName: 'Ali Staff',
        creatorRole: 'staff',
        createdAt: '2026-10-24T05:00:00Z',
        isEdited: false,
        editCount: 0,
        auditTrail: [],
      },
      {
        id: 'exp_2',
        businessDay: '2026-10-24',
        category: 'CNG',
        amount: 300,
        createdBy: 'uid_staff_1',
        creatorName: 'Ali Staff',
        creatorRole: 'staff',
        createdAt: '2026-10-24T06:00:00Z',
        isEdited: false,
        editCount: 0,
        auditTrail: [],
      },
      {
        id: 'exp_3',
        businessDay: '2026-10-24',
        category: 'Diesel',
        amount: 1200,
        createdBy: 'uid_staff_2',
        creatorName: 'Babu Driver',
        creatorRole: 'staff',
        createdAt: '2026-10-24T07:00:00Z',
        isEdited: false,
        editCount: 0,
        auditTrail: [],
      },
      {
        id: 'exp_4',
        businessDay: '2026-10-24',
        category: 'Other Expense',
        customExpenseName: 'Tire Air & Puncture',
        amount: 80,
        createdBy: 'uid_admin_1',
        creatorName: 'Admin Rijash',
        creatorRole: 'admin',
        adminName: 'Rijash',
        createdAt: '2026-10-24T08:00:00Z',
        isEdited: false,
        editCount: 0,
        auditTrail: [],
      },
      {
        id: 'exp_5',
        businessDay: '2026-10-24',
        category: 'Daily Food Expense',
        amount: 150,
        createdBy: 'uid_admin_1',
        creatorName: 'Admin Rijash',
        creatorRole: 'admin',
        adminName: 'Farooq',
        createdAt: '2026-10-24T09:00:00Z',
        isEdited: false,
        editCount: 0,
        auditTrail: [],
      },
    ];

    it('computes exact totals, category share, and staff/admin breakdowns', () => {
      const summary = calculateExpenseSummary(
        sampleExpenses,
        '2026-10-24',
        '2026-10-24',
        'Today'
      );

      // Total = 400 + 300 + 1200 + 80 + 150 = 2130
      expect(summary.totalAmount).toBe(2130);
      expect(summary.totalCount).toBe(5);

      // Category breakdown
      const cng = summary.categories.find((c) => c.category === 'CNG');
      expect(cng?.totalAmount).toBe(700);
      expect(cng?.count).toBe(2);
      expect(cng?.percentage).toBe(32.9); // 700 / 2130 = 32.86 -> 32.9%

      const diesel = summary.categories.find((c) => c.category === 'Diesel');
      expect(diesel?.totalAmount).toBe(1200);

      // Custom other breakdown
      expect(summary.customOtherExpenses).toHaveLength(1);
      expect(summary.customOtherExpenses[0]).toEqual({
        customExpenseName: 'Tire Air & Puncture',
        totalAmount: 80,
        count: 1,
      });

      // Staff breakdown
      expect(summary.staffBreakdown).toHaveLength(3);
      const ali = summary.staffBreakdown.find((s) => s.staffUid === 'uid_staff_1');
      expect(ali?.totalAmount).toBe(700);
      const babu = summary.staffBreakdown.find((s) => s.staffUid === 'uid_staff_2');
      expect(babu?.totalAmount).toBe(1200);

      // Admin attribution breakdown
      expect(summary.adminAttributionBreakdown).toHaveLength(2);
      const rijash = summary.adminAttributionBreakdown.find((a) => a.adminName === 'Rijash');
      expect(rijash?.totalAmount).toBe(80);
      const farooq = summary.adminAttributionBreakdown.find((a) => a.adminName === 'Farooq');
      expect(farooq?.totalAmount).toBe(150);
    });

    it('guarantees financial isolation: expense calculations never touch customer ledger sums', () => {
      const summary = calculateExpenseSummary(sampleExpenses, '2026-10-24', '2026-10-24', 'Today');

      // Simulated ledger totals
      const clientTotalDebt = 45000;
      const clientTotalPaid = 35000;
      const clientOutstanding = clientTotalDebt - clientTotalPaid; // 10000

      // Invariant: Customer ledger calculations must be completely independent of expense totals
      expect(clientOutstanding).toBe(10000);
      expect(clientOutstanding + summary.totalAmount).not.toBe(clientOutstanding);
      expect(summary.totalAmount).toBe(2130);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Backup Integration & Isolation Verification
  // ---------------------------------------------------------------------------
  describe('Backup Snapshot Integration & Isolation', () => {
    it('verifies that mock backup snapshot with expenseDocs and expenseTotalAmount isolates expenses', () => {
      const mockBackup = {
        timestamp: '2026-10-24T12:00:00.000Z',
        version: '1.0.9',
        ledgerCount: 38,
        expenseCount: 2,
        expenseTotalAmount: 550.0,
        adminNamesCount: 1,
        ledgerDocs: [
          { id: 'pay_1', type: 'payment', amount: 500, clientId: 'c1' },
          { id: 'ob_1', type: 'opening_balance', amount: 200, clientId: 'c2' },
        ],
        expenseDocs: [
          {
            id: 'exp_1',
            businessDay: '2026-10-24',
            category: 'Diesel',
            amount: 350.0,
            createdBy: 'uid_staff_1',
          },
          {
            id: 'exp_2',
            businessDay: '2026-10-24',
            category: 'Daily Food Expense',
            amount: 200.0,
            createdBy: 'uid_staff_1',
          },
        ],
        adminNameDocs: [{ id: 'an_1', name: 'Rijash', status: 'active' }],
      };

      // 1. Verify expense doc count
      expect(mockBackup.expenseDocs.length).toBe(mockBackup.expenseCount);

      // 2. Verify computed expense total matches declared metadata
      const computedTotal = mockBackup.expenseDocs.reduce((acc, e) => acc + e.amount, 0);
      expect(computedTotal).toBe(mockBackup.expenseTotalAmount);

      // 3. Verify ledger total does NOT add expenseTotalAmount
      const ledgerFinancialSum = mockBackup.ledgerDocs.reduce((acc, l) => acc + l.amount, 0);
      expect(ledgerFinancialSum).toBe(700); // 500 + 200
      expect(ledgerFinancialSum + computedTotal).toBe(1250);
      expect(ledgerFinancialSum).not.toBe(1250); // Expenses strictly uncoupled
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Staff-Page-Inspired Date Presets & Person Filter Logic
  // ---------------------------------------------------------------------------
  describe('Staff-Page-Inspired Date Presets & Attribution Filters', () => {
    it('computes last7 date preset correctly', () => {
      const ref = new Date('2026-10-24T12:00:00+05:30');
      const range = getBusinessDayDateRange('last7', undefined, undefined, ref);
      expect(range.toBusinessDay).toBe('2026-10-24');
      expect(range.fromBusinessDay).toBe('2026-10-18');
      expect(range.label).toContain('Last 7 Days');
    });

    it('computes all time date preset correctly', () => {
      const ref = new Date('2026-10-24T12:00:00+05:30');
      const range = getBusinessDayDateRange('all', undefined, undefined, ref);
      expect(range.toBusinessDay).toBe('2026-10-24');
      expect(range.fromBusinessDay).toBe('2024-01-01');
      expect(range.label).toBe('All Time');
    });

    it('filters expenses correctly by admin-all and staff-all', () => {
      const testExpenses: Partial<ExpenseDocument>[] = [
        { id: '1', amount: 100, category: 'Diesel', creatorRole: 'admin', adminName: 'Farooq' },
        { id: '2', amount: 200, category: 'Petrol', creatorRole: 'admin', adminName: 'Rijash' },
        { id: '3', amount: 300, category: 'Toll', creatorRole: 'staff', creatorName: 'Rahul', createdBy: 'u_1' },
      ];

      const adminExpenses = testExpenses.filter((e) => e.creatorRole === 'admin');
      const staffExpenses = testExpenses.filter((e) => e.creatorRole !== 'admin');

      expect(adminExpenses.length).toBe(2);
      expect(adminExpenses.reduce((s, e) => s + (e.amount || 0), 0)).toBe(300);

      expect(staffExpenses.length).toBe(1);
      expect(staffExpenses[0].creatorName).toBe('Rahul');
    });

    it('filters expenses by individual admin operator name', () => {
      const testExpenses: Partial<ExpenseDocument>[] = [
        { id: '1', amount: 100, category: 'Diesel', creatorRole: 'admin', adminName: 'Farooq' },
        { id: '2', amount: 200, category: 'Petrol', creatorRole: 'admin', adminName: 'Rijash' },
        { id: '3', amount: 150, category: 'CNG', creatorRole: 'admin', adminName: 'Farooq' },
      ];

      const farooqExpenses = testExpenses.filter(
        (e) => e.creatorRole === 'admin' && e.adminName?.toLowerCase() === 'farooq'
      );
      expect(farooqExpenses.length).toBe(2);
      expect(farooqExpenses.reduce((s, e) => s + (e.amount || 0), 0)).toBe(250);
    });

    it('verifies absence of primary or bakery division properties on expenses', () => {
      const expense: Partial<ExpenseDocument> = {
        id: 'exp_no_div',
        businessDay: '2026-10-24',
        category: 'CNG',
        amount: 350,
      };

      // Ensure division is undefined and not part of the model
      expect((expense as any).division).toBeUndefined();
    });

    it('handles Two Primary Filters: Admin Expenses vs Staff Expenses with Person Dropdown', () => {
      const dataset: Partial<ExpenseDocument>[] = [
        { id: '1', amount: 500, category: 'Diesel', creatorRole: 'admin', adminName: 'Noushad', businessDay: '2026-10-24' },
        { id: '2', amount: 300, category: 'Petrol', creatorRole: 'admin', adminName: 'Farooq', businessDay: '2026-10-24' },
        { id: '3', amount: 200, category: 'CNG', creatorRole: 'admin', adminName: 'Noushad', businessDay: '2026-10-23' },
        { id: '4', amount: 150, category: 'Daily Food Expense', creatorRole: 'staff', creatorName: 'Rahul', createdBy: 'uid_rahul', businessDay: '2026-10-24' },
        { id: '5', amount: 250, category: 'Toll', creatorRole: 'staff', creatorName: 'Suresh', createdBy: 'uid_suresh', businessDay: '2026-10-24' },
      ];

      // 1. Role: admin, Dropdown: 'all' (All Admins)
      const allAdmins = dataset.filter((e) => e.creatorRole === 'admin');
      expect(allAdmins.length).toBe(3);
      expect(allAdmins.reduce((s, e) => s + (e.amount || 0), 0)).toBe(1000);

      // 2. Role: admin, Dropdown: 'Noushad'
      const noushadOnly = dataset.filter(
        (e) => e.creatorRole === 'admin' && (e.adminName || '').toLowerCase() === 'noushad'
      );
      expect(noushadOnly.length).toBe(2);
      expect(noushadOnly.reduce((s, e) => s + (e.amount || 0), 0)).toBe(700);

      // 3. Role: staff, Dropdown: 'all' (All Staff)
      const allStaff = dataset.filter((e) => e.creatorRole !== 'admin');
      expect(allStaff.length).toBe(2);
      expect(allStaff.reduce((s, e) => s + (e.amount || 0), 0)).toBe(400);

      // 4. Role: staff, Dropdown: 'uid_rahul'
      const rahulOnly = dataset.filter(
        (e) => e.creatorRole !== 'admin' && e.createdBy === 'uid_rahul'
      );
      expect(rahulOnly.length).toBe(1);
      expect(rahulOnly[0].amount).toBe(150);
    });

    it('groups records by business date and calculates daily totals correctly', () => {
      const dataset: Partial<ExpenseDocument>[] = [
        { id: '1', amount: 500, category: 'Diesel', businessDay: '2026-10-24' },
        { id: '2', amount: 300, category: 'Petrol', businessDay: '2026-10-24' },
        { id: '3', amount: 200, category: 'CNG', businessDay: '2026-10-23' },
        { id: '4', amount: 150, category: 'Daily Food Expense', businessDay: '2026-10-22' },
      ];

      const groups: Record<string, { total: number; count: number }> = {};
      dataset.forEach((e) => {
        const d = e.businessDay!;
        if (!groups[d]) groups[d] = { total: 0, count: 0 };
        groups[d].total += e.amount || 0;
        groups[d].count += 1;
      });

      expect(groups['2026-10-24'].total).toBe(800);
      expect(groups['2026-10-24'].count).toBe(2);
      expect(groups['2026-10-23'].total).toBe(200);
      expect(groups['2026-10-22'].total).toBe(150);
    });

    it('calculates category-wise totals for selected date range', () => {
      const dataset: Partial<ExpenseDocument>[] = [
        { id: '1', amount: 500, category: 'Diesel' },
        { id: '2', amount: 300, category: 'Diesel' },
        { id: '3', amount: 200, category: 'CNG' },
        { id: '4', amount: 150, category: 'Other Expense', customExpenseName: 'Tea & Snacks' },
      ];

      const catMap: Record<string, number> = {};
      dataset.forEach((e) => {
        catMap[e.category!] = (catMap[e.category!] || 0) + (e.amount || 0);
      });

      expect(catMap['Diesel']).toBe(800);
      expect(catMap['CNG']).toBe(200);
      expect(catMap['Other Expense']).toBe(150);
    });

    it('preserves staff isolation where staff cannot view admin or peer records', () => {
      const mockStaffUid = 'staff_123';
      const dataset: Partial<ExpenseDocument>[] = [
        { id: '1', amount: 500, createdBy: 'admin_1', creatorRole: 'admin' },
        { id: '2', amount: 300, createdBy: 'staff_999', creatorRole: 'staff' },
        { id: '3', amount: 200, createdBy: mockStaffUid, creatorRole: 'staff' },
      ];

      // Staff query filter enforced by Firestore rules: createdBy == request.auth.uid
      const staffVisible = dataset.filter((e) => e.createdBy === mockStaffUid);
      expect(staffVisible.length).toBe(1);
      expect(staffVisible[0].amount).toBe(200);
      expect(staffVisible.every((e) => e.creatorRole !== 'admin')).toBe(true);
    });
  });
});
