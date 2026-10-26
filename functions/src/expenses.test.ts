import { describe, it, expect, vi } from 'vitest';
import {
  handleRecordExpense,
  handleUpdateExpense,
  handleVoidExpense,
  validateRecordExpenseInput,
  EXPENSES_COLLECTION,
} from './expenses';
import { type AuthenticatedUser } from './authValidation';
import { getServerBusinessDayKey } from './businessDayServer';

function createMockExpensesFirestore(initialData: {
  adminNames?: Record<string, any>;
  expenses?: Record<string, any>;
} = {}) {
  const adminNamesStore: Record<string, any> = { ...(initialData.adminNames || {}) };
  const expensesStore: Record<string, any> = { ...(initialData.expenses || {}) };

  const firestore = {
    collection: (col: string) => {
      if (col === 'adminNames') {
        return {
          doc: (id: string) => ({
            get: async () => {
              if (id in adminNamesStore) {
                return { exists: true, id, data: () => adminNamesStore[id] };
              }
              return { exists: false, id, data: () => undefined };
            },
          }),
        };
      }
      if (col === EXPENSES_COLLECTION) {
        return {
          doc: (id: string) => ({
            get: async () => {
              if (id in expensesStore) {
                return { exists: true, id, data: () => expensesStore[id] };
              }
              return { exists: false, id, data: () => undefined };
            },
            set: async (data: any) => {
              expensesStore[id] = { ...data };
            },
            update: async (data: any) => {
              if (!(id in expensesStore)) throw new Error('Not found');
              expensesStore[id] = { ...expensesStore[id], ...data };
            },
          }),
        };
      }
      throw new Error(`Unexpected collection: ${col}`);
    },
    runTransaction: async (updateFunction: (transaction: any) => Promise<any>) => {
      const transaction = {
        get: async (docRef: any) => docRef.get(),
        set: (docRef: any, data: any) => docRef.set(data),
        update: (docRef: any, data: any) => {
          // Handle FieldValue.arrayUnion simulation
          const currentDoc = expensesStore[docRef.id || Object.keys(expensesStore)[0]];
          const updated = { ...data };
          if (data.auditTrail && typeof data.auditTrail === 'object' && 'arrayUnionValue' in data.auditTrail) {
            updated.auditTrail = [...(currentDoc?.auditTrail || []), data.auditTrail.arrayUnionValue];
          }
          return docRef.update(updated);
        },
      };
      return await updateFunction(transaction);
    },
  } as any;

  return { firestore, adminNamesStore, expensesStore };
}

// Mock firebase-admin FieldValue
vi.mock('firebase-admin', () => {
  return {
    firestore: {
      FieldValue: {
        serverTimestamp: () => 'SERVER_TIMESTAMP_MOCK',
        arrayUnion: (val: any) => ({ arrayUnionValue: val }),
      },
    },
  };
});

