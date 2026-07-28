import { Menu } from 'lucide-react';
import Breadcrumb from './Breadcrumb';
import ThemeToggle from '../common/ThemeToggle';
import NotificationBell from '../common/NotificationBell';
import UserMenu from '../common/UserMenu';
import { DivisionTabs } from '../ui/DivisionTabs';
import { useDivisionStore } from '../../stores/divisionStore';
import { useUIStore } from '../../stores/uiStore';

export default function Header() {
  const { activeDivision, setDivision } = useDivisionStore();
  const { setSidebarOpen } = useUIStore();

  return (
    <header className="h-16 md:h-20 bg-[var(--color-bg)]/70 backdrop-blur-2xl border-b border-black/[0.04] dark:border-white/[0.04] flex items-center px-4 md:px-8 lg:px-10 gap-3 md:gap-6 shrink-0 sticky top-0 z-20 transition-all duration-300">

      {/* Hamburger — mobile only */}
      <button
        className="md:hidden w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Breadcrumb */}
      <div className="flex-1 min-w-0">
        <Breadcrumb />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        <DivisionTabs activeTab={activeDivision} onChange={setDivision} className="shadow-sm mr-1" />
        <ThemeToggle />
        <NotificationBell />
        <div className="w-px h-6 bg-gray-200 dark:bg-gray-800 mx-1 hidden sm:block" />
        <UserMenu />
      </div>
    </header>
  );
}
