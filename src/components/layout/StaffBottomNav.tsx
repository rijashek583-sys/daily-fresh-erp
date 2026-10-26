import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, CreditCard, ShoppingCart, Menu } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';

interface NavItem {
  label: string;
  shortLabel: string;
  href: string;
  icon: React.ElementType;
}

const staffBottomNavItems: NavItem[] = [
  { label: 'Dashboard', shortLabel: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Clients', shortLabel: 'Clients', href: '/clients', icon: Users },
  { label: 'Payments', shortLabel: 'Payments', href: '/payments', icon: CreditCard },
];

const adminBottomNavItems: NavItem[] = [
  { label: 'Dashboard', shortLabel: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Orders', shortLabel: 'Orders', href: '/orders', icon: ShoppingCart },
  { label: 'Clients', shortLabel: 'Clients', href: '/clients', icon: Users },
  { label: 'Payments', shortLabel: 'Payments', href: '/payments', icon: CreditCard },
];

export default function StaffBottomNav() {
  const { user } = useAuthStore();
  const { setSidebarOpen } = useUIStore();
  const isAdmin = user?.role === 'admin';
  const navItems = isAdmin ? adminBottomNavItems : staffBottomNavItems;
  const gridColsClass = isAdmin ? 'grid-cols-5' : 'grid-cols-3';

  return (
    <nav
      aria-label="Mobile navigation bar"
      className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-white/95 dark:bg-gray-950/95 backdrop-blur-xl border-t border-gray-200/80 dark:border-white/[0.08] shadow-[0_-4px_20px_rgba(0,0,0,0.06)] transition-colors duration-200"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.5rem)' }}
    >
      <div className={cn('grid h-14 sm:h-16 max-w-lg mx-auto px-1 sm:px-2', gridColsClass)}>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-0.5 sm:gap-1 transition-all duration-200 py-1 rounded-xl text-center select-none min-w-0',
                  isActive
                    ? 'text-[var(--color-primary)] font-bold'
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 font-medium'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <div
                    className={cn(
                      'relative flex items-center justify-center w-8 sm:w-10 h-6 sm:h-7 rounded-full transition-all duration-200',
                      isActive ? 'bg-red-50 dark:bg-red-950/50' : 'bg-transparent'
                    )}
                  >
                    <Icon className={cn('w-4 sm:w-5 h-4 sm:h-5 transition-transform duration-200', isActive ? 'scale-110' : '')} />
                    {isActive && (
                      <span className="absolute -top-1 w-1.5 h-1.5 rounded-full bg-[var(--color-primary)]" />
                    )}
                  </div>
                  <span className="text-[10px] sm:text-[11px] tracking-tight leading-none truncate max-w-full px-0.5">
                    <span className="hidden min-[380px]:inline">{item.label}</span>
                    <span className="min-[380px]:hidden">{item.shortLabel}</span>
                  </span>
                </>
              )}
            </NavLink>
          );
        })}

        {/* For Admin: 5th item opens the full navigation drawer */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 sm:gap-1 transition-all duration-200 py-1 rounded-xl text-center select-none min-w-0 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 font-medium"
            aria-label="Open full menu"
          >
            <div className="relative flex items-center justify-center w-8 sm:w-10 h-6 sm:h-7 rounded-full transition-all duration-200">
              <Menu className="w-4 sm:w-5 h-4 sm:h-5" />
            </div>
            <span className="text-[10px] sm:text-[11px] tracking-tight leading-none truncate max-w-full px-0.5">
              Menu
            </span>
          </button>
        )}
      </div>
    </nav>
  );
}
