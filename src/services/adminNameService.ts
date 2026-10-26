/**
 * Daily Fresh ERP — Admin Name Registry Service
 *
 * Provides isolated read subscriptions and trusted Cloud Functions actions for the /adminNames collection.
 * Governs the display names used to attribute expenses recorded via the shared Admin account.
 *
 * GUARANTEES:
 * 1. Strict No-Deletion: Admin names are never deleted from Firestore. Inactive names
 *    are deactivated (status: 'inactive') to preserve historical reporting integrity.
 * 2. Uniqueness: Case-insensitive uniqueness check prevents duplicate operator names.
 * 3. Trusted Server Execution: Modifications execute via manageAdminName Cloud Function.
 * 4. Attribution Only: Admin names are purely operational attribution labels; they do
 *    NOT provide authentication or authorization.
 */

import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  type FirestoreError,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../lib/firebase';
import { type AdminNameDocument } from '../types/expense.types';

export const ADMIN_NAMES_COLLECTION = 'adminNames';
export const FUNCTIONS_REGION = 'asia-south1';

const functions = getFunctions(app, FUNCTIONS_REGION);

/**
 * Validates an admin display name.
 */
export function validateAdminName(name: string): { valid: boolean; normalized: string; error?: string } {
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

/**
 * Subscribes to the complete list of admin names in real time.
 * Accessible strictly to active Admins.
 */
export function subscribeToAdminNames(
  callback: (names: AdminNameDocument[]) => void,
  onError?: (error: FirestoreError) => void
): () => void {
  const colRef = collection(db, ADMIN_NAMES_COLLECTION);
  const q = query(colRef, orderBy('name', 'asc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const records: AdminNameDocument[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AdminNameDocument, 'id'>),
      }));
      callback(records);
    },
    (err) => {
      console.error('[AdminNameService] Snapshot subscription error:', err);
      onError?.(err);
    }
  );
}

/**
 * Fetches all currently active admin names for selection in expense entry dropdowns.
 */
export async function getActiveAdminNames(): Promise<AdminNameDocument[]> {
  const colRef = collection(db, ADMIN_NAMES_COLLECTION);
  const q = query(colRef, where('status', '==', 'active'));
  const snapshot = await getDocs(q);

  return snapshot.docs
    .map((d) => ({
      id: d.id,
      ...(d.data() as Omit<AdminNameDocument, 'id'>),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Registers a new Admin display name via trusted manageAdminName Cloud Function.
 */
export async function createAdminName(name: string, _adminUid?: string): Promise<string> {
  const val = validateAdminName(name);
  if (!val.valid) {
    throw new Error(val.error);
  }

  try {
    const manageAdminNameFn = httpsCallable<
      { action: 'register'; name: string },
      { success: boolean; adminNameId: string }
    >(functions, 'manageAdminName');

    const res = await manageAdminNameFn({
      action: 'register',
      name: val.normalized,
    });

    return res.data.adminNameId;
  } catch (err: any) {
    throw new Error(err?.message || 'Failed to register Admin name.');
  }
}

/**
 * Toggles an Admin display name between 'active' and 'inactive' via trusted manageAdminName Cloud Function.
 * Soft deactivation preserves historical expense records while hiding it from future entry.
 */
export async function toggleAdminNameStatus(
  adminNameId: string,
  newStatus: 'active' | 'inactive'
): Promise<void> {
  if (!adminNameId) throw new Error('Admin Name ID is required.');

  try {
    const manageAdminNameFn = httpsCallable<
      { action: 'toggle_status'; adminNameId: string; newStatus: 'active' | 'inactive' },
      { success: boolean }
    >(functions, 'manageAdminName');

    await manageAdminNameFn({
      action: 'toggle_status',
      adminNameId,
      newStatus,
    });
  } catch (err: any) {
    throw new Error(err?.message || 'Failed to update Admin name status.');
  }
}

/**
 * Updates the display spelling of an existing Admin Name via trusted manageAdminName Cloud Function.
 */
export async function updateAdminName(adminNameId: string, newName: string): Promise<void> {
  const val = validateAdminName(newName);
  if (!val.valid) {
    throw new Error(val.error);
  }

  try {
    const manageAdminNameFn = httpsCallable<
      { action: 'rename'; adminNameId: string; name: string },
      { success: boolean }
    >(functions, 'manageAdminName');

    await manageAdminNameFn({
      action: 'rename',
      adminNameId,
      name: val.normalized,
    });
  } catch (err: any) {
    throw new Error(err?.message || 'Failed to rename Admin name.');
  }
}
