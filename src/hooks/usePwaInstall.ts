import { useState, useEffect, useCallback } from 'react';

export type Platform = 'android' | 'windows' | 'ios' | 'macos' | 'other';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

// Module-level singleton state so installation status is preserved across route transitions
let globalPrompt: BeforeInstallPromptEvent | null = null;
let globalIsInstalled = false;
let globalIsStandalone = false;
let globalPlatform: Platform = 'other';
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

function initPwaState() {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  globalPlatform = detectPlatform();
  globalIsStandalone = checkStandaloneMode();
  if (globalIsStandalone) {
    globalIsInstalled = true;
  }

  // Check supported Chromium getInstalledRelatedApps API
  if ('getInstalledRelatedApps' in window.navigator) {
    (navigator as unknown as { getInstalledRelatedApps: () => Promise<unknown[]> })
      .getInstalledRelatedApps()
      .then((apps) => {
        if (Array.isArray(apps) && apps.length > 0) {
          globalIsInstalled = true;
          notifyListeners();
        }
      })
      .catch(() => {});
  }

  // Single module-level beforeinstallprompt listener
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    globalPrompt = e as BeforeInstallPromptEvent;
    notifyListeners();
  });

  // Single module-level appinstalled listener (confirmed by browser)
  window.addEventListener('appinstalled', () => {
    globalPrompt = null;
    globalIsInstalled = true;
    notifyListeners();
  });

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

export function usePwaInstall() {
  initPwaState();

  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(globalPrompt);
  const [isStandalone, setIsStandalone] = useState<boolean>(globalIsStandalone);
  const [isInstalled, setIsInstalled] = useState<boolean>(globalIsInstalled || globalIsStandalone);
  const [platform, setPlatform] = useState<Platform>(globalPlatform);
  const [showInstructions, setShowInstructions] = useState<boolean>(false);

  useEffect(() => {
    const sync = () => {
      setPrompt(globalPrompt);
      setIsStandalone(globalIsStandalone);
      setIsInstalled(globalIsInstalled || globalIsStandalone);
      setPlatform(globalPlatform);
    };

    stateListeners.add(sync);
    sync();

    return () => {
      stateListeners.delete(sync);
    };
  }, []);

  const triggerInstall = useCallback(async (): Promise<'prompted' | 'instructions' | 'already-installed'> => {
    if (globalIsStandalone || globalIsInstalled) {
      return 'already-installed';
    }

    if (globalPrompt) {
      try {
        await globalPrompt.prompt();
        const choice = await globalPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          globalPrompt = null;
          globalIsInstalled = true;
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
      // Browser doesn't support or has not fired beforeinstallprompt
      setShowInstructions(true);
      return 'instructions';
    }
  }, []);

  const effectiveInstalled = isInstalled || isStandalone;

  return {
    isStandalone,
    isInstalled: effectiveInstalled,
    hasNativePrompt: !!prompt && !effectiveInstalled,
    platform,
    showInstructions,
    setShowInstructions,
    triggerInstall,
  };
}
