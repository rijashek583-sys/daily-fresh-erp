import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { registerSW } from 'virtual:pwa-register';
import { setupGlobalChunkErrorHandler } from './lib/lazyRetry';

// Initialize global handler for dynamic import and preload errors
setupGlobalChunkErrorHandler();

// Register service worker for safe automatic updates
registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log('Daily Fresh PWA: update available, will activate on next visit.');
  },
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      // Periodically check for application updates (hourly)
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 60 * 1000);
    }
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
