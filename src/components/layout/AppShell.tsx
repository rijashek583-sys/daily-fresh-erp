import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import Sidebar from './Sidebar';
import MobileSidebar from './MobileSidebar';
import Header from './Header';
import { useDataStore } from '../../stores/dataStore';
import { useUIStore } from '../../stores/uiStore';
import { AlertTriangle, X } from 'lucide-react';

export default function AppShell() {
  const { listenerError, clearListenerError } = useDataStore();
  const { sidebarOpen, setSidebarOpen } = useUIStore();

  // Close drawer on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) setSidebarOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [sidebarOpen, setSidebarOpen]);

  // Lock body scroll when drawer is open on mobile
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex transition-colors duration-200">
      {/* Desktop sidebar — hidden below md */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      <MobileSidebar />

      {/* Main content area — on mobile no left margin, on md+ shift right by sidebar width */}
      <div className="flex-1 flex flex-col min-w-0 md:ml-[280px]">
        <Header />

        {/* Firestore sync error banner */}
        {listenerError && (
          <div
            role="alert"
            className="flex items-center gap-3 px-6 py-3 bg-red-600 text-white text-sm font-medium"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{listenerError}</span>
            <button
              onClick={clearListenerError}
              aria-label="Dismiss sync error"
              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-10 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
