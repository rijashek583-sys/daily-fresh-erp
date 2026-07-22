import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Package, ShoppingCart,
  BarChart3, Settings, X, BookOpen, ChevronRight, Receipt, Trash2
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { Avatar } from '../ui';

interface NavItem { label: string; href: string; icon: React.ElementType; adminOnly?: boolean; }

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Orders', href: '/orders', icon: ShoppingCart, adminOnly: true },
  { label: 'Clients', href: '/clients', icon: Users, adminOnly: true },
  { label: 'Products', href: '/products', icon: Package, adminOnly: true },
  { label: 'Daily Bill', href: '/billing', icon: Receipt },
  { label: 'Client Ledger', href: '/ledger', icon: BookOpen, adminOnly: true },
  { label: 'Reports', href: '/reports', icon: BarChart3, adminOnly: true },
  { label: 'Settings', href: '/settings', icon: Settings, adminOnly: true },
  { label: 'Trash', href: '/trash', icon: Trash2, adminOnly: true },
];

export default function MobileSidebar() {
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const visible = navItems.filter(i => !i.adminOnly || isAdmin);

  if (!sidebarOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      <aside className="fixed left-0 top-0 bottom-0 z-50 w-[280px] bg-[var(--color-bg)] border-r border-gray-200/60 dark:border-white/[0.02] flex flex-col lg:hidden animate-in slide-in-from-left duration-300 shadow-2xl shadow-black/10">
        {/* Header */}
        <div className="flex items-center justify-between h-20 px-6 shrink-0 border-b border-gray-200/50 dark:border-white/[0.02]">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-center overflow-hidden">
              <img src="/logo.png" alt="Daily Fresh" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.src = 'https://ui-avatars.com/api/?name=DF&color=B91C1C&background=FAFAFA'; }} />
            </div>
            <div>
              <p className="text-base font-extrabold text-[var(--color-text-main)] leading-tight">Daily Fresh</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Billing System</p>
            </div>
          </div>
          <button id="mobile-sidebar-close" onClick={() => setSidebarOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-6 px-4">
          <ul className="space-y-1.5">
            {visible.map(item => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <NavLink
                    to={item.href}
                    onClick={() => setSidebarOpen(false)}
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

        {/* User */}
        <div className="shrink-0 p-6 border-t border-gray-200/50 dark:border-white/[0.02] bg-white/50 dark:bg-black/20">
          <div className="flex items-center gap-4">
            <Avatar name={user?.displayName ?? 'U'} size="md" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--color-text-main)] truncate">{user?.displayName}</p>
              <p className="text-[11px] font-semibold text-gray-400 capitalize mt-0.5">{user?.role?.replace('_', ' ')}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
