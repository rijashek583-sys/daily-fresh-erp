import { Providers } from './app/providers';
import { AppRouter } from './app/router';
import { Toaster } from 'sonner';
import { useEffect } from 'react';
import PwaUpdateBanner from './components/pwa/PwaUpdateBanner';
import NativeAppUpdateModal from './components/pwa/NativeAppUpdateModal';
import { initAppUpdateLifecycle } from './services/appUpdateService';

export default function App() {
  useEffect(() => {
    const unsubscribeUpdate = initAppUpdateLifecycle();
    return () => {
      unsubscribeUpdate();
    };
  }, []);

  return (
    <Providers>
      <AppRouter />
      <PwaUpdateBanner />
      <NativeAppUpdateModal />
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
