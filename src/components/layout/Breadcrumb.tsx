import { useLocation, Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

const routeLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  clients: 'Clients',
  new: 'Add Client',
  products: 'Products',
  pricing: 'Client Pricing',
  orders: 'Orders',
  billing: 'Daily Billing',
  payments: 'Payments',
  ledger: 'Client Ledger',
  reports: 'Reports',
  settings: 'Settings',
  production: 'Production',
};

export default function Breadcrumb() {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs = segments.map((seg, idx) => ({
    label: routeLabels[seg] ?? (seg.charAt(0).toUpperCase() + seg.slice(1)),
    href: '/' + segments.slice(0, idx + 1).join('/'),
    current: idx === segments.length - 1,
  }));

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2">
      <Link to="/dashboard" className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-900 bg-white dark:bg-gray-900 shadow-sm border border-gray-100 dark:border-gray-800 transition-all hover:scale-105" aria-label="Home">
        <Home className="w-3.5 h-3.5" />
      </Link>
      {crumbs.map(c => (
        <span key={c.href} className="flex items-center gap-2">
          <ChevronRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-700 shrink-0" />
          {c.current ? (
            <span className="text-sm font-bold text-[var(--color-text-main)]" aria-current="page">{c.label}</span>
          ) : (
            <Link to={c.href} className="text-sm font-medium text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">{c.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}
