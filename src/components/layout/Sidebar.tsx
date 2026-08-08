import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Package, ShoppingCart,
  BarChart3, Settings, X, BookOpen, ChevronRight, Receipt, Trash2, LogOut, Factory
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuthStore } from '../../stores/authStore';

interface NavItem { label: string; href: string; icon: React.ElementType; adminOnly?: boolean; }

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Orders', href: '/orders', icon: ShoppingCart, adminOnly: true },
  { label: 'Clients', href: '/clients', icon: Users, adminOnly: true },
  { label: 'Products', href: '/products', icon: Package, adminOnly: true },
  { label: 'Stock & Prod.', href: '/stock', icon: Factory, adminOnly: true },
  { label: 'Daily Bill', href: '/billing', icon: Receipt },
  { label: 'Client Ledger', href: '/ledger', icon: BookOpen, adminOnly: true },
  { label: 'Reports', href: '/reports', icon: BarChart3, adminOnly: true },
  { label: 'Settings', href: '/settings', icon: Settings, adminOnly: true },
  { label: 'Trash', href: '/trash', icon: Trash2, adminOnly: true },
];

export default function Sidebar() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const visible = navItems.filter(i => !i.adminOnly || isAdmin);

  return (
    <aside className="fixed left-0 top-0 w-[280px] h-screen bg-[var(--color-bg)] border-r border-black/[0.04] dark:border-white/[0.04] hidden md:flex flex-col z-30 transition-colors duration-300">
      {/* Header / Logo */}
      <div className="flex items-center gap-4 h-20 px-8 shrink-0 border-b border-black/[0.04] dark:border-white/[0.04]">
        <div className="w-10 h-10 rounded-full bg-white dark:bg-gray-800 shadow-[var(--shadow-soft)] border border-black/[0.04] dark:border-white/[0.04] flex items-center justify-center overflow-hidden">
          <img src="/logo.png" alt="Daily Fresh" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.src = 'https://ui-avatars.com/api/?name=DF&color=B91C1C&background=FAFAFA'; }} />
        </div>
        <div>
          <h1 className="text-base font-extrabold text-[var(--color-text-main)] tracking-tight leading-tight">Daily Fresh</h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Billing System</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-6 px-4 custom-scrollbar">
        <ul className="space-y-1.5">
          {visible.map(item => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <NavLink
                  to={item.href}
                  className={({ isActive }) => cn(
                    'group flex items-center justify-between px-4 py-3.5 rounded-2xl text-sm font-semibold transition-all duration-200',
                    isActive
                      ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-[var(--shadow-soft)]'
                      : 'text-gray-500 hover:bg-gray-200/50 dark:hover:bg-gray-800/50 hover:text-gray-900 dark:hover:text-white',
                  )}
                >
                  {({ isActive }) => (
                    <>
                      <div className="flex items-center gap-3.5">
                        <Icon className={cn('w-5 h-5 transition-transform duration-200 group-hover:scale-110', isActive ? 'text-[var(--color-primary)]' : 'text-gray-400 group-hover:text-gray-600')} />
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

      <div className="p-4 border-t border-black/[0.04] dark:border-white/[0.04]">
        <button
          onClick={() => useAuthStore.getState().logout()}
          className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
