import { Providers } from './app/providers';
import { AppRouter } from './app/router';
import { Toaster } from 'sonner';
import { useEffect } from 'react';
import { useDataStore } from './stores/dataStore';

export default function App() {
  useEffect(() => {
    const unsubscribe = useDataStore.getState().initialize();
    return () => unsubscribe();
  }, []);

  return (
    <Providers>
      <AppRouter />
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{
          style: { fontFamily: 'Inter, system-ui, sans-serif', borderRadius: '12px' },
        }}
      />
    </Providers>
  );
}
