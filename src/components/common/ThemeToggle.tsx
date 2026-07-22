import { Sun, Moon } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { cn } from '../../lib/utils';

interface ThemeToggleProps {
  className?: string;
}

export default function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useUIStore();
  const isDark = theme === 'dark';

  return (
    <button
      id="theme-toggle"
      onClick={toggleTheme}
      className={cn(
        'relative w-8 h-8 rounded-lg flex items-center justify-center',
        'text-gray-500 dark:text-gray-400',
        'hover:bg-gray-100 dark:hover:bg-gray-800',
        'hover:text-gray-700 dark:hover:text-gray-200',
        'transition-all duration-150',
        className,
      )}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      <span
        className={cn(
          'absolute transition-all duration-200',
          isDark ? 'opacity-0 scale-75 rotate-90' : 'opacity-100 scale-100 rotate-0',
        )}
      >
        <Sun className="w-4 h-4" />
      </span>
      <span
        className={cn(
          'absolute transition-all duration-200',
          isDark ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-75 -rotate-90',
        )}
      >
        <Moon className="w-4 h-4" />
      </span>
    </button>
  );
}
