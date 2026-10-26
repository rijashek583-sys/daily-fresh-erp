import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateExpenseCreation,
  createExpenseRecord,
  updateExpenseRecord,
  voidExpenseRecord,
  getExpensesByBusinessDayRange,
  calculateExpenseSummary,
} from './expenseDb';
import { type AppUser } from '../types/auth.types';
import { type ExpenseDocument } from '../types/expense.types';
import * as firestore from 'firebase/firestore';
import * as functionsMod from 'firebase/functions';

const mockCallableFn = vi.fn();

vi.mock('firebase/functions', () => {
  return {
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => mockCallableFn),
  };
});

vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn((_db, col) => ({ path: col })),
    doc: vi.fn((_db, _col, id) => ({ id, path: `${_col}/${id}` })),
    getDocs: vi.fn(),
    query: vi.fn((...args) => ({ args })),
    where: vi.fn((field, op, val) => ({ field, op, val })),
    onSnapshot: vi.fn(),
  };
});

vi.mock('../lib/firebase', () => ({
  app: {},
  db: {},
}));

const mockStaffUser: AppUser = {
  uid: 'staff_123',
  displayName: 'Rahim Staff',
  email: 'rahim@example.com',
  role: 'staff',
  photoURL: null,
};

const mockAdminUser: AppUser = {
  uid: 'admin_root',
  displayName: 'Admin User',
  email: 'admin@example.com',
  role: 'admin',
  photoURL: null,
};

