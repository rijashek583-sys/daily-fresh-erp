import { describe, it, expect } from 'vitest';
import { validateAndFetchActiveUser } from './authValidation';

function createMockFirestore(userDocs: Record<string, any>) {
  return {
    collection: (col: string) => {
      if (col !== 'users') throw new Error(`Unexpected collection: ${col}`);
      return {
        doc: (uid: string) => ({
          get: async () => {
            if (uid in userDocs) {
              return {
                exists: true,
                id: uid,
                data: () => userDocs[uid],
              };
            }
            return {
              exists: false,
              id: uid,
              data: () => undefined,
            };
          },
        }),
      };
    },
  } as any;
}

describe('Backend Authentication & Role Authorization (validateAndFetchActiveUser)', () => {
  it('throws unauthenticated HttpsError when authUid is missing', async () => {
    const firestore = createMockFirestore({});
    await expect(validateAndFetchActiveUser(firestore, undefined)).rejects.toThrowError(
      expect.objectContaining({
        code: 'unauthenticated',
        message: expect.stringContaining('Authentication required'),
      })
    );

    await expect(validateAndFetchActiveUser(firestore, '')).rejects.toThrowError(
      expect.objectContaining({
        code: 'unauthenticated',
      })
    );
  });

  it('throws permission-denied when user does not exist in /users/{uid}', async () => {
    const firestore = createMockFirestore({});
    await expect(validateAndFetchActiveUser(firestore, 'non_existent_uid')).rejects.toThrowError(
      expect.objectContaining({
        code: 'permission-denied',
        message: expect.stringContaining('User profile not found'),
      })
    );
  });

  it('throws permission-denied when user status is inactive', async () => {
    const firestore = createMockFirestore({
      deactivated_user: {
        role: 'staff',
        status: 'inactive',
        displayName: 'Old Staff',
      },
    });

    await expect(validateAndFetchActiveUser(firestore, 'deactivated_user')).rejects.toThrowError(
      expect.objectContaining({
        code: 'permission-denied',
        message: expect.stringContaining('Account is deactivated'),
      })
    );
  });

  it('defaults legacy users without status field to active', async () => {
    const firestore = createMockFirestore({
      legacy_staff: {
        role: 'staff',
        // status omitted
        displayName: 'Legacy Staff Member',
      },
    });

    const user = await validateAndFetchActiveUser(firestore, 'legacy_staff');
    expect(user).toEqual({
      uid: 'legacy_staff',
      displayName: 'Legacy Staff Member',
      role: 'staff',
      status: 'active',
      email: undefined,
    });
  });

  it('throws permission-denied for invalid or unauthorized roles', async () => {
    const firestore = createMockFirestore({
      guest_user: {
        role: 'guest',
        status: 'active',
        displayName: 'Guest',
      },
      customer_user: {
        role: 'customer',
        status: 'active',
        displayName: 'Customer',
      },
      norole_user: {
        status: 'active',
        displayName: 'No Role',
      },
    });

    await expect(validateAndFetchActiveUser(firestore, 'guest_user')).rejects.toThrowError(
      expect.objectContaining({
        code: 'permission-denied',
        message: expect.stringContaining('Invalid or unauthorized user role'),
      })
    );

    await expect(validateAndFetchActiveUser(firestore, 'customer_user')).rejects.toThrowError(
      expect.objectContaining({
        code: 'permission-denied',
        message: expect.stringContaining('Invalid or unauthorized user role'),
      })
    );

    await expect(validateAndFetchActiveUser(firestore, 'norole_user')).rejects.toThrowError(
      expect.objectContaining({
        code: 'permission-denied',
      })
    );
  });

  it('validates active admin user successfully', async () => {
    const firestore = createMockFirestore({
      admin_uid: {
        role: 'admin',
        status: 'active',
        displayName: 'Daily Fresh Admin',
        email: 'admin@dailyfresh.com',
      },
    });

    const user = await validateAndFetchActiveUser(firestore, 'admin_uid');
    expect(user).toEqual({
      uid: 'admin_uid',
      email: 'admin@dailyfresh.com',
      displayName: 'Daily Fresh Admin',
      role: 'admin',
      status: 'active',
    });
  });

  it('validates active staff user successfully', async () => {
    const firestore = createMockFirestore({
      staff_uid: {
        role: 'staff',
        status: 'active',
        displayName: 'Rahman Driver',
        email: 'rahman@dailyfresh.com',
      },
    });

    const user = await validateAndFetchActiveUser(firestore, 'staff_uid');
    expect(user).toEqual({
      uid: 'staff_uid',
      email: 'rahman@dailyfresh.com',
      displayName: 'Rahman Driver',
      role: 'staff',
      status: 'active',
    });
  });

  it('validates active delivery_staff user successfully', async () => {
    const firestore = createMockFirestore({
      delivery_uid: {
        role: 'delivery_staff',
        status: 'active',
        name: 'Suresh Van',
      },
    });

    const user = await validateAndFetchActiveUser(firestore, 'delivery_uid');
    expect(user).toEqual({
      uid: 'delivery_uid',
      displayName: 'Suresh Van',
      role: 'delivery_staff',
      status: 'active',
      email: undefined,
    });
  });

  it('falls back to email username when displayName is missing', async () => {
    const firestore = createMockFirestore({
      staff_no_name: {
        role: 'staff',
        status: 'active',
        email: 'farooq@dailyfresh.com',
      },
    });

    const user = await validateAndFetchActiveUser(firestore, 'staff_no_name');
    expect(user.displayName).toBe('farooq');
  });
});
