/**
 * Daily Fresh ERP — Admin Name Registry Backend Management
 *
 * Enforces admin-only management of operator display names used for shared-login attribution.
 * Guarantees zero deletion: names are only activated/deactivated, preserving historical records.
 */

import type * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { type AuthenticatedUser } from './authValidation';

export const ADMIN_NAMES_COLLECTION = 'adminNames';

export interface ManageAdminNamePayload {
  action: 'register' | 'toggle_status' | 'rename';
  name?: string;
  adminNameId?: string;
  newStatus?: 'active' | 'inactive';
}

export function validateAdminNameString(name: string): { valid: boolean; normalized: string; error?: string } {
  if (!name || typeof name !== 'string') {
    return { valid: false, normalized: '', error: 'Admin name is required.' };
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, normalized: '', error: 'Admin name is required.' };
  }
  if (trimmed.length < 2) {
    return { valid: false, normalized: trimmed, error: 'Admin name must be at least 2 characters.' };
  }
  if (trimmed.length > 50) {
    return { valid: false, normalized: trimmed, error: 'Admin name cannot exceed 50 characters.' };
  }
  return { valid: true, normalized: trimmed };
}

export async function handleManageAdminName(
  firestore: admin.firestore.Firestore,
  caller: AuthenticatedUser,
  payload: ManageAdminNamePayload
): Promise<{ success: boolean; adminNameId?: string; message?: string }> {
  // 1. Admin-only role check
  if (caller.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Unauthorized: Only Admins can manage the operator registry.');
  }

  const colRef = firestore.collection(ADMIN_NAMES_COLLECTION);

  // 2. Action: Register new name
  if (payload.action === 'register') {
    const val = validateAdminNameString(payload.name || '');
    if (!val.valid) {
      throw new HttpsError('invalid-argument', val.error || 'Invalid name');
    }

    const nameLower = val.normalized.toLowerCase();
    const dupSnapshot = await colRef.where('nameLower', '==', nameLower).get();

    if (!dupSnapshot.empty) {
      const existing = dupSnapshot.docs[0].data();
      if (existing.status === 'inactive') {
        throw new HttpsError(
          'already-exists',
          `The name "${val.normalized}" is currently deactivated. Please reactivate it from the list.`
        );
      }
      throw new HttpsError('already-exists', `An Admin name with "${val.normalized}" already exists.`);
    }

    const docId = `admin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const docRef = colRef.doc(docId);

    await docRef.set({
      id: docId,
      name: val.normalized,
      nameLower,
      status: 'active',
      createdAt: new Date().toISOString(),
      createdByUid: caller.uid,
    });

    return { success: true, adminNameId: docId };
  }

  // 3. Action: Toggle status (Soft deactivation / reactivation)
  if (payload.action === 'toggle_status') {
    if (!payload.adminNameId) {
      throw new HttpsError('invalid-argument', 'adminNameId is required for status toggle.');
    }
    if (payload.newStatus !== 'active' && payload.newStatus !== 'inactive') {
      throw new HttpsError('invalid-argument', 'newStatus must be "active" or "inactive".');
    }

    const docRef = colRef.doc(payload.adminNameId);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Admin name record not found.');
    }

    await docRef.update({
      status: payload.newStatus,
      updatedAt: new Date().toISOString(),
    });

    return { success: true, adminNameId: payload.adminNameId };
  }

  // 4. Action: Rename spelling
  if (payload.action === 'rename') {
    if (!payload.adminNameId) {
      throw new HttpsError('invalid-argument', 'adminNameId is required for renaming.');
    }
    const val = validateAdminNameString(payload.name || '');
    if (!val.valid) {
      throw new HttpsError('invalid-argument', val.error || 'Invalid name');
    }

    const docRef = colRef.doc(payload.adminNameId);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Admin name record not found.');
    }

    const nameLower = val.normalized.toLowerCase();
    const dupSnapshot = await colRef.where('nameLower', '==', nameLower).get();
    const conflict = dupSnapshot.docs.find((d) => d.id !== payload.adminNameId);
    if (conflict) {
      throw new HttpsError('already-exists', `Another Admin Name is already registered with "${val.normalized}".`);
    }

    await docRef.update({
      name: val.normalized,
      nameLower,
      updatedAt: new Date().toISOString(),
    });

    return { success: true, adminNameId: payload.adminNameId };
  }

  // 5. Zero-deletion guarantee: Deletion is rejected
  throw new HttpsError('invalid-argument', `Unsupported action: ${(payload as any).action}. Deletions are forbidden.`);
}
