import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc, updateDoc, collection, onSnapshot, query, type FirestoreError } from 'firebase/firestore';
import { db, auth, firebaseConfig } from '../lib/firebase';
import { type User } from '../types';
import { useAuthStore } from '../stores/authStore';

function enforceAdmin() {
  const user = useAuthStore.getState().user;
  if (!user || user.role !== 'admin') {
    throw new Error('Unauthorized: Admin access required');
  }
}

/**
 * Subscribes to all staff members from the /users collection.
 * Admin-only operation.
 */
export function subscribeToStaffMembers(
  callback: (staff: User[]) => void,
  onError?: (error: FirestoreError) => void
) {
  const q = query(collection(db, 'users'));
  return onSnapshot(
    q,
    (snapshot) => {
      const users: User[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        if (data.role === 'staff' || data.role === 'delivery_staff') {
          users.push({
            uid: d.id,
            name: data.name || data.displayName || data.email?.split('@')[0] || 'Staff Member',
            displayName: data.displayName || data.name,
            email: data.email || '',
            role: data.role || 'staff',
            status: data.status || 'active',
            createdAt: data.createdAt || new Date().toISOString(),
          });
        }
      });
      // Sort alphabetically by name
      users.sort((a, b) => a.name.localeCompare(b.name));
      callback(users);
    },
    (error) => {
      console.error('Error subscribing to staff members:', error);
      onError?.(error);
    }
  );
}

export interface CreateStaffInput {
  name: string;
  email: string;
  password: string;
  role?: 'staff' | 'delivery_staff';
}

/**
 * Creates an individual staff login.
 * Uses a secondary Firebase App instance so the current Admin session is not disconnected.
 */
export async function createStaffAccount(input: CreateStaffInput): Promise<string> {
  enforceAdmin();

  const { name, email, password, role = 'staff' } = input;
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();

  if (!cleanName) throw new Error('Staff name is required');
  if (!cleanEmail) throw new Error('Email address is required');
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  // Create an isolated secondary app to avoid logging out the current admin
  const tempAppName = `StaffProvision_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const secondaryApp = initializeApp(firebaseConfig, tempAppName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, password);
    const uid = cred.user.uid;

    // Immediately sign out and discard secondary auth instance
    await signOut(secondaryAuth);
    await deleteApp(secondaryApp);

    // Write user profile to Firestore with primary db as Admin
    await setDoc(doc(db, 'users', uid), {
      uid,
      name: cleanName,
      displayName: cleanName,
      email: cleanEmail,
      role,
      status: 'active',
      createdAt: new Date().toISOString(),
    });

    return uid;
  } catch (err: any) {
    try {
      await deleteApp(secondaryApp);
    } catch (_) {}

    if (err.code === 'auth/email-already-in-use') {
      throw new Error(`An account with email "${cleanEmail}" already exists.`);
    }
    if (err.code === 'auth/invalid-email') {
      throw new Error('Invalid email format. Please check the email address.');
    }
    if (err.code === 'auth/weak-password') {
      throw new Error('Password is too weak. Please use at least 6 characters.');
    }
    throw new Error(err.message || 'Failed to create staff account');
  }
}

/**
 * Toggles or updates a staff member's status (active/inactive).
 */
export async function updateStaffStatus(uid: string, status: 'active' | 'inactive') {
  enforceAdmin();
  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      status,
      updatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error updating staff status:', error);
    throw new Error(error.message || 'Failed to update staff status');
  }
}

export interface ResetStaffPasswordInput {
  uid: string;
  email: string;
  newPassword?: string;
}

/**
 * Initiates a secure password reset for a staff account.
 * Admin-only operation.
 * Adheres strictly to security requirements:
 * 1. Never modifies the currently logged-in Admin's credentials or session.
 * 2. Uses Firebase Authentication's secure supported password reset flow.
 * 3. Never writes plain-text passwords to Firestore.
 * 4. Preserves staff email, uid, role, payment records, and permissions.
 */
export async function resetStaffPassword(input: ResetStaffPasswordInput): Promise<void> {
  enforceAdmin();

  const currentAdmin = useAuthStore.getState().user;
  if (currentAdmin && currentAdmin.uid === input.uid) {
    throw new Error("Cannot reset current admin's password through staff management. Please use personal account settings.");
  }

  const cleanEmail = input.email.trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error('Staff email address is required to reset password.');
  }

  if (input.newPassword !== undefined) {
    if (input.newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
  }

  try {
    // Send password reset email via Firebase Auth
    await sendPasswordResetEmail(auth, cleanEmail);

    // Update metadata audit timestamp in Firestore (never storing passwords)
    if (input.uid) {
      const userRef = doc(db, 'users', input.uid);
      await updateDoc(userRef, {
        updatedAt: new Date().toISOString(),
        lastPasswordResetAt: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    if (err.code === 'auth/user-not-found') {
      throw new Error(`No authentication account found for "${cleanEmail}".`);
    }
    if (err.code === 'auth/invalid-email') {
      throw new Error('Invalid email format. Please check the email address.');
    }
    if (err.code === 'auth/too-many-requests') {
      throw new Error('Too many password reset requests. Please wait a few minutes before trying again.');
    }
    throw new Error(err.message || 'Failed to initiate password reset.');
  }
}

