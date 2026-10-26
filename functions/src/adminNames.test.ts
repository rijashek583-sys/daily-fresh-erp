import { describe, it, expect } from 'vitest';
import { handleManageAdminName, validateAdminNameString } from './adminNames';
import { type AuthenticatedUser } from './authValidation';

function createMockAdminNamesFirestore(initialData: Record<string, any> = {}) {
  const store: Record<string, any> = { ...initialData };

  return {
    store,
    firestore: {
      collection: (col: string) => {
        if (col !== 'adminNames') throw new Error(`Unexpected collection: ${col}`);
        return {
          doc: (docId: string) => ({
            get: async () => {
              if (docId in store) {
                return {
                  exists: true,
                  id: docId,
                  data: () => store[docId],
                };
              }
              return { exists: false, id: docId, data: () => undefined };
            },
            set: async (data: any) => {
              store[docId] = { ...data };
            },
            update: async (data: any) => {
              if (!(docId in store)) throw new Error('Not found');
              store[docId] = { ...store[docId], ...data };
            },
          }),
          where: (field: string, op: string, val: any) => ({
            get: async () => {
              const matches = Object.entries(store)
                .filter(([_, data]) => {
                  if (op === '==') return data[field] === val;
                  return false;
                })
                .map(([id, data]) => ({
                  id,
                  data: () => data,
                }));
              return {
                empty: matches.length === 0,
                docs: matches,
              };
            },
          }),
        };
      },
    } as any,
  };
}

