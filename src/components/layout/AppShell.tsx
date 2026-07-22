import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useDataStore } from '../../stores/dataStore';
import { AlertTriangle, X } from 'lucide-react';


export default function AppShell() {
  const { listenerError, clearListenerError } = useDataStore();

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex transition-colors duration-200">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 ml-[280px]">
        <Header />

        {/* Firestore sync error banner — shown when any realtime listener fails */}
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

        <main className="flex-1 p-8 lg:p-10 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
