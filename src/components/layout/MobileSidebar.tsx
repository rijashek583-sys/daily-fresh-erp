import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Package, ShoppingCart,
  BarChart3, Settings, X, BookOpen, ChevronRight, Receipt, Trash2, LogOut, CreditCard
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { Avatar } from '../ui';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

const adminNavItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Orders', href: '/orders', icon: ShoppingCart },
  { label: 'Clients', href: '/clients', icon: Users },
  { label: 'Payments', href: '/payments', icon: CreditCard },
  { label: 'Products', href: '/products', icon: Package },
  { label: 'Daily Bill', href: '/billing', icon: Receipt },
  { label: 'Client Ledger', href: '/ledger', icon: BookOpen },
  { label: 'Reports', href: '/reports', icon: BarChart3 },
  { label: 'Settings', href: '/settings', icon: Settings },
  { label: 'Trash', href: '/trash', icon: Trash2 },
];

const staffNavItems: NavItem[] = [
  { label: 'Clients', href: '/clients', icon: Users },
  { label: 'Orders', href: '/orders', icon: ShoppingCart },
  { label: 'Payments / Collection', href: '/payments', icon: CreditCard },
];

export default function MobileSidebar() {
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const visible = isAdmin ? adminNavItems : staffNavItems;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 md:hidden',
          sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={cn(
          'fixed left-0 top-0 bottom-0 z-50 w-[280px] max-w-[80vw] bg-[var(--color-bg)] border-r border-gray-200/60 dark:border-white/[0.04] flex flex-col md:hidden shadow-2xl shadow-black/20',
          'transition-transform duration-300 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="Mobile navigation"
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-5 shrink-0 border-b border-gray-200/50 dark:border-white/[0.04]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-center overflow-hidden">
              <img
                src="/logo.png"
                alt="Daily Fresh"
                className="w-full h-full object-cover"
                onError={(e) => { e.currentTarget.src = 'https://ui-avatars.com/api/?name=DF&color=B91C1C&background=FAFAFA'; }}
              />
            </div>
            <div>
              <p className="text-sm font-extrabold text-[var(--color-text-main)] leading-tight">Daily Fresh</p>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
                {isAdmin ? 'Billing System' : 'Staff Portal'}
              </p>
            </div>
          </div>
          <button
            id="mobile-sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <ul className="space-y-1">
            {visible.map(item => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <NavLink
                    to={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) => cn(
                      'group flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-200',
                      isActive
                        ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-[var(--shadow-soft)]'
                        : 'text-gray-500 hover:bg-gray-100/80 dark:hover:bg-gray-800/50 hover:text-gray-900 dark:hover:text-white',
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <div className="flex items-center gap-3.5">
                          <Icon className={cn('w-5 h-5 transition-colors', isActive ? 'text-[var(--color-primary)]' : 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300')} />
                          {item.label}
                        </div>
                        {isActive && <ChevronRight className="w-4 h-4 opacity-50" />}
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User footer */}
        <div className="shrink-0 p-4 border-t border-gray-200/50 dark:border-white/[0.04]">
          <div className="flex items-center gap-3 mb-3">
            <Avatar name={user?.displayName ?? 'U'} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[var(--color-text-main)] truncate">{user?.displayName || user?.name}</p>
              <p className="text-[11px] font-semibold text-gray-400 capitalize mt-0.5">{user?.role?.replace('_', ' ')}</p>
            </div>
          </div>
          <button
            onClick={() => useAuthStore.getState().logout()}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}
