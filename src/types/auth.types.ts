export type UserRole = 'admin' | 'staff' | 'delivery_staff';

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  name?: string;
  photoURL: string | null;
  role: UserRole;
  status?: 'active' | 'inactive';
}

export interface UserDocument {
  uid: string;
  email: string;
  displayName: string;
  name?: string;
  photoURL?: string;
  role: UserRole;
  status?: 'active' | 'inactive';
  createdAt: string;
  updatedAt?: string;
}

