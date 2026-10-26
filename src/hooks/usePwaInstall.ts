import { useState, useEffect, useCallback } from 'react';
import {
  getRuntimeEnvironment,
  isInstalledAppRuntime,
  OFFICIAL_DISTRIBUTION,
  type RuntimeEnvironment,
} from '../config/distribution';

export type Platform = 'android' | 'windows' | 'ios' | 'macos' | 'other';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

declare global {
  interface Window {
    __dfPwaPrompt?: BeforeInstallPromptEvent | null;
    __dfPwaInstalled?: boolean;
  }
}

// Module-level singleton state so installation status is preserved across route transitions
let globalPrompt: BeforeInstallPromptEvent | null = null;
let globalIsInstalled = false;
let globalIsStandalone = false;
let globalPlatform: Platform = 'other';
let globalIsInAppBrowser = false;
let isInitialized = false;

const stateListeners = new Set<() => void>();

function notifyListeners() {
  stateListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

/**
 * Detects whether the page is being viewed inside an in-app browser/webview
 * (e.g. WhatsApp, Facebook, Instagram, Telegram) where native PWA installation is blocked.
 */
export function isInAppBrowser(): boolean {
  if (typeof window === 'undefined' || !window.navigator) return false;
  // If running inside Capacitor or standalone PWA, it is NEVER an in-app browser
  if (isInstalledAppRuntime()) return false;
  const ua = (window.navigator.userAgent || '').toLowerCase();
  return (
    ua.includes('fbav') || // Facebook App
    ua.includes('instagram') || // Instagram
    ua.includes('whatsapp') || // WhatsApp in-app browser
    ua.includes('line/') || // Line
    ua.includes('micromessenger') || // WeChat
    ua.includes('telegram') // Telegram
  );
}

export function detectPlatform(): Platform {
  if (typeof window === 'undefined' || !window.navigator) return 'other';
  const ua = window.navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';

  // Modern iPadOS 13+ devices identify as Macintosh but have touch points
  const isIPad =
    /macintosh/i.test(ua) &&
    typeof window.navigator.maxTouchPoints === 'number' &&
    window.navigator.maxTouchPoints > 1;

  if (/ipad|iphone|ipod/i.test(ua) || isIPad) return 'ios';
  if (/windows/i.test(ua)) return 'windows';
  if (/macintosh|mac os x/i.test(ua)) return 'macos';
  return 'other';
}

function checkStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    (typeof document !== 'undefined' && document.referrer.startsWith('android-app://'))
  );
}

/**
 * Waits briefly for a beforeinstallprompt event if Chromium is still initializing it.
 */
function waitForPrompt(timeoutMs = 800): Promise<BeforeInstallPromptEvent | null> {
  return new Promise((resolve) => {
    if (globalPrompt) {
      resolve(globalPrompt);
      return;
    }
    if (typeof window !== 'undefined' && window.__dfPwaPrompt) {
      globalPrompt = window.__dfPwaPrompt;
      resolve(globalPrompt);
      return;
    }

    if (typeof window === 'undefined') {
      resolve(null);
      return;
    }

    let timeoutId: number | undefined;

    const onAvailable = () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('df-pwa-prompt-available', onAvailable);
      window.removeEventListener('beforeinstallprompt', onAvailable);
      const readyPrompt = globalPrompt || window.__dfPwaPrompt || null;
      resolve(readyPrompt);
    };

    window.addEventListener('df-pwa-prompt-available', onAvailable, { once: true });
    window.addEventListener('beforeinstallprompt', onAvailable, { once: true });

    timeoutId = window.setTimeout(() => {
      window.removeEventListener('df-pwa-prompt-available', onAvailable);
      window.removeEventListener('beforeinstallprompt', onAvailable);
      resolve(globalPrompt || window.__dfPwaPrompt || null);
    }, timeoutMs);
  });
}

