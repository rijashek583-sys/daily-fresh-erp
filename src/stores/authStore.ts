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
          const userData = userDoc.data() as Omit<User, 'uid'>;
          set({
            user: {
              uid: fbUser.uid,
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
        await signInWithEmailAndPassword(auth, email, password);
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
