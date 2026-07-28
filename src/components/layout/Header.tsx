import { Menu } from 'lucide-react';
import Breadcrumb from './Breadcrumb';
import ThemeToggle from '../common/ThemeToggle';
import NotificationBell from '../common/NotificationBell';
import UserMenu from '../common/UserMenu';
import { DivisionTabsDesktop, DivisionDropdownMobile } from '../ui/DivisionTabs';
import { useDivisionStore } from '../../stores/divisionStore';
import { useUIStore } from '../../stores/uiStore';

export default function Header() {
  const { activeDivision, setDivision } = useDivisionStore();
  const { setSidebarOpen } = useUIStore();

  return (
    <header className="flex flex-col bg-[var(--color-bg)]/70 backdrop-blur-2xl border-b border-black/[0.04] dark:border-white/[0.04] shrink-0 sticky top-0 z-20 transition-all duration-300">
      
      {/* ─── Top Row: Mobile & Desktop ─── */}
      <div className="h-16 md:h-20 flex items-center justify-between px-4 md:px-8 lg:px-10 gap-3 md:gap-6 w-full">
        
        {/* Left Actions */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {/* Hamburger — mobile only */}
          <button
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Breadcrumb — desktop only */}
          <div className="hidden md:block flex-1 min-w-0">
            <Breadcrumb />
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Desktop Division Tabs (hidden on mobile) */}
          <div className="hidden md:block">
            <DivisionTabsDesktop activeTab={activeDivision} onChange={setDivision} className="shadow-sm mr-1" />
          </div>
          <ThemeToggle />
          <NotificationBell />
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-800 mx-1 hidden sm:block" />
          <UserMenu />
        </div>
      </div>

      {/* ─── Bottom Row: Mobile Only Category Dropdown ─── */}
      <div className="md:hidden px-4 pb-4">
        <DivisionDropdownMobile activeTab={activeDivision} onChange={setDivision} />
      </div>

    </header>
  );
}
