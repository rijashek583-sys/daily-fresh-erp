import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';

export function Providers({ children }: { children: React.ReactNode }) {
  const { theme } = useUIStore();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return <>{children}</>;
}
