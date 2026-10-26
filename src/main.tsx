import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { setupGlobalChunkErrorHandler } from './lib/lazyRetry';
import { initPwaUpdateService } from './lib/pwaUpdate';

// Initialize global handler for dynamic import and preload errors
setupGlobalChunkErrorHandler();

// Initialize proactive PWA service worker lifecycle and update manager
initPwaUpdateService();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