function initPwaState() {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  globalPlatform = detectPlatform();
  globalIsInAppBrowser = isInAppBrowser();
  globalIsStandalone = checkStandaloneMode() || isInstalledAppRuntime();

  if (isInstalledAppRuntime()) {
    globalIsInstalled = true;
    globalIsStandalone = true;
    globalPrompt = null;
    return;
  }

  // Check stored install flag or standalone state
  let hasStoredInstall = false;
  try {
    hasStoredInstall = localStorage.getItem('df_pwa_installed') === 'true';
  } catch {
    // ignore
  }

  if (globalIsStandalone || hasStoredInstall || window.__dfPwaInstalled) {
    globalIsInstalled = true;
  }

  // Check early captured prompt from index.html inline script
  if (window.__dfPwaPrompt) {
    globalPrompt = window.__dfPwaPrompt;
    // Browser is offering install prompt: app is not currently installed
    globalIsInstalled = false;
  }

  // Check supported Chromium getInstalledRelatedApps API
  if ('getInstalledRelatedApps' in window.navigator) {
    (navigator as unknown as { getInstalledRelatedApps: () => Promise<unknown[]> })
      .getInstalledRelatedApps()
      .then((apps) => {
        if (Array.isArray(apps) && apps.length > 0) {
          globalIsInstalled = true;
          try {
            localStorage.setItem('df_pwa_installed', 'true');
          } catch {
            // ignore
          }
          notifyListeners();
        }
      })
      .catch(() => {});
  }

  // Listen to early capture custom event from index.html
  window.addEventListener('df-pwa-prompt-available', (e: Event) => {
    if (isInstalledAppRuntime()) return;
    const customEvent = e as CustomEvent<BeforeInstallPromptEvent>;
    if (customEvent.detail) {
      globalPrompt = customEvent.detail;
    } else if (window.__dfPwaPrompt) {
      globalPrompt = window.__dfPwaPrompt;
    }
    // When a prompt is available, the app is clearly not installed in the current browser session
    globalIsInstalled = false;
    try {
      localStorage.removeItem('df_pwa_installed');
    } catch {
      // ignore
    }
    notifyListeners();
  });

  // Direct module-level beforeinstallprompt listener
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    if (isInstalledAppRuntime()) return;
    globalPrompt = e as BeforeInstallPromptEvent;
    window.__dfPwaPrompt = e as BeforeInstallPromptEvent;
    globalIsInstalled = false;
    try {
      localStorage.removeItem('df_pwa_installed');
    } catch {
      // ignore
    }
    notifyListeners();
  });

  const handleInstalled = () => {
    globalPrompt = null;
    if (typeof window !== 'undefined') {
      window.__dfPwaPrompt = null;
    }
    globalIsInstalled = true;
    try {
      localStorage.setItem('df_pwa_installed', 'true');
    } catch {
      // ignore
    }
    notifyListeners();
  };

  // Direct module-level appinstalled listeners (confirmed by browser)
  window.addEventListener('appinstalled', handleInstalled);
  window.addEventListener('df-pwa-installed', handleInstalled);

  // Single module-level display-mode change listener
  const mediaQuery = window.matchMedia('(display-mode: standalone)');
  const handleModeChange = (e: MediaQueryListEvent) => {
    if (e.matches) {
      globalIsStandalone = true;
      globalIsInstalled = true;
      notifyListeners();
    }
  };

  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', handleModeChange);
  } else if ((mediaQuery as unknown as { addListener?: (fn: (e: MediaQueryListEvent) => void) => void }).addListener) {
    (mediaQuery as unknown as { addListener: (fn: (e: MediaQueryListEvent) => void) => void }).addListener(handleModeChange);
  }
}

// Proactively run initialization at module load time
if (typeof window !== 'undefined') {
  initPwaState();
}

