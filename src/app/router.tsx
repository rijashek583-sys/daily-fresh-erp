import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { Suspense } from 'react';
import { ProtectedRoute } from './ProtectedRoute';
import { RequireAdmin } from './RequireAdmin';
import AppShell from '../components/layout/AppShell';
import LoginPage from '../features/auth/LoginPage';
import { useAuthStore } from '../stores/authStore';
import { safeLazy } from '../lib/lazyRetry';
import { RouteErrorBoundary } from '../components/common/RouteErrorBoundary';

function RootRedirect() {
  const { user, initialized } = useAuthStore();
  if (!initialized) {
    return <div className="h-screen w-full flex items-center justify-center bg-[var(--color-bg)]">Loading...</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/dashboard" replace />;
  return <Navigate to="/payments" replace />;
}

// Lazy-loaded pages with controlled chunk error retry and recovery
const DashboardPage = safeLazy(() => import('../features/dashboard/DashboardPage'), 'DashboardPage');
const ClientsPage = safeLazy(() => import('../features/clients/ClientsPage'), 'ClientsPage');
const AddClientPage = safeLazy(() => import('../features/clients/AddClientPage'), 'AddClientPage');
const EditClientPage = safeLazy(() => import('../features/clients/EditClientPage'), 'EditClientPage');
const ClientDetailPage = safeLazy(() => import('../features/clients/ClientDetailPage'), 'ClientDetailPage');
const ProductsPage = safeLazy(() => import('../features/products/ProductsPage'), 'ProductsPage');
const ProductFormPage = safeLazy(() => import('../features/products/ProductFormPage'), 'ProductFormPage');
const OrdersPage = safeLazy(() => import('../features/orders/OrdersPage'), 'OrdersPage');
const CreateOrderPage = safeLazy(() => import('../features/orders/CreateOrderPage'), 'CreateOrderPage');
const BulkOrderPage   = safeLazy(() => import('../features/orders/BulkOrderPage'), 'BulkOrderPage');
const DailyBillingPage = safeLazy(() => import('../features/billing/DailyBillingPage'), 'DailyBillingPage');
const ClientLedgerPage = safeLazy(() => import('../features/ledger/ClientLedgerPage'), 'ClientLedgerPage');
const ReportsPage = safeLazy(() => import('../features/reports/ReportsPage'), 'ReportsPage');
const SettingsPage = safeLazy(() => import('../features/settings/SettingsPage'), 'SettingsPage');
const TrashPage = safeLazy(() => import('../features/settings/TrashPage'), 'TrashPage');
const PaymentsCollectionPage = safeLazy(() => import('../features/payments/PaymentsCollectionPage'), 'PaymentsCollectionPage');
const StaffPage = safeLazy(() => import('../features/staff/StaffPage'), 'StaffPage');

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
  {
    path: '/login',
    element: <LoginPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    element: <ProtectedRoute />,
    errorElement: <RouteErrorBoundary />,
    children: [{
      element: <AppShell />,
      errorElement: <RouteErrorBoundary />,
      children: [
        { path: '/', element: <RootRedirect /> },
        { path: '/dashboard', element: <SuspenseWrapper><DashboardPage /></SuspenseWrapper> },
        { path: '/clients', element: <SuspenseWrapper><ClientsPage /></SuspenseWrapper> },
        { path: '/clients/new', element: <RequireAdmin><SuspenseWrapper><AddClientPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/clients/:clientId/edit', element: <RequireAdmin><SuspenseWrapper><EditClientPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/clients/:clientId', element: <SuspenseWrapper><ClientDetailPage /></SuspenseWrapper> },
        { path: '/products', element: <RequireAdmin><SuspenseWrapper><ProductsPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/products/new', element: <RequireAdmin><SuspenseWrapper><ProductFormPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/products/:productId/edit', element: <RequireAdmin><SuspenseWrapper><ProductFormPage /></SuspenseWrapper></RequireAdmin> },
        // /pricing redirects to /clients for backward compatibility
        { path: '/pricing', element: <Navigate to="/clients" replace /> },
        { path: '/orders', element: <SuspenseWrapper><OrdersPage /></SuspenseWrapper> },
        { path: '/orders/new', element: <RequireAdmin><SuspenseWrapper><CreateOrderPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/orders/bulk', element: <RequireAdmin><SuspenseWrapper><BulkOrderPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/orders/:orderId/edit', element: <RequireAdmin><SuspenseWrapper><CreateOrderPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/payments', element: <SuspenseWrapper><PaymentsCollectionPage /></SuspenseWrapper> },
        { path: '/staff', element: <RequireAdmin><SuspenseWrapper><StaffPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/billing', element: <SuspenseWrapper><DailyBillingPage /></SuspenseWrapper> },
        { path: '/ledger', element: <SuspenseWrapper><ClientLedgerPage /></SuspenseWrapper> },
        { path: '/reports', element: <RequireAdmin><SuspenseWrapper><ReportsPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/settings', element: <RequireAdmin><SuspenseWrapper><SettingsPage /></SuspenseWrapper></RequireAdmin> },
        { path: '/trash', element: <RequireAdmin><SuspenseWrapper><TrashPage /></SuspenseWrapper></RequireAdmin> },
      ],
    }],
  },
  {
    path: '*',
    element: <RootRedirect />,
    errorElement: <RouteErrorBoundary />,
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