describe('Admin Name Registry Backend Management (handleManageAdminName)', () => {
  const adminCaller: AuthenticatedUser = {
    uid: 'admin_123',
    displayName: 'Main Admin',
    role: 'admin',
    status: 'active',
  };

  const staffCaller: AuthenticatedUser = {
    uid: 'staff_456',
    displayName: 'Staff Operator',
    role: 'staff',
    status: 'active',
  };

  describe('Authorization Check', () => {
    it('rejects staff callers with permission-denied', async () => {
      const { firestore } = createMockAdminNamesFirestore();
      await expect(
        handleManageAdminName(firestore, staffCaller, {
          action: 'register',
          name: 'Shabeer',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'permission-denied',
          message: expect.stringContaining('Only Admins can manage'),
        })
      );
    });
  });

  describe('Input Validation (validateAdminNameString)', () => {
    it('rejects empty or whitespace-only name', () => {
      expect(validateAdminNameString('').valid).toBe(false);
      expect(validateAdminNameString('   ').valid).toBe(false);
      expect(validateAdminNameString('   ').error).toBe('Admin name is required.');
    });

    it('rejects name shorter than 2 characters', () => {
      expect(validateAdminNameString('A').valid).toBe(false);
      expect(validateAdminNameString('A').error).toContain('at least 2 characters');
    });

    it('rejects name longer than 50 characters', () => {
      const longName = 'A'.repeat(51);
      expect(validateAdminNameString(longName).valid).toBe(false);
      expect(validateAdminNameString(longName).error).toContain('cannot exceed 50 characters');
    });

    it('trims and validates acceptable name', () => {
      const res = validateAdminNameString('  Rijash EK  ');
      expect(res.valid).toBe(true);
      expect(res.normalized).toBe('Rijash EK');
    });
  });

  describe('Action: register', () => {
    it('successfully registers a new admin name with status active', async () => {
      const { firestore, store } = createMockAdminNamesFirestore();
      const res = await handleManageAdminName(firestore, adminCaller, {
        action: 'register',
        name: 'Farooq',
      });

      expect(res.success).toBe(true);
      expect(res.adminNameId).toBeDefined();

      const saved = store[res.adminNameId!];
      expect(saved.name).toBe('Farooq');
      expect(saved.nameLower).toBe('farooq');
      expect(saved.status).toBe('active');
      expect(saved.createdByUid).toBe('admin_123');
      expect(saved.createdAt).toBeDefined();
    });

    it('rejects duplicate name (case-insensitive) when active', async () => {
      const { firestore } = createMockAdminNamesFirestore({
        existing_1: {
          id: 'existing_1',
          name: 'Shabeer',
          nameLower: 'shabeer',
          status: 'active',
        },
      });

      await expect(
        handleManageAdminName(firestore, adminCaller, {
          action: 'register',
          name: 'SHABEER',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'already-exists',
          message: expect.stringContaining('already exists'),
        })
      );
    });

    it('alerts user to reactivate if duplicate name is currently deactivated', async () => {
      const { firestore } = createMockAdminNamesFirestore({
        existing_2: {
          id: 'existing_2',
          name: 'Moideen',
          nameLower: 'moideen',
          status: 'inactive',
        },
      });

      await expect(
        handleManageAdminName(firestore, adminCaller, {
          action: 'register',
          name: 'Moideen',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'already-exists',
          message: expect.stringContaining('currently deactivated. Please reactivate'),
        })
      );
    });
  });

  describe('Action: toggle_status (Soft Deactivation / Reactivation)', () => {
    it('deactivates an active admin name', async () => {
      const { firestore, store } = createMockAdminNamesFirestore({
        admin_op: {
          id: 'admin_op',
          name: 'Operational Operator',
          status: 'active',
        },
      });

      const res = await handleManageAdminName(firestore, adminCaller, {
        action: 'toggle_status',
        adminNameId: 'admin_op',
        newStatus: 'inactive',
      });

      expect(res.success).toBe(true);
      expect(store.admin_op.status).toBe('inactive');
      expect(store.admin_op.updatedAt).toBeDefined();
    });

    it('reactivates an inactive admin name', async () => {
      const { firestore, store } = createMockAdminNamesFirestore({
        admin_op: {
          id: 'admin_op',
          name: 'Operational Operator',
          status: 'inactive',
        },
      });

      const res = await handleManageAdminName(firestore, adminCaller, {
        action: 'toggle_status',
        adminNameId: 'admin_op',
        newStatus: 'active',
      });

      expect(res.success).toBe(true);
      expect(store.admin_op.status).toBe('active');
    });

    it('rejects toggle for non-existent admin name with not-found', async () => {
      const { firestore } = createMockAdminNamesFirestore();
      await expect(
        handleManageAdminName(firestore, adminCaller, {
          action: 'toggle_status',
          adminNameId: 'missing_id',
          newStatus: 'inactive',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'not-found',
        })
      );
    });
  });

  describe('Action: rename', () => {
    it('renames an admin name and updates nameLower', async () => {
      const { firestore, store } = createMockAdminNamesFirestore({
        admin_1: {
          id: 'admin_1',
          name: 'Farok',
          nameLower: 'farok',
          status: 'active',
        },
      });

      const res = await handleManageAdminName(firestore, adminCaller, {
        action: 'rename',
        adminNameId: 'admin_1',
        name: 'Farooq Corrected',
      });

      expect(res.success).toBe(true);
      expect(store.admin_1.name).toBe('Farooq Corrected');
      expect(store.admin_1.nameLower).toBe('farooq corrected');
    });

    it('rejects rename if new name conflicts with another record', async () => {
      const { firestore } = createMockAdminNamesFirestore({
        admin_1: {
          id: 'admin_1',
          name: 'Farok',
          nameLower: 'farok',
          status: 'active',
        },
        admin_2: {
          id: 'admin_2',
          name: 'Shabeer',
          nameLower: 'shabeer',
          status: 'active',
        },
      });

      await expect(
        handleManageAdminName(firestore, adminCaller, {
          action: 'rename',
          adminNameId: 'admin_1',
          name: 'Shabeer',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'already-exists',
          message: expect.stringContaining('already registered'),
        })
      );
    });
  });

  describe('Zero-Deletion Guarantee', () => {
    it('permanently rejects delete requests across any role', async () => {
      const { firestore } = createMockAdminNamesFirestore();

      await expect(
        handleManageAdminName(firestore, adminCaller, {
          action: 'delete' as any,
          adminNameId: 'any_id',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('Deletions are forbidden'),
        })
      );
    });
  });
});
