import { create } from 'zustand';
import { auth, db } from '../lib/firebase';
import { signInWithEmailAndPassword, signOut as firebaseSignOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { type User } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  initialized: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  // Listen for Firebase Auth state changes globally
  onAuthStateChanged(auth, async (fbUser) => {
    if (fbUser) {
      try {
        const userDoc = await getDoc(doc(db, 'users', fbUser.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data() as any;
          if (userData.status === 'inactive') {
            await firebaseSignOut(auth);
            set({ user: null, loading: false, initialized: true });
            return;
          }
          const name = userData.name || userData.displayName || fbUser.displayName || fbUser.email?.split('@')[0] || 'User';
          set({
            user: {
              uid: fbUser.uid,
              name,
              displayName: userData.displayName || name,
              email: userData.email || fbUser.email || '',
              role: userData.role || 'staff',
              status: userData.status || 'active',
              createdAt: userData.createdAt || new Date().toISOString(),
              ...userData
            },
            loading: false,
            initialized: true
          });
        } else {
          // If no doc exists, sign out as it's invalid
          await firebaseSignOut(auth);
          set({ user: null, loading: false, initialized: true });
        }
      } catch (err) {
        console.error("Error fetching user profile:", err);
        set({ user: null, loading: false, initialized: true });
      }
    } else {
      set({ user: null, loading: false, initialized: true });
    }
  });

  return {
    user: null,
    loading: false,
    initialized: false,

    login: async (email, password) => {
      set({ loading: true, initialized: false }); // Force loading state for guards
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        const userDoc = await getDoc(doc(db, 'users', cred.user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          if (userData.status === 'inactive') {
            await firebaseSignOut(auth);
            set({ user: null, loading: false, initialized: true });
            throw new Error('This account has been deactivated. Please contact your administrator.');
          }
        }
        // The onAuthStateChanged listener handles the rest
      } catch (error: any) {
        set({ loading: false, initialized: true });
        throw new Error(error.message || 'Invalid email or password');
      }
    },

    logout: async () => {
      set({ loading: true });
      await firebaseSignOut(auth);
    },
  };
});
