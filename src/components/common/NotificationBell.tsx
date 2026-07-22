import { useState, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';


interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
}

const mockNotifications: Notification[] = [
  { id: '1', title: 'New Order Placed', message: 'Order #ORD-2023 for Morning Bliss Bakery has been placed.', time: '5m ago', read: false },
  { id: '2', title: 'Payment Received', message: '₹4,500 received from Fresh Mart.', time: '1h ago', read: false },
  { id: '3', title: 'Low Stock Alert', message: 'Whole Wheat Bread stock is running low.', time: '2h ago', read: true },
];

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(mockNotifications);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markAllRead = () => {
    setNotifications(notifications.map(n => ({ ...n, read: true })));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative w-10 h-10 rounded-full flex items-center justify-center text-gray-500 hover:text-gray-900 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-2 right-2.5 w-2 h-2 bg-[var(--color-primary)] rounded-full border border-white dark:border-gray-950" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-3 w-80 sm:w-96 bg-white dark:bg-gray-900 rounded-3xl shadow-[var(--shadow-hover)] border border-gray-100 dark:border-white/[0.05] z-50 animate-in slide-in-from-top-2 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.05]">
            <h3 className="font-extrabold text-[var(--color-text-main)]">Notifications</h3>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs font-bold text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors">
                Mark all as read
              </button>
            )}
          </div>
          
          <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
            {notifications.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <Bell className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">No notifications</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-800/40">
                {notifications.map(n => (
                  <div key={n.id} className={`px-6 py-4 flex gap-4 transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-800/30 ${n.read ? 'opacity-70' : 'bg-red-50/30 dark:bg-red-900/10'}`}>
                    <div className="shrink-0 mt-1">
                      {n.read ? (
                        <div className="w-2 h-2 bg-gray-300 dark:bg-gray-600 rounded-full" />
                      ) : (
                        <div className="w-2 h-2 bg-[var(--color-primary)] rounded-full animate-pulse" />
                      )}
                    </div>
                    <div>
                      <p className={`text-sm mb-0.5 ${n.read ? 'font-medium text-gray-700 dark:text-gray-300' : 'font-bold text-[var(--color-text-main)]'}`}>{n.title}</p>
                      <p className="text-xs text-[var(--color-text-muted)] line-clamp-2">{n.message}</p>
                      <p className="text-[10px] font-semibold text-gray-400 mt-2 uppercase tracking-wider">{n.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
