import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

export function ProtectedRoute() {
  const { user, initialized } = useAuthStore();
  const location = useLocation();

  if (!initialized) {
    return <div className="h-screen w-full flex items-center justify-center bg-[var(--color-bg)]">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