describe('Trusted Expense Backend Functions (expenses.ts)', () => {
  const adminCaller: AuthenticatedUser = {
    uid: 'admin_user_uid',
    displayName: 'Admin Root',
    role: 'admin',
    status: 'active',
  };

  const staffCallerA: AuthenticatedUser = {
    uid: 'staff_user_a',
    displayName: 'Rahman Driver',
    role: 'staff',
    status: 'active',
  };

  const staffCallerB: AuthenticatedUser = {
    uid: 'staff_user_b',
    displayName: 'Suresh Helper',
    role: 'staff',
    status: 'active',
  };

  describe('Input Validation & Constraints (validateRecordExpenseInput)', () => {
    it('rejects invalid or non-positive amount', async () => {
      const { firestore } = createMockExpensesFirestore();
      await expect(
        validateRecordExpenseInput(firestore, staffCallerA, {
          amount: 0,
          category: 'Diesel',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('positive number greater than 0'),
        })
      );

      await expect(
        validateRecordExpenseInput(firestore, staffCallerA, {
          amount: -50,
          category: 'Diesel',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
        })
      );
    });

    it('rejects unsupported expense category', async () => {
      const { firestore } = createMockExpensesFirestore();
      await expect(
        validateRecordExpenseInput(firestore, staffCallerA, {
          amount: 250,
          category: 'Luxury Hotel' as any,
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('Invalid category'),
        })
      );
    });

    it('requires customExpenseName when category is Other Expense', async () => {
      const { firestore } = createMockExpensesFirestore();
      await expect(
        validateRecordExpenseInput(firestore, staffCallerA, {
          amount: 150,
          category: 'Other Expense',
          customExpenseName: '',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('A specific expense name is required'),
        })
      );

      await expect(
        validateRecordExpenseInput(firestore, staffCallerA, {
          amount: 150,
          category: 'Other Expense',
          customExpenseName: 'A', // too short
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('between 2 and 50 characters'),
        })
      );
    });

    it('rejects notes exceeding 500 characters', async () => {
      const { firestore } = createMockExpensesFirestore();
      await expect(
        validateRecordExpenseInput(firestore, staffCallerA, {
          amount: 100,
          category: 'CNG',
          notes: 'A'.repeat(501),
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('cannot exceed 500 characters'),
        })
      );
    });
  });

  describe('Admin Attribution vs Staff Boundary', () => {
    it('requires adminName and adminNameId when Admin records an expense', async () => {
      const { firestore } = createMockExpensesFirestore();
      await expect(
        validateRecordExpenseInput(firestore, adminCaller, {
          amount: 500,
          category: 'Diesel',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('Admin operator attribution (adminName and adminNameId) is mandatory'),
        })
      );
    });

    it('rejects Admin expense when adminNameId is not found in registry', async () => {
      const { firestore } = createMockExpensesFirestore();
      await expect(
        validateRecordExpenseInput(firestore, adminCaller, {
          amount: 500,
          category: 'Diesel',
          adminName: 'Shabeer',
          adminNameId: 'non_existent_admin_id',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'not-found',
          message: expect.stringContaining('does not exist in registry'),
        })
      );
    });

    it('rejects Admin expense when selected Admin Name is deactivated', async () => {
      const { firestore } = createMockExpensesFirestore({
        adminNames: {
          inactive_admin: {
            id: 'inactive_admin',
            name: 'Deactivated Operator',
            status: 'inactive',
          },
        },
      });

      await expect(
        validateRecordExpenseInput(firestore, adminCaller, {
          amount: 500,
          category: 'Diesel',
          adminName: 'Deactivated Operator',
          adminNameId: 'inactive_admin',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'failed-precondition',
          message: expect.stringContaining('is currently deactivated'),
        })
      );
    });

    it('rejects Staff expense if Staff attempts to provide an adminName', async () => {
      const { firestore } = createMockExpensesFirestore();
      await expect(
        validateRecordExpenseInput(firestore, staffCallerA, {
          amount: 200,
          category: 'Toll',
          adminName: 'Rijash',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('Staff members cannot record expenses under an Admin display name'),
        })
      );
    });
  });

  describe('Server Business Day Assignment & Expense Creation (handleRecordExpense)', () => {
    it('creates expense with authoritative server business day and creator identity', async () => {
      const { firestore, expensesStore } = createMockExpensesFirestore();
      // Test at 2026-10-25 01:30:00 AM IST (which belongs to 2026-10-24 business day)
      const serverInstant = new Date('2026-10-24T20:00:00.000Z').getTime();

      const res = await handleRecordExpense(
        firestore,
        staffCallerA,
        {
          amount: 350.5,
          category: 'Petrol',
          notes: 'Emergency fuel near Kozhikode',
        },
        serverInstant
      );

      expect(res.success).toBe(true);
      expect(res.businessDay).toBe('2026-10-24');

      const saved = expensesStore[res.expenseId];
      expect(saved).toBeDefined();
      expect(saved.businessDay).toBe('2026-10-24');
      expect(saved.createdBy).toBe('staff_user_a');
      expect(saved.creatorName).toBe('Rahman Driver');
      expect(saved.creatorRole).toBe('staff');
      expect(saved.adminName).toBeNull();
      expect(saved.adminNameId).toBeNull();
      expect(saved.amount).toBe(350.5);
      expect(saved.isEdited).toBe(false);
      expect(saved.editCount).toBe(0);
      expect(saved.auditTrail).toEqual([]);
    });

    it('creates Admin-attributed expense when active admin name is provided', async () => {
      const { firestore, expensesStore } = createMockExpensesFirestore({
        adminNames: {
          admin_op_1: {
            id: 'admin_op_1',
            name: 'Farooq',
            status: 'active',
          },
        },
      });

      const serverInstant = new Date('2026-10-25T04:30:00.000Z').getTime(); // 10:00 AM IST -> 2026-10-25

      const res = await handleRecordExpense(
        firestore,
        adminCaller,
        {
          amount: 1200,
          category: 'Other Expense',
          customExpenseName: 'Tyre Replacement',
          adminName: 'Farooq',
          adminNameId: 'admin_op_1',
        },
        serverInstant
      );

      expect(res.success).toBe(true);
      expect(res.businessDay).toBe('2026-10-25');

      const saved = expensesStore[res.expenseId];
      expect(saved.adminName).toBe('Farooq');
      expect(saved.adminNameId).toBe('admin_op_1');
      expect(saved.createdBy).toBe('admin_user_uid');
      expect(saved.creatorRole).toBe('admin');
      expect(saved.customExpenseName).toBe('Tyre Replacement');
    });
  });

  describe('Transactional Editing & Business Day Lockout (handleUpdateExpense)', () => {
    it('rejects editing an expense from a previous closed business day', async () => {
      // Expense was recorded on 2026-10-24
      const { firestore } = createMockExpensesFirestore({
        expenses: {
          exp_yesterday: {
            id: 'exp_yesterday',
            businessDay: '2026-10-24',
            amount: 500,
            category: 'Diesel',
            createdBy: 'staff_user_a',
            creatorRole: 'staff',
            creatorName: 'Rahman Driver',
            createdAt: '2026-10-24T18:00:00.000Z',
          },
        },
      });

      // Now server time has advanced past 2:00 AM IST on Oct 25 -> business day is 2026-10-25
      const nowMs = new Date('2026-10-24T20:30:00.000Z').getTime(); // 02:00:00 AM IST = 2026-10-25

      await expect(
        handleUpdateExpense(
          firestore,
          adminCaller,
          {
            expenseId: 'exp_yesterday',
            amount: 600,
            editorAdminName: 'Shabeer',
          },
          nowMs
        )
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'failed-precondition',
          message: expect.stringContaining('Editing closed: Expenses from previous business days are permanently locked'),
        })
      );
    });

    it('rejects staff user editing another user expense', async () => {
      const nowMs = new Date('2026-10-25T04:30:00.000Z').getTime(); // 2026-10-25
      const currentDay = getServerBusinessDayKey(nowMs);

      const { firestore } = createMockExpensesFirestore({
        expenses: {
          exp_user_b: {
            id: 'exp_user_b',
            businessDay: currentDay,
            amount: 200,
            category: 'Toll',
            createdBy: staffCallerB.uid, // Created by Suresh
            creatorRole: staffCallerB.role,
            creatorName: staffCallerB.displayName,
          },
        },
      });

      // Rahman attempts to edit Suresh's record
      await expect(
        handleUpdateExpense(
          firestore,
          staffCallerA,
          {
            expenseId: 'exp_user_b',
            amount: 250,
          },
          nowMs
        )
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'permission-denied',
          message: expect.stringContaining('Staff members can only edit their own expense records'),
        })
      );
    });

    it('allows staff user to edit own expense during open business day', async () => {
      const nowMs = new Date('2026-10-25T04:30:00.000Z').getTime();
      const currentDay = getServerBusinessDayKey(nowMs);

      const { firestore, expensesStore } = createMockExpensesFirestore({
        expenses: {
          exp_user_a: {
            id: 'exp_user_a',
            businessDay: currentDay,
            amount: 200,
            category: 'Toll',
            notes: 'Initial toll note',
            createdBy: 'staff_user_a',
            creatorRole: 'staff',
            creatorName: 'Rahman Driver',
            isEdited: false,
            editCount: 0,
            auditTrail: [],
          },
        },
      });

      const res = await handleUpdateExpense(
        firestore,
        staffCallerA,
        {
          expenseId: 'exp_user_a',
          amount: 220,
          notes: 'Updated toll with receipt',
        },
        nowMs
      );

      expect(res.success).toBe(true);

      const updated = expensesStore.exp_user_a;
      expect(updated.amount).toBe(220);
      expect(updated.notes).toBe('Updated toll with receipt');
      expect(updated.isEdited).toBe(true);
      expect(updated.editCount).toBe(1);

      // Verify creator fields remain immutable
      expect(updated.createdBy).toBe('staff_user_a');
      expect(updated.creatorRole).toBe('staff');
      expect(updated.creatorName).toBe('Rahman Driver');

      // Verify audit record appended
      expect(updated.auditTrail).toHaveLength(1);
      const audit = updated.auditTrail[0];
      expect(audit.editedByUid).toBe('staff_user_a');
      expect(audit.editorRole).toBe('staff');
      expect(audit.previousValues.amount).toBe(200);
      expect(audit.newValues.amount).toBe(220);
    });

    it('allows Admin to edit Staff expense, preserving root creator fields and recording editor attribution in audit trail', async () => {
      const nowMs = new Date('2026-10-25T04:30:00.000Z').getTime();
      const currentDay = getServerBusinessDayKey(nowMs);

      const { firestore, expensesStore } = createMockExpensesFirestore({
        expenses: {
          exp_staff_created: {
            id: 'exp_staff_created',
            businessDay: currentDay,
            amount: 450,
            category: 'Daily Food Expense',
            notes: 'Breakfast for loading team',
            createdBy: 'staff_user_a',
            creatorRole: 'staff',
            creatorName: 'Rahman Driver',
            adminName: null,
            adminNameId: null,
            createdAt: '2026-10-25T03:00:00.000Z',
            isEdited: false,
            editCount: 0,
            auditTrail: [],
          },
        },
      });

      const res = await handleUpdateExpense(
        firestore,
        adminCaller,
        {
          expenseId: 'exp_staff_created',
          amount: 480,
          notes: 'Approved breakfast + tea',
          editorAdminName: 'Shabeer (Admin)',
        },
        nowMs
      );

      expect(res.success).toBe(true);

      const updated = expensesStore.exp_staff_created;
      expect(updated.amount).toBe(480);
      expect(updated.notes).toBe('Approved breakfast + tea');
      expect(updated.isEdited).toBe(true);
      expect(updated.editCount).toBe(1);

      // CRITICAL: Creator fields and root attribution remain strictly unchanged
      expect(updated.createdBy).toBe('staff_user_a');
      expect(updated.creatorRole).toBe('staff');
      expect(updated.creatorName).toBe('Rahman Driver');
      expect(updated.adminName).toBeNull();
      expect(updated.adminNameId).toBeNull();

      // Editor attribution recorded solely in audit trail
      expect(updated.auditTrail).toHaveLength(1);
      const audit = updated.auditTrail[0];
      expect(audit.editedByUid).toBe('admin_user_uid');
      expect(audit.editorRole).toBe('admin');
      expect(audit.editorAdminName).toBe('Shabeer (Admin)');
      expect(audit.previousValues.amount).toBe(450);
      expect(audit.newValues.amount).toBe(480);
    });

    it('requires editorAdminName when Admin edits an expense', async () => {
      const nowMs = new Date('2026-10-25T04:30:00.000Z').getTime();
      const currentDay = getServerBusinessDayKey(nowMs);

      const { firestore } = createMockExpensesFirestore({
        expenses: {
          exp_1: {
            id: 'exp_1',
            businessDay: currentDay,
            amount: 300,
            category: 'Diesel',
            createdBy: 'admin_user_uid',
            creatorRole: 'admin',
          },
        },
      });

      await expect(
        handleUpdateExpense(
          firestore,
          adminCaller,
          {
            expenseId: 'exp_1',
            amount: 350,
            // editorAdminName omitted
          },
          nowMs
        )
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('Admin operator attribution (editorAdminName) is required'),
        })
      );
    });

    it('rejects editing if transaction starts before 2:00 AM IST but retries at or after 2:00 AM IST', async () => {
      // Oct 24 business day:
      // Before cutoff: Oct 25 01:59:59.900 AM IST = 2026-10-24T20:29:59.900Z (business day 2026-10-24)
      // After cutoff:  Oct 25 02:00:00.050 AM IST = 2026-10-24T20:30:00.050Z (business day 2026-10-25)
      const beforeCutoffMs = new Date('2026-10-24T20:29:59.900Z').getTime();
      const afterCutoffMs = new Date('2026-10-24T20:30:00.050Z').getTime();

      let timeCallCount = 0;
      // Dynamic time provider that advances across cutoff on retry
      const dynamicTimeProvider = () => {
        timeCallCount++;
        return timeCallCount === 1 ? beforeCutoffMs : afterCutoffMs;
      };

      const { firestore } = createMockExpensesFirestore({
        expenses: {
          exp_boundary: {
            id: 'exp_boundary',
            businessDay: '2026-10-24',
            amount: 250,
            category: 'CNG',
            createdBy: 'staff_user_a',
            creatorRole: 'staff',
            creatorName: 'Rahman Driver',
          },
        },
      });

      // Wrap runTransaction to simulate optimistic locking collision on attempt 1, followed by retry
      const baseRunTransaction = firestore.runTransaction;
      let attempts = 0;
      firestore.runTransaction = async (updateFunction: any) => {
        attempts++;
        try {
          // Attempt 1: simulate a concurrent write collision error
          await updateFunction({
            get: async () => ({
              exists: true,
              data: () => ({
                id: 'exp_boundary',
                businessDay: '2026-10-24',
                amount: 250,
                category: 'CNG',
                createdBy: 'staff_user_a',
                creatorRole: 'staff',
                creatorName: 'Rahman Driver',
              }),
            }),
            update: () => {
              throw new Error('Transaction failed: contention detected');
            },
          });
        } catch (err: any) {
          if (err.message.includes('contention detected')) {
            // Attempt 2: retry transaction, by which time clock has passed 02:00:00 AM IST
            return await baseRunTransaction(updateFunction);
          }
          throw err;
        }
      };

      await expect(
        handleUpdateExpense(
          firestore,
          staffCallerA,
          {
            expenseId: 'exp_boundary',
            amount: 300,
          },
          dynamicTimeProvider
        )
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'failed-precondition',
          message: expect.stringContaining('Editing closed: Expenses from previous business days are permanently locked'),
        })
      );

      expect(attempts).toBe(1);
      expect(timeCallCount).toBe(2); // Attempt 1 called time before cutoff; Attempt 2 called time after cutoff and rejected
    });
  });

  describe('handleVoidExpense — Admin-Only Expense Void With Required Reason', () => {
    it('allows Admin to void an expense with non-empty reason, preserving record and appending audit trail', async () => {
      const { firestore, expensesStore } = createMockExpensesFirestore({
        expenses: {
          exp_101: {
            id: 'exp_101',
            businessDay: '2026-10-26',
            amount: 550,
            category: 'Petrol',
            createdBy: 'staff_user_a',
            creatorRole: 'staff',
            creatorName: 'Rahman Driver',
            createdAt: '2026-10-26T08:00:00.000Z',
            isEdited: false,
            editCount: 0,
            auditTrail: [],
          },
        },
      });

      const res = await handleVoidExpense(firestore, adminCaller, {
        expenseId: 'exp_101',
        voidReason: 'Vehicle fuel bill was cancelled and reimbursed in cash',
        adminName: 'Rijash',
      });

      expect(res.success).toBe(true);
      expect(res.expenseId).toBe('exp_101');
      expect(res.voidedAt).toBeDefined();

      const stored = expensesStore['exp_101'];
      expect(stored.isVoided).toBe(true);
      expect(stored.voidReason).toBe('Vehicle fuel bill was cancelled and reimbursed in cash');
      expect(stored.voidedByUid).toBe('admin_user_uid');
      expect(stored.voidedByName).toBe('Admin Root');
      expect(stored.voidedByRole).toBe('admin');
      expect(stored.voidedByAdminName).toBe('Rijash');
      // Original amount, category, and creator attribution remain intact
      expect(stored.amount).toBe(550);
      expect(stored.category).toBe('Petrol');
      expect(stored.createdBy).toBe('staff_user_a');
      expect(stored.creatorName).toBe('Rahman Driver');

      // Audit trail contains void record
      expect(stored.auditTrail).toHaveLength(1);
      expect(stored.auditTrail[0].action).toBe('void');
      expect(stored.auditTrail[0].voidReason).toBe('Vehicle fuel bill was cancelled and reimbursed in cash');
      expect(stored.auditTrail[0].previousValues.amount).toBe(550);
    });

    it('rejects Staff attempt to void an expense with permission-denied', async () => {
      const { firestore } = createMockExpensesFirestore({
        expenses: {
          exp_102: {
            id: 'exp_102',
            businessDay: '2026-10-26',
            amount: 200,
            category: 'Daily Food Expense',
            createdBy: 'staff_user_a',
            creatorRole: 'staff',
            creatorName: 'Rahman Driver',
          },
        },
      });

      await expect(
        handleVoidExpense(firestore, staffCallerA, {
          expenseId: 'exp_102',
          voidReason: 'Mistaken entry',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'permission-denied',
          message: expect.stringContaining('Only administrators can void expenses'),
        })
      );
    });

    it('rejects void when reason is missing, empty, or shorter than 3 characters', async () => {
      const { firestore } = createMockExpensesFirestore({
        expenses: {
          exp_103: {
            id: 'exp_103',
            amount: 300,
            category: 'Toll',
            createdBy: 'admin_user_uid',
            creatorRole: 'admin',
          },
        },
      });

      // Empty string
      await expect(
        handleVoidExpense(firestore, adminCaller, {
          expenseId: 'exp_103',
          voidReason: '   ',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('at least 3 characters'),
        })
      );

      // Too short (< 3 chars)
      await expect(
        handleVoidExpense(firestore, adminCaller, {
          expenseId: 'exp_103',
          voidReason: 'no',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('at least 3 characters'),
        })
      );
    });

    it('rejects repeated void attempt with failed-precondition (idempotent / no duplicate voiding)', async () => {
      const { firestore } = createMockExpensesFirestore({
        expenses: {
          exp_104: {
            id: 'exp_104',
            amount: 400,
            category: 'CNG',
            createdBy: 'staff_user_a',
            creatorRole: 'staff',
            isVoided: true,
            voidReason: 'Already voided yesterday',
            voidedAt: '2026-10-25T12:00:00.000Z',
          },
        },
      });

      await expect(
        handleVoidExpense(firestore, adminCaller, {
          expenseId: 'exp_104',
          voidReason: 'Trying to void a second time',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'failed-precondition',
          message: expect.stringContaining('Expense has already been voided'),
        })
      );
    });

    it('prevents editing a voided expense via handleUpdateExpense', async () => {
      const { firestore } = createMockExpensesFirestore({
        expenses: {
          exp_105: {
            id: 'exp_105',
            businessDay: '2026-10-26',
            amount: 500,
            category: 'Diesel',
            createdBy: 'admin_user_uid',
            creatorRole: 'admin',
            isVoided: true,
            voidReason: 'Cancelled duplicate invoice',
            voidedAt: '2026-10-26T09:00:00.000Z',
          },
        },
      });

      await expect(
        handleUpdateExpense(firestore, adminCaller, {
          expenseId: 'exp_105',
          amount: 600,
          editorAdminName: 'Rijash',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'failed-precondition',
          message: expect.stringContaining('Voided expenses cannot be edited'),
        })
      );
    });

    it('rejects void on non-existent expense with not-found', async () => {
      const { firestore } = createMockExpensesFirestore();

      await expect(
        handleVoidExpense(firestore, adminCaller, {
          expenseId: 'non_existent_id',
          voidReason: 'Valid reason for ghost item',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'not-found',
          message: expect.stringContaining('Expense record not found'),
        })
      );
    });
  });
});
