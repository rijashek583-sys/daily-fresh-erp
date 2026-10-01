import { useState, useRef, useEffect } from 'react';
import { LogOut, User, Settings as SettingsIcon } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { Avatar } from '../ui';
import { useNavigate } from 'react-router-dom';

export default function UserMenu() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 pl-2 pr-4 py-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
      >
        <Avatar name={user.name} size="sm" />
        <span className="text-sm font-bold text-[var(--color-text-main)] hidden sm:block">| {user.name}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-3 w-56 bg-white dark:bg-gray-900 rounded-3xl shadow-[var(--shadow-hover)] border border-gray-100 dark:border-white/[0.05] py-2 z-50 animate-in slide-in-from-top-2">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-white/[0.05] mb-2">
            <p className="text-sm font-bold text-[var(--color-text-main)] truncate">{user.name}</p>
            <p className="text-xs text-[var(--color-text-muted)] truncate">{user.email}</p>
            <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/40 text-[var(--color-primary)] uppercase tracking-wider">
              {user.role}
            </span>
          </div>

          {user.role === 'admin' && (
            <>
              <button onClick={() => { setOpen(false); navigate('/settings'); }} className="w-full flex items-center gap-3 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                <User className="w-4 h-4 text-gray-400" />
                Profile
              </button>
              
              <button onClick={() => { setOpen(false); navigate('/settings'); }} className="w-full flex items-center gap-3 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                <SettingsIcon className="w-4 h-4 text-gray-400" />
                Settings
              </button>

              <div className="h-px bg-gray-100 dark:bg-white/[0.05] my-2" />
            </>
          )}

          <button
            onClick={() => { setOpen(false); logout(); navigate('/login'); }}
            className="w-full flex items-center gap-3 px-5 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
