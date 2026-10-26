/**
 * Daily Fresh ERP — Backend Authentication & Role Authorization
 *
 * Enforces active-user and role boundaries using the actual /users/{uid} schema.
 * Replicates the authoritative security policy of firestore.rules on the backend.
 */

import type * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';

export type UserRole = 'admin' | 'staff' | 'delivery_staff';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  displayName: string;
  role: UserRole;
  status: 'active' | 'inactive';
}

/**
 * Validates the caller's auth context, verifies existence in /users/{uid},
 * checks active account status, and returns the validated user identity.
 */
export async function validateAndFetchActiveUser(
  firestore: admin.firestore.Firestore,
  authUid?: string
): Promise<AuthenticatedUser> {
  if (!authUid) {
    throw new HttpsError('unauthenticated', 'Authentication required. Missing user identity.');
  }

  const userDocRef = firestore.collection('users').doc(authUid);
  const userSnap = await userDocRef.get();

  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found in system.');
  }

  const data = userSnap.data();
  // Safe default: 'active' for legacy accounts without explicit status, matching firestore.rules
  const status = (data?.status || 'active') as 'active' | 'inactive';
  if (status !== 'active') {
    throw new HttpsError('permission-denied', 'Account is deactivated. Access denied.');
  }

  const role = data?.role as UserRole;
  if (!role || (role !== 'admin' && role !== 'staff' && role !== 'delivery_staff')) {
    throw new HttpsError('permission-denied', `Invalid or unauthorized user role: ${role}`);
  }

  const displayName = data?.displayName || data?.name || data?.email?.split('@')[0] || 'User';

  return {
    uid: authUid,
    email: data?.email,
    displayName,
    role,
    status,
  };
}
