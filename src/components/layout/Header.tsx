
import Breadcrumb from './Breadcrumb';
import ThemeToggle from '../common/ThemeToggle';
import NotificationBell from '../common/NotificationBell';
import UserMenu from '../common/UserMenu';

export default function Header() {
  return (
    <header className="h-20 bg-[var(--color-bg)]/70 backdrop-blur-2xl border-b border-black/[0.04] dark:border-white/[0.04] flex items-center px-8 lg:px-10 gap-6 shrink-0 sticky top-0 z-20 transition-all duration-300">

      {/* Breadcrumb */}
      <div className="flex-1 min-w-0">
        <Breadcrumb />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        <ThemeToggle />
        <NotificationBell />
        <div className="w-px h-6 bg-gray-200 dark:bg-gray-800 mx-2 hidden sm:block" />
        <UserMenu />
      </div>
    </header>
  );
}
