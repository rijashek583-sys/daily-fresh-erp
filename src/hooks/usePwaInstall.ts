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

// Global reference so prompt is retained across route transitions and re-renders
let globalPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(prompt: BeforeInstallPromptEvent | null) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent default mini-infobar on mobile and save prompt event
    e.preventDefault();
    globalPrompt = e as BeforeInstallPromptEvent;
    listeners.forEach((fn) => fn(globalPrompt));
  });

  window.addEventListener('appinstalled', () => {
    globalPrompt = null;
    listeners.forEach((fn) => fn(null));
  });
}

export function detectPlatform(): Platform {
  if (typeof window === 'undefined' || !window.navigator) return 'other';
  const ua = window.navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/ipad|iphone|ipod/i.test(ua)) return 'ios';
  if (/windows/i.test(ua)) return 'windows';
  if (/macintosh|mac os x/i.test(ua)) return 'macos';
  return 'other';
}

export function usePwaInstall() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(globalPrompt);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [showInstructions, setShowInstructions] = useState<boolean>(false);
  const [platform, setPlatform] = useState<Platform>('other');

  useEffect(() => {
    // Check standalone mode (PWA window or homescreen app)
    const checkStandalone = () => {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
        document.referrer.includes('android-app://');
      setIsStandalone(standalone);
      if (standalone) setIsInstalled(true);
    };

    checkStandalone();
    setPlatform(detectPlatform());

    const updatePrompt = (p: BeforeInstallPromptEvent | null) => {
      setPrompt(p);
    };

    listeners.add(updatePrompt);

    const onAppInstalled = () => {
      setIsInstalled(true);
      setShowInstructions(false);
    };

    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      listeners.delete(updatePrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const triggerInstall = useCallback(async (): Promise<'prompted' | 'instructions'> => {
    if (prompt) {
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice.outcome === 'accepted') {
          globalPrompt = null;
          setPrompt(null);
          setIsInstalled(true);
          return 'prompted';
        }
        return 'prompted';
      } catch (err) {
        console.error('PWA install prompt error:', err);
        setShowInstructions(true);
        return 'instructions';
      }
    } else {
      // Browser doesn't support or haven't fired beforeinstallprompt
      setShowInstructions(true);
      return 'instructions';
    }
  }, [prompt]);

  return {
    isStandalone,
    isInstalled,
    hasNativePrompt: !!prompt,
    platform,
    showInstructions,
    setShowInstructions,
    triggerInstall,
  };
}
