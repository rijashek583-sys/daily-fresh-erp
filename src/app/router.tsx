import { createBrowserRouter, RouterProvider, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ProtectedRoute } from './ProtectedRoute';
import { RequireAdmin } from './RequireAdmin';
import AppShell from '../components/layout/AppShell';
import LoginPage from '../features/auth/LoginPage';

import { useAuthStore } from '../stores/authStore';

function RootRedirect() {
  const { user, initialized } = useAuthStore();
  if (!initialized) {
    return <div className="h-screen w-full flex items-center justify-center bg-[var(--color-bg)]">Loading...</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/dashboard" replace />;
  return <Navigate to="/dashboard" replace />;
}

// Lazy-loaded pages for code splitting
const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));
const ClientsPage = lazy(() => import('../features/clients/ClientsPage'));
const AddClientPage = lazy(() => import('../features/clients/AddClientPage'));
const EditClientPage = lazy(() => import('../features/clients/EditClientPage'));
const ClientDetailPage = lazy(() => import('../features/clients/ClientDetailPage'));
const ProductsPage = lazy(() => import('../features/products/ProductsPage'));
const ProductFormPage = lazy(() => import('../features/products/ProductFormPage'));
const OrdersPage = lazy(() => import('../features/orders/OrdersPage'));
const CreateOrderPage = lazy(() => import('../features/orders/CreateOrderPage'));
const DailyBillingPage = lazy(() => import('../features/billing/DailyBillingPage'));
const ClientLedgerPage = lazy(() => import('../features/ledger/ClientLedgerPage'));
const ReportsPage = lazy(() => import('../features/reports/ReportsPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));
const TrashPage = lazy(() => import('../features/settings/TrashPage'));

function PageLoader() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-8 w-48 bg-gray-100 dark:bg-gray-800 rounded-xl" />
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-100 dark:bg-gray-800 rounded-2xl" />)}
      </div>
      <div className="h-64 bg-gray-100 dark:bg-gray-800 rounded-2xl" />
    </div>
  );
}

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [{
      element: <AppShell />,
      children: [
        { path: '/', element: <RootRedirect /> },
        { path: '/dashboard', element: <SuspenseWrapper><DashboardPage /></SuspenseWrapper> },
        { path: '/clients', element: <RequireAdmin><SuspenseWrapper><ClientsPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/clients/new', element: <RequireAdmin><SuspenseWrapper><AddClientPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/clients/:clientId/edit', element: <RequireAdmin><SuspenseWrapper><EditClientPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/clients/:clientId', element: <RequireAdmin><SuspenseWrapper><ClientDetailPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/products', element: <RequireAdmin><SuspenseWrapper><ProductsPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/products/new', element: <RequireAdmin><SuspenseWrapper><ProductFormPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/products/:productId/edit', element: <RequireAdmin><SuspenseWrapper><ProductFormPage /></SuspenseWrapper></RequireAdmin> },
        // /pricing redirects to /clients for backward compatibility
        { path: '/pricing', element: <Navigate to="/clients" replace /> },
        { path: '/orders', element: <RequireAdmin><SuspenseWrapper><OrdersPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/orders/new', element: <RequireAdmin><SuspenseWrapper><CreateOrderPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/orders/:orderId/edit', element: <RequireAdmin><SuspenseWrapper><CreateOrderPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/billing', element: <SuspenseWrapper><DailyBillingPage /></SuspenseWrapper> },
        { path: '/ledger', element: <SuspenseWrapper><ClientLedgerPage /></SuspenseWrapper> },
        { path: '/reports', element: <RequireAdmin><SuspenseWrapper><ReportsPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/settings', element: <RequireAdmin><SuspenseWrapper><SettingsPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/trash', element: <RequireAdmin><SuspenseWrapper><TrashPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/production', element: <Navigate to="/dashboard" replace /> },
      ],
    }],
  },
  { path: '*', element: <RootRedirect /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