export function usePwaInstall() {
  initPwaState();

  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(
    globalPrompt || (typeof window !== 'undefined' ? window.__dfPwaPrompt || null : null)
  );
  const [isStandalone, setIsStandalone] = useState<boolean>(globalIsStandalone);
  const [isInstalled, setIsInstalled] = useState<boolean>(globalIsInstalled || globalIsStandalone);
  const [platform, setPlatform] = useState<Platform>(globalPlatform);
  const [isInApp, setIsInApp] = useState<boolean>(globalIsInAppBrowser);
  const [showInstructions, setShowInstructions] = useState<boolean>(false);

  useEffect(() => {
    const sync = () => {
      setPrompt(globalPrompt || (typeof window !== 'undefined' ? window.__dfPwaPrompt || null : null));
      setIsStandalone(globalIsStandalone);
      setIsInstalled(globalIsInstalled || globalIsStandalone);
      setPlatform(globalPlatform);
      setIsInApp(globalIsInAppBrowser);
    };

    stateListeners.add(sync);
    sync();

    return () => {
      stateListeners.delete(sync);
    };
  }, []);

  const triggerInstall = useCallback(async (): Promise<'download-started' | 'prompted' | 'instructions' | 'already-installed'> => {
    // If running inside the standalone or native app, nothing to install
    if (globalIsStandalone || isInstalledAppRuntime()) {
      return 'already-installed';
    }

    const currentPlatform = detectPlatform();

    // 1. On Windows web browsers, clicking Install downloads the official DailyFresh-Setup.exe installer
    if (currentPlatform === 'windows') {
      try {
        const link = document.createElement('a');
        link.href = OFFICIAL_DISTRIBUTION.downloads.windows.latestUrl;
        link.download = OFFICIAL_DISTRIBUTION.downloads.windows.fileName;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return 'download-started';
      } catch (err) {
        console.error('Failed to trigger Windows installer download:', err);
        setShowInstructions(true);
        return 'instructions';
      }
    }

    // 2. On Android mobile browsers: trigger native 1-click PWA installation if supported
    if (currentPlatform === 'android') {
      let promptToUse = globalPrompt || (typeof window !== 'undefined' ? window.__dfPwaPrompt || null : null);
      if (!promptToUse) {
        promptToUse = await waitForPrompt(600);
      }

      if (promptToUse) {
        globalPrompt = null;
        if (typeof window !== 'undefined') {
          window.__dfPwaPrompt = null;
        }
        notifyListeners();

        try {
          await promptToUse.prompt();
          const choice = await promptToUse.userChoice;
          if (choice.outcome === 'accepted') {
            globalIsInstalled = true;
            try {
              localStorage.setItem('df_pwa_installed', 'true');
            } catch {
              // ignore
            }
            notifyListeners();
            return 'prompted';
          }
          return 'prompted';
        } catch (err) {
          console.error('Android PWA install prompt error:', err);
          setShowInstructions(true);
          return 'instructions';
        }
      } else {
        // Direct prompt unavailable (e.g. user previously dismissed or browser menu install required)
        setShowInstructions(true);
        return 'instructions';
      }
    }

    // 3. On iPhone/iPad web browsers, retain the Safari Add to Home Screen guide
    if (currentPlatform === 'ios') {
      setShowInstructions(true);
      return 'instructions';
    }

    // 4. On macOS web browsers, check for Chromium PWA prompt or retain Mac installation guide
    let promptToUse = globalPrompt || (typeof window !== 'undefined' ? window.__dfPwaPrompt || null : null);
    if (!promptToUse) {
      promptToUse = await waitForPrompt(600);
    }

    if (promptToUse) {
      globalPrompt = null;
      if (typeof window !== 'undefined') {
        window.__dfPwaPrompt = null;
      }
      notifyListeners();

      try {
        await promptToUse.prompt();
        const choice = await promptToUse.userChoice;
        if (choice.outcome === 'accepted') {
          globalIsInstalled = true;
          try {
            localStorage.setItem('df_pwa_installed', 'true');
          } catch {
            // ignore
          }
          notifyListeners();
          return 'prompted';
        }
        return 'prompted';
      } catch (err) {
        console.error('PWA install prompt error:', err);
        setShowInstructions(true);
        return 'instructions';
      }
    } else {
      setShowInstructions(true);
      return 'instructions';
    }
  }, []);

  const effectiveInstalled = isInstalled || isStandalone;

  return {
    isStandalone,
    isInstalled: effectiveInstalled,
    hasNativePrompt: (!!prompt || (typeof window !== 'undefined' && !!window.__dfPwaPrompt)) && !effectiveInstalled,
    platform,
    isInAppBrowser: isInApp,
    showInstructions,
    setShowInstructions,
    triggerInstall,
  };
}