describe('Daily Expense Database Service (Client Service Adapted for Cloud Functions)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateExpenseCreation', () => {
    it('accepts valid staff expense payload', () => {
      const result = validateExpenseCreation(
        {
          amount: 350.5,
          category: 'Diesel',
          notes: 'Fuel for delivery van',
        },
        mockStaffUser
      );
      expect(result).toEqual({ valid: true });
    });

    it('accepts valid admin expense payload with operator attribution', () => {
      const result = validateExpenseCreation(
        {
          amount: 120,
          category: 'Toll',
          adminName: 'Rijash',
          adminNameId: 'admin_1',
        },
        mockAdminUser
      );
      expect(result).toEqual({ valid: true });
    });

    it('rejects unauthenticated user', () => {
      const result = validateExpenseCreation(
        { amount: 100, category: 'Petrol' },
        null as any
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('User must be authenticated');
    });

    it('rejects zero or negative amounts', () => {
      expect(validateExpenseCreation({ amount: 0, category: 'CNG' }, mockStaffUser).valid).toBe(false);
      expect(validateExpenseCreation({ amount: -50, category: 'CNG' }, mockStaffUser).valid).toBe(false);
      expect(validateExpenseCreation({ amount: NaN, category: 'CNG' }, mockStaffUser).valid).toBe(false);
    });

    it('rejects invalid category', () => {
      const result = validateExpenseCreation(
        { amount: 100, category: 'Entertainment' as any },
        mockStaffUser
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid category');
    });

    it('requires customExpenseName when category is "Other Expense"', () => {
      const missingCustom = validateExpenseCreation(
        { amount: 100, category: 'Other Expense' },
        mockStaffUser
      );
      expect(missingCustom.valid).toBe(false);
      expect(missingCustom.error?.toLowerCase()).toContain('specific expense name is required');

      const tooShort = validateExpenseCreation(
        { amount: 100, category: 'Other Expense', customExpenseName: 'A' },
        mockStaffUser
      );
      expect(tooShort.valid).toBe(false);
      expect(tooShort.error).toContain('at least 2 characters');
    });

    it('requires adminName and adminNameId when role is admin', () => {
      const missingAdminName = validateExpenseCreation(
        { amount: 100, category: 'Diesel' },
        mockAdminUser
      );
      expect(missingAdminName.valid).toBe(false);
      expect(missingAdminName.error).toContain('Admin operator name is required');

      const missingAdminNameId = validateExpenseCreation(
        { amount: 100, category: 'Diesel', adminName: 'Rijash' },
        mockAdminUser
      );
      expect(missingAdminNameId.valid).toBe(false);
      expect(missingAdminNameId.error).toContain('registered Admin Name selection is required');
    });

    it('rejects staff user providing admin attribution', () => {
      const result = validateExpenseCreation(
        { amount: 100, category: 'Diesel', adminName: 'Rijash' },
        mockStaffUser
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Staff members cannot record expenses under an Admin display name');
    });

    it('rejects notes exceeding 500 characters', () => {
      const longNotes = 'X'.repeat(501);
      const result = validateExpenseCreation(
        { amount: 100, category: 'Diesel', notes: longNotes },
        mockStaffUser
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Notes cannot exceed 500 characters');
    });
  });

  describe('createExpenseRecord', () => {
    it('invokes recordExpense Cloud Function and returns generated expenseId', async () => {
      mockCallableFn.mockResolvedValueOnce({
        data: { success: true, expenseId: 'exp_server_123', businessDay: '2026-10-24' },
      });

      const expenseId = await createExpenseRecord(
        {
          amount: 250,
          category: 'Petrol',
          notes: 'Two wheeler fuel',
        },
        mockStaffUser
      );

      expect(expenseId).toBe('exp_server_123');
      expect(functionsMod.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'recordExpense');
      expect(mockCallableFn).toHaveBeenCalledWith({
        amount: 250,
        category: 'Petrol',
        customExpenseName: null,
        notes: 'Two wheeler fuel',
        adminName: null,
        adminNameId: null,
      });
    });

    it('invokes recordExpense Cloud Function with admin attribution for admin user', async () => {
      mockCallableFn.mockResolvedValueOnce({
        data: { success: true, expenseId: 'exp_admin_456', businessDay: '2026-10-24' },
      });

      const expenseId = await createExpenseRecord(
        {
          amount: 500,
          category: 'Diesel',
          adminName: 'Farooq',
          adminNameId: 'admin_name_1',
        },
        mockAdminUser
      );

      expect(expenseId).toBe('exp_admin_456');
      expect(mockCallableFn).toHaveBeenCalledWith({
        amount: 500,
        category: 'Diesel',
        customExpenseName: null,
        notes: null,
        adminName: 'Farooq',
        adminNameId: 'admin_name_1',
      });
    });
  });

  describe('updateExpenseRecord', () => {
    it('invokes updateExpense Cloud Function with validated updates', async () => {
      mockCallableFn.mockResolvedValueOnce({
        data: { success: true, updatedBusinessDay: '2026-10-24' },
      });

      await updateExpenseRecord(
        'exp_1',
        { amount: 180, notes: 'Corrected fuel amount' },
        mockStaffUser
      );

      expect(functionsMod.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'updateExpense');
      expect(mockCallableFn).toHaveBeenCalledWith({
        expenseId: 'exp_1',
        amount: 180,
        category: undefined,
        customExpenseName: undefined,
        notes: 'Corrected fuel amount',
        editorAdminName: undefined,
      });
    });

    it('passes editorAdminName when Admin edits an expense', async () => {
      mockCallableFn.mockResolvedValueOnce({
        data: { success: true, updatedBusinessDay: '2026-10-24' },
      });

      await updateExpenseRecord(
        'exp_1',
        { amount: 220, category: 'Diesel', editorAdminName: 'Farooq' },
        mockAdminUser
      );

      expect(mockCallableFn).toHaveBeenCalledWith({
        expenseId: 'exp_1',
        amount: 220,
        category: 'Diesel',
        customExpenseName: undefined,
        notes: undefined,
        editorAdminName: 'Farooq',
      });
    });

    it('propagates error from Cloud Function if edit is rejected (e.g., closed business day)', async () => {
      mockCallableFn.mockRejectedValueOnce(
        new Error('Editing closed: Expenses from previous business days are permanently locked.')
      );

      await expect(
        updateExpenseRecord('exp_1', { amount: 200 }, mockStaffUser)
      ).rejects.toThrow('Editing closed: Expenses from previous business days are permanently locked.');
    });
  });

  describe('getExpensesByBusinessDayRange Scoping', () => {
    it('scopes query to createdBy == uid when caller is staff', async () => {
      const mockGetDocs = vi.mocked(firestore.getDocs);
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          {
            id: 'exp_staff',
            data: () => ({
              businessDay: '2026-10-24',
              amount: 100,
              createdBy: 'staff_123',
              createdAt: '2026-10-24T10:00:00Z',
            }),
          },
        ],
      } as any);

      await getExpensesByBusinessDayRange('2026-10-01', '2026-10-31', mockStaffUser);

      // Verify that query included where('createdBy', '==', 'staff_123')
      expect(firestore.where).toHaveBeenCalledWith('createdBy', '==', 'staff_123');
    });

    it('queries all expenses without createdBy constraint when caller is admin', async () => {
      const mockGetDocs = vi.mocked(firestore.getDocs);
      mockGetDocs.mockResolvedValueOnce({
        docs: [],
      } as any);

      await getExpensesByBusinessDayRange('2026-10-01', '2026-10-31', mockAdminUser);

      const whereCalls = vi.mocked(firestore.where).mock.calls;
      const createdByCalls = whereCalls.filter((call) => call[0] === 'createdBy');
      expect(createdByCalls).toHaveLength(0);
    });
  });

  describe('calculateExpenseSummary', () => {
    const testExpenses: ExpenseDocument[] = [
      {
        id: '1',
        businessDay: '2026-10-24',
        category: 'CNG',
        amount: 300,
        createdBy: 'staff_1',
        creatorName: 'Staff One',
        creatorRole: 'staff',
        createdAt: '2026-10-24T05:00:00Z',
        isEdited: false,
        editCount: 0,
        auditTrail: [],
      },
      {
        id: '2',
        businessDay: '2026-10-24',
        category: 'CNG',
        amount: 200,
        createdBy: 'staff_2',
        creatorName: 'Staff Two',
        creatorRole: 'staff',
        createdAt: '2026-10-24T06:00:00Z',
        isEdited: false,
        editCount: 0,
        auditTrail: [],
      },
      {
        id: '3',
        businessDay: '2026-10-24',
        category: 'Daily Food Expense',
        amount: 150,
        createdBy: 'admin_root',
        creatorName: 'Admin',
        creatorRole: 'admin',
        adminName: 'Rijash',
        createdAt: '2026-10-24T07:00:00Z',
        isEdited: false,
        editCount: 0,
        auditTrail: [],
      },
      {
        id: '4',
        businessDay: '2026-10-24',
        category: 'Other Expense',
        customExpenseName: 'Vehicle Washing',
        amount: 100,
        createdBy: 'admin_root',
        creatorName: 'Admin',
        creatorRole: 'admin',
        adminName: 'Farooq',
        createdAt: '2026-10-24T08:00:00Z',
        isEdited: false,
        editCount: 0,
        auditTrail: [],
      },
    ];

    it('computes total amount, total count, and category breakdown percentages', () => {
      const summary = calculateExpenseSummary(testExpenses, '2026-10-24', '2026-10-24', 'Today');

      expect(summary.totalAmount).toBe(750); // 300 + 200 + 150 + 100
      expect(summary.totalCount).toBe(4);

      const cngCat = summary.categories.find((c) => c.category === 'CNG');
      expect(cngCat).toBeDefined();
      expect(cngCat?.totalAmount).toBe(500);
      expect(cngCat?.count).toBe(2);
      expect(cngCat?.percentage).toBe(66.7); // 500 / 750 = 66.666... -> 66.7%

      const foodCat = summary.categories.find((c) => c.category === 'Daily Food Expense');
      expect(foodCat?.totalAmount).toBe(150);
      expect(foodCat?.percentage).toBe(20);

      // Custom Other Expense breakdown
      expect(summary.customOtherExpenses).toHaveLength(1);
      expect(summary.customOtherExpenses[0]).toEqual({
        customExpenseName: 'Vehicle Washing',
        totalAmount: 100,
        count: 1,
      });

      // Staff breakdown
      expect(summary.staffBreakdown).toHaveLength(3);
      const staffOne = summary.staffBreakdown.find((s) => s.staffUid === 'staff_1');
      expect(staffOne?.totalAmount).toBe(300);

      // Admin Attribution breakdown
      expect(summary.adminAttributionBreakdown).toHaveLength(2);
      const rijashAttr = summary.adminAttributionBreakdown.find((a) => a.adminName === 'Rijash');
      expect(rijashAttr?.totalAmount).toBe(150);
      const farooqAttr = summary.adminAttributionBreakdown.find((a) => a.adminName === 'Farooq');
      expect(farooqAttr?.totalAmount).toBe(100);
    });

    it('strictly excludes voided expenses (isVoided: true) from financial totals and counts', () => {
      const expensesWithVoided: ExpenseDocument[] = [
        ...testExpenses,
        {
          id: '5_voided',
          businessDay: '2026-10-24',
          category: 'Diesel',
          amount: 500, // Should NOT be added
          createdBy: 'staff_1',
          creatorName: 'Rahim',
          creatorRole: 'staff',
          createdAt: '2026-10-24T09:00:00Z',
          isEdited: false,
          editCount: 0,
          auditTrail: [],
          isVoided: true,
          voidReason: 'Mistaken duplicate entry',
          voidedAt: '2026-10-24T10:00:00Z',
          voidedByRole: 'admin',
        },
      ];

      const summary = calculateExpenseSummary(expensesWithVoided, '2026-10-24', '2026-10-24', 'Today');

      // Total must still be 750 (the 500 voided amount is strictly ignored)
      expect(summary.totalAmount).toBe(750);
      expect(summary.totalCount).toBe(4);

      const dieselCat = summary.categories.find((c) => c.category === 'Diesel');
      expect(dieselCat?.totalAmount).toBe(0);
      expect(dieselCat?.count).toBe(0);
    });
  });

  describe('voidExpenseRecord', () => {
    it('calls voidExpense Cloud Function with expenseId, reason, and adminName', async () => {
      mockCallableFn.mockResolvedValueOnce({
        data: { success: true, expenseId: 'exp_to_void', voidedAt: '2026-10-26T10:00:00.000Z' },
      });

      await voidExpenseRecord('exp_to_void', 'Duplicate invoice recorded', mockAdminUser, 'Rijash');

      expect(mockCallableFn).toHaveBeenCalledWith({
        expenseId: 'exp_to_void',
        voidReason: 'Duplicate invoice recorded',
        adminName: 'Rijash',
      });
    });

    it('rejects voiding if caller is not Admin', async () => {
      await expect(
        voidExpenseRecord('exp_1', 'Reason', mockStaffUser)
      ).rejects.toThrow('Unauthorized: Only administrators can void expenses.');
    });

    it('rejects voiding if reason is missing or too short', async () => {
      await expect(
        voidExpenseRecord('exp_1', '  ', mockAdminUser)
      ).rejects.toThrow('at least 3 characters');
    });
  });
});
