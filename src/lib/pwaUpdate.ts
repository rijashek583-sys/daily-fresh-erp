import { registerSW } from 'virtual:pwa-register';
import { hasUnsavedInput } from './lazyRetry';
import { getRuntimeEnvironment } from '../config/distribution';

type UpdateSWFunction = (reloadPage?: boolean) => Promise<void>;

let updateSWFn: UpdateSWFunction | null = null;
let isUpdateReady = false;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach(fn => {
    try {
      fn();
    } catch {
      // Ignore
    }
  });
}

/**
 * Subscribes to PWA update availability state changes.
 */
export function subscribeToPwaUpdates(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Returns whether a new version of the app is downloaded and ready to activate.
 */
export function getIsUpdateReady(): boolean {
  return isUpdateReady;
}

/**
 * Actively checks the service worker registration for pending or new updates.
 * Returns true if an update is waiting or immediately available.
 */
export async function checkForPwaServiceWorkerUpdate(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    await registration.update();
    return isUpdateReady || Boolean(registration.waiting);
  } catch (err) {
    console.warn('[PwaUpdate] Service worker update check error:', err);
    return isUpdateReady;
  }
}


/**
 * Safely applies the service worker update and refreshes the application.
 * Specifically handles iOS WebKit / PWA standalone lifecycle:
 * 1. Checks for unsaved user input
 * 2. Directly signals any waiting service worker with SKIP_WAITING
 * 3. Listens for controllerchange to reload immediately upon activation
 * 4. Calls updateSWFn(true)
 * 5. Uses a guaranteed 1,200ms fallback reload timer so iOS WebKit cannot hang indefinitely
 */
export async function applyPwaUpdate(force = false): Promise<boolean> {
  if (!force && hasUnsavedInput()) {
    const confirmed = window.confirm(
      'A new version of Daily Fresh is ready. You have unsaved changes in an open form. Updating now will refresh the page. Do you wish to continue?'
    );
    if (!confirmed) {
      return false;
    }
  }

  let hasReloaded = false;
  const triggerReload = () => {
    if (hasReloaded) return;
    hasReloaded = true;
    try {
      window.location.reload();
    } catch {
      window.location.assign(window.location.href);
    }
  };

  // Guaranteed fallback: if controllerchange or updateSWFn does not reload within 1,200ms, force reload
  const reloadTimer = setTimeout(triggerReload, 1200);

  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      // Listen for controller change
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => {
          clearTimeout(reloadTimer);
          triggerReload();
        },
        { once: true }
      );

      // Actively nudge any waiting service worker to activate
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      } else if (registration?.installing) {
        registration.installing.addEventListener('statechange', (e) => {
          const sw = e.target as ServiceWorker;
          if (sw.state === 'installed' || sw.state === 'activated') {
            sw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      }
    }

    if (updateSWFn) {
      await updateSWFn(true);
    }
    return true;
  } catch (err) {
    console.error('[PwaUpdate] Error applying update, falling back to reload:', err);
    clearTimeout(reloadTimer);
    triggerReload();
    return true;
  }
}

/**
 * Initializes the PWA service worker with proactive lifecycle checks.
 * Only executes in web browser and PWA standalone runtimes.
 * Never initializes in native Capacitor Android or Electron desktop runtimes.
 */
export function initPwaUpdateService(): void {
  if (typeof window === 'undefined') return;

  const runtime = getRuntimeEnvironment();
  if (runtime === 'capacitor' || runtime === 'electron') {
    // Unregister any stale service workers that may have been cached in the native webview
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister().catch(() => {});
        }
      }).catch(() => {});
    }
    return;
  }

  try {
    updateSWFn = registerSW({
      immediate: true,
      onNeedRefresh() {
        console.info('[Daily Fresh PWA] New version downloaded and waiting for activation.');
        isUpdateReady = true;
        notifyListeners();
      },
      onOfflineReady() {
        console.info('[Daily Fresh PWA] Application precache ready for offline use.');
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;

        // 1. Proactive check when user brings the tab / app to the foreground
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(() => {});
          }
        });

        // 2. Proactive check when device reconnects to internet
        window.addEventListener('online', () => {
          registration.update().catch(() => {});
        });

        // 3. Proactive periodic check every 15 minutes
        setInterval(() => {
          registration.update().catch(() => {});
        }, 15 * 60 * 1000);
      },
      onRegisterError(error) {
        console.warn('[Daily Fresh PWA] Service worker registration error:', error);
      },
    });
  } catch (err) {
    console.warn('[Daily Fresh PWA] registerSW initialization failed:', err);
  }
}
