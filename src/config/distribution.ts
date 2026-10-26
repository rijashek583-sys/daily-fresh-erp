/**
 * Daily Fresh ERP — Central Distribution & Release Configuration
 * Defines official release artifacts, stable HTTPS download endpoints,
 * and reliable runtime environment detection across Windows, Android, and Web.
 */

import { Capacitor } from '@capacitor/core';

export type RuntimeEnvironment = 'web' | 'electron' | 'capacitor' | 'pwa-standalone';

export interface PlatformReleaseInfo {
  version: string;
  downloadUrl: string;
  directVersionUrl: string;
  fileName: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  sha256: string;
  mandatory?: boolean;
}

export interface ReleaseManifest {
  version: string;
  buildId?: string;
  name: string;
  releaseDate: string;
  releaseNotes: string;
  repository: string;
  releasesPage: string;
  features?: Record<string, boolean>;
  platforms: {
    windows: PlatformReleaseInfo;
    android: PlatformReleaseInfo & { versionCode: number };
    web: {
      version: string;
      buildId?: string;
      canonicalUrl: string;
    };
  };
}

import packageJson from '../../package.json';

export const OFFICIAL_DISTRIBUTION = {
  version: packageJson.version || '1.0.9',
  buildId: (packageJson as { buildId?: string }).buildId || `v${packageJson.version || '1.0.9'}-20261024-r1`,
  appName: 'Daily Fresh ERP',
  repositoryUrl: 'https://github.com/rijashek583-sys/daily-fresh-erp',
  releasesPageUrl: 'https://github.com/rijashek583-sys/daily-fresh-erp/releases',
  versionCheckEndpoint: 'https://daily-fresh-billing-system.web.app/version.json',
  downloads: {
    windows: {
      fileName: 'DailyFresh-Setup.exe',
      latestUrl: 'https://firebasestorage.googleapis.com/v0/b/daily-fresh-billing-system.firebasestorage.app/o/releases%2FDailyFresh-Setup.exe?alt=media',
      versionUrl: 'https://firebasestorage.googleapis.com/v0/b/daily-fresh-billing-system.firebasestorage.app/o/releases%2FDailyFresh-Setup.exe?alt=media',
      fileSize: '108.5 MB',
      fileSizeBytes: 113801158,
      sha256: '3FDF1E2A547DD8D1CD33DBC6B286D7B8463B78B469A88B426EAE46F969429AF1',
      format: 'NSIS Windows 64-bit Installer',
      signingStatus: 'Signed with local release certificate',
    },
    android: {
      fileName: 'DailyFresh.apk',
      latestUrl: 'https://firebasestorage.googleapis.com/v0/b/daily-fresh-billing-system.firebasestorage.app/o/releases%2FDailyFresh.apk?alt=media',
      versionUrl: 'https://firebasestorage.googleapis.com/v0/b/daily-fresh-billing-system.firebasestorage.app/o/releases%2FDailyFresh.apk?alt=media',
      fileSize: '16.1 MB',
      fileSizeBytes: 16914073,
      sha256: 'FC5B4A98134429F954CF8FF663029F8BFF104358F1CBB1278C15A2A668A77BE7',
      format: 'Signed Release APK (v2 Full APK Signature Scheme)',
      signingStatus: 'Signed (Persistent 2048-bit RSA Keystore valid to 2054)',
    },
  },
};

/**
 * Returns the appropriate version check endpoint for the current environment.
 * In Web/PWA mode, uses relative '/version.json' to ensure origin compatibility.
 * In Electron/Capacitor native runtimes, uses canonical Firebase Hosting URL.
 */
export function getVersionCheckEndpoint(): string {
  if (typeof window !== 'undefined') {
    const runtime = getRuntimeEnvironment();
    if (runtime === 'web' || runtime === 'pwa-standalone') {
      return '/version.json';
    }
  }
  return OFFICIAL_DISTRIBUTION.versionCheckEndpoint;
}

/**
 * Reliably detects the current execution runtime environment.
 * Does NOT rely solely on user-agent strings.
 */
export function getRuntimeEnvironment(): RuntimeEnvironment {
  if (typeof window === 'undefined') return 'web';

  // 1. Electron runtime detection (injected context bridge property)
  const electronApi = (window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI;
  if (electronApi?.isElectron === true) {
    return 'electron';
  }
  if (window.navigator?.userAgent?.includes('Electron')) {
    return 'electron';
  }

  // 2. Capacitor native runtime detection
  try {
    if (Capacitor.isNativePlatform()) {
      return 'capacitor';
    }
  } catch {
    // ignore
  }

  const win = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
    androidBridge?: unknown;
  };
  if (win?.androidBridge || (win?.Capacitor && typeof win.Capacitor.isNativePlatform === 'function' && win.Capacitor.isNativePlatform())) {
    return 'capacitor';
  }

  // 3. Standalone PWA display mode detection
  if (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    (window.navigator as unknown as { standalone?: boolean })?.standalone === true ||
    (typeof document !== 'undefined' && document.referrer?.startsWith('android-app://'))
  ) {
    return 'pwa-standalone';
  }

  return 'web';
}

/**
 * Returns true if the user is currently inside an installed application
 * (Windows desktop app, Android native app, or installed standalone PWA).
 */
export function isInstalledAppRuntime(): boolean {
  return getRuntimeEnvironment() !== 'web';
}

/**
 * Returns a human-friendly, accurate platform display name based on
 * the active runtime environment and host operating system.
 */
export function getPlatformDisplayName(): string {
  const runtime = getRuntimeEnvironment();
  if (typeof window === 'undefined') return 'Web Application';

  if (runtime === 'electron') {
    return 'Windows Desktop Application';
  }
  if (runtime === 'capacitor') {
    return 'Android Native Application';
  }

  const ua = window.navigator?.userAgent || '';
  const isIPad =
    /macintosh/i.test(ua) &&
    typeof window.navigator?.maxTouchPoints === 'number' &&
    window.navigator.maxTouchPoints > 1;
  const isIos = /ipad|iphone|ipod/i.test(ua) || isIPad;
  const isAndroid = /android/i.test(ua);
  const isMac = /macintosh|mac os x/i.test(ua) && !isIPad;
  const isWindows = /windows/i.test(ua);

  if (runtime === 'pwa-standalone') {
    if (isIos) return 'iPhone / iPad Installed App (PWA)';
    if (isAndroid) return 'Android Installed App (PWA)';
    if (isMac) return 'macOS Installed App (PWA)';
    if (isWindows) return 'Windows Installed App (PWA)';
    return 'Installed Application (PWA)';
  }

  // runtime === 'web'
  if (isIos) return 'Apple iOS Safari';
  if (isAndroid) return 'Android Mobile Browser';
  if (isMac) return 'macOS Web Browser';
  if (isWindows) return 'Windows Web Browser';
  return 'Web Browser';
}

