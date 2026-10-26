/**
 * Daily Fresh ERP — Centralized Multi-Platform Application Update Service
 *
 * Checks remote version manifest on Firebase Hosting and orchestrates
 * safe, non-intrusive, user-confirmed update workflows across Web, PWA standalone,
 * Windows Electron, and Android Capacitor applications.
 *
 * ZERO FIRESTORE READS:
 * Uses static HTTP GET requests directly to `/version.json` with cache-busting headers.
 * Never accesses Firestore database or burns read quotas.
 */

import {
  OFFICIAL_DISTRIBUTION,
  getRuntimeEnvironment,
  getVersionCheckEndpoint,
  type ReleaseManifest,
  type PlatformReleaseInfo,
  type RuntimeEnvironment,
} from '../config/distribution';
import { applyRemoteFeatureOverrides } from '../config/features';
import { NativeAppUpdate, type DownloadProgress } from './nativeUpdatePlugin';
import { checkForPwaServiceWorkerUpdate, applyPwaUpdate } from '../lib/pwaUpdate';
import { hasUnsavedInput } from '../lib/lazyRetry';

export interface UpdateCheckResult {
  hasUpdate: boolean;
  runtime: RuntimeEnvironment;
  currentVersion: string;
  latestVersion: string;
  buildId?: string;
  releaseDate?: string;
  releaseNotes?: string;
  platformInfo?: PlatformReleaseInfo;
  downloadUrl?: string;
  mandatory?: boolean;
  updateType?: 'native-apk' | 'native-installer' | 'web-reload';
  error?: string;
}

export const DISMISSED_UPDATE_STORAGE_KEY = 'daily_fresh_dismissed_update_version';
export const PENDING_UPDATE_RELOAD_KEY = 'daily_fresh_pending_update_reload';

export interface PendingUpdateReloadInfo {
  targetVersion: string;
  targetBuildId?: string;
  timestamp: number;
}

let inMemoryPendingReload: PendingUpdateReloadInfo | null = null;

/**
 * Returns pending update reload info if user initiated an update reload recently.
 */
export function getPendingUpdateReload(): PendingUpdateReloadInfo | null {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const val = sessionStorage.getItem(PENDING_UPDATE_RELOAD_KEY);
      if (val) return JSON.parse(val);
      return null;
    }
  } catch {
    // ignore
  }
  return inMemoryPendingReload;
}

/**
 * Records that the user initiated an update reload for this version/build.
 */
export function setPendingUpdateReload(targetVersion: string, targetBuildId?: string): void {
  const info: PendingUpdateReloadInfo = {
    targetVersion,
    targetBuildId,
    timestamp: Date.now(),
  };
  inMemoryPendingReload = info;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(PENDING_UPDATE_RELOAD_KEY, JSON.stringify(info));
    }
  } catch {
    // ignore
  }
}

/**
 * Clears the pending update reload tracking key.
 */
export function clearPendingUpdateReload(): void {
  inMemoryPendingReload = null;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(PENDING_UPDATE_RELOAD_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Compares two semantic version strings.
 * Returns 1 if v1 > v2, -1 if v1 < v2, and 0 if equal.
 */
export function compareSemver(v1: string, v2: string): number {
  const parse = (v: string) =>
    (v || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const p1 = parse(v1);
  const p2 = parse(v2);
  const maxLen = Math.max(p1.length, p2.length);

  for (let i = 0; i < maxLen; i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

let inMemoryDismissedVersion: string | null = null;

/**
 * Returns the version string that the user dismissed for the current browser session.
 */
export function getDismissedUpdateVersion(): string | null {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const val = sessionStorage.getItem(DISMISSED_UPDATE_STORAGE_KEY);
      if (val !== null) return val;
    }
  } catch {
    // ignore
  }
  return inMemoryDismissedVersion;
}

/**
 * Records that the user dismissed the notification for a specific version.
 * Prevents repeated notifications for the same version in this session.
 */
export function setDismissedUpdateVersion(version: string): void {
  inMemoryDismissedVersion = version;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(DISMISSED_UPDATE_STORAGE_KEY, version);
    }
  } catch {
    // ignore
  }
}

/**
 * Checks whether the update notification for this version was dismissed.
 */
export function isUpdateDismissedForVersion(version: string): boolean {
  const dismissed = getDismissedUpdateVersion();
  return dismissed === version;
}

/**
 * Clears the dismissed update record (e.g. on manual check).
 */
export function clearDismissedUpdateVersion(): void {
  inMemoryDismissedVersion = null;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(DISMISSED_UPDATE_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

let cachedCheckResult: UpdateCheckResult | null = null;
const updateListeners = new Set<(result: UpdateCheckResult) => void>();

export function getCachedUpdateResult(): UpdateCheckResult | null {
  return cachedCheckResult;
}

export function subscribeToAppUpdates(listener: (result: UpdateCheckResult) => void): () => void {
  updateListeners.add(listener);
  if (cachedCheckResult) {
    listener(cachedCheckResult);
  }
  return () => {
    updateListeners.delete(listener);
  };
}

function notifyUpdateListeners(result: UpdateCheckResult) {
  cachedCheckResult = result;
  updateListeners.forEach((fn) => {
    try {
      fn(result);
    } catch {
      // ignore
    }
  });
}

/**
 * Triggers a universal update check event across the application.
 * Manually requested by the user from menus or settings.
 */
export function triggerAppUpdateCheck(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:trigger-update-check'));
  }
}

/**
 * Checks the official version endpoint for a newer compatible release.
 * Works uniformly across Web, PWA, Android, and Windows without Firestore reads.
 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  const runtime = getRuntimeEnvironment();
  let currentVersion = OFFICIAL_DISTRIBUTION.version;
  let installedVersionCode = 0;

  // 1. Query installed desktop binary version if in Electron
  if (runtime === 'electron') {
    const electronApi = (window as unknown as { electronAPI?: { getVersion?: () => Promise<string> } }).electronAPI;
    if (electronApi && typeof electronApi.getVersion === 'function') {
      try {
        const appVer = await electronApi.getVersion();
        if (appVer) currentVersion = appVer;
      } catch {
        // Fallback to distribution version
      }
    }
  }

  // 2. Query installed Android native APK version and versionCode if in Capacitor
  if (runtime === 'capacitor') {
    try {
      const appInfo = await NativeAppUpdate.getAppVersion();
      if (appInfo?.versionName) currentVersion = appInfo.versionName;
      if (appInfo?.versionCode) installedVersionCode = appInfo.versionCode;
    } catch {
      // Fallback to distribution version
    }
  }

  // 3. Graceful offline handling
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const offlineResult: UpdateCheckResult = {
      hasUpdate: false,
      runtime,
      currentVersion,
      latestVersion: currentVersion,
      error: 'Device is offline. Please check your internet connection.',
      updateType: runtime === 'capacitor' ? 'native-apk' : runtime === 'electron' ? 'native-installer' : 'web-reload',
    };
    notifyUpdateListeners(offlineResult);
    return offlineResult;
  }

  try {
    const endpoint = getVersionCheckEndpoint();
    const fetchUrl = endpoint.includes('?') ? `${endpoint}&t=${Date.now()}` : `${endpoint}?t=${Date.now()}`;
    const response = await fetch(fetchUrl, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch version manifest: HTTP ${response.status}`);
    }

    const manifest: ReleaseManifest = await response.json();

    // Propagate centralized feature flag overrides if delivered in manifest
    if (manifest.features && typeof manifest.features === 'object') {
      applyRemoteFeatureOverrides(manifest.features);
    }

    let hasUpdate = false;
    let platformInfo: PlatformReleaseInfo | undefined;
    let downloadUrl: string | undefined;
    let latestVersion = currentVersion;
    let updateType: 'native-apk' | 'native-installer' | 'web-reload' = 'web-reload';

    if (runtime === 'electron') {
      updateType = 'native-installer';
      platformInfo = manifest.platforms?.windows;
      if (platformInfo) {
        latestVersion = platformInfo.version || manifest.version;
        if (compareSemver(platformInfo.version, currentVersion) > 0) {
          hasUpdate = true;
          downloadUrl = platformInfo.downloadUrl;
        }
      }
    } else if (runtime === 'capacitor') {
      updateType = 'native-apk';
      platformInfo = manifest.platforms?.android;
      const remoteVersionCode = (manifest.platforms?.android as { versionCode?: number })?.versionCode ?? 0;
      if (platformInfo) {
        latestVersion = platformInfo.version || manifest.version;
        if (remoteVersionCode > 0 && installedVersionCode > 0) {
          if (remoteVersionCode > installedVersionCode) {
            hasUpdate = true;
          }
        } else if (compareSemver(platformInfo.version, currentVersion) > 0) {
          hasUpdate = true;
        }
        if (hasUpdate) {
          downloadUrl = platformInfo.downloadUrl;
        }
      }
    } else {
      // Web browser & PWA standalone (desktop Chrome, Edge, Safari, iOS PWA, Android Chrome)
      updateType = 'web-reload';
      const webManifestVersion = manifest.platforms?.web?.version || manifest.version;
      const webManifestBuildId = manifest.platforms?.web?.buildId || manifest.buildId;

      // Proactively check service worker for new assets waiting
      const swUpdateReady = await checkForPwaServiceWorkerUpdate();

      // Check if user recently executed an update reload for this version/build
      const pendingReload = getPendingUpdateReload();
      if (pendingReload) {
        const isMatched =
          currentVersion === pendingReload.targetVersion &&
          (!pendingReload.targetBuildId || OFFICIAL_DISTRIBUTION.buildId === pendingReload.targetBuildId);
        const isExpired = Date.now() - pendingReload.timestamp > 60000;

        if (isMatched || isExpired) {
          clearPendingUpdateReload();
        }
      }

      const activePendingReload = getPendingUpdateReload();
      const isPendingSuppressed = Boolean(
        activePendingReload &&
        activePendingReload.targetVersion === webManifestVersion &&
        (activePendingReload.targetBuildId ? activePendingReload.targetBuildId === webManifestBuildId : true)
      );

      if (swUpdateReady) {
        hasUpdate = !isPendingSuppressed;
        latestVersion =
          webManifestVersion && compareSemver(webManifestVersion, currentVersion) > 0
            ? webManifestVersion
            : currentVersion;
      } else if (webManifestVersion && compareSemver(webManifestVersion, currentVersion) > 0) {
        hasUpdate = !isPendingSuppressed;
        latestVersion = webManifestVersion;
      } else if (
        webManifestBuildId &&
        OFFICIAL_DISTRIBUTION.buildId &&
        webManifestBuildId !== OFFICIAL_DISTRIBUTION.buildId &&
        compareSemver(webManifestVersion || currentVersion, currentVersion) >= 0
      ) {
        hasUpdate = !isPendingSuppressed;
        latestVersion = webManifestVersion || currentVersion;
      } else {
        hasUpdate = false;
        latestVersion = currentVersion;
      }
    }

    const result: UpdateCheckResult = {
      hasUpdate,
      runtime,
      currentVersion,
      latestVersion,
      buildId: manifest.platforms?.web?.buildId || manifest.buildId,
      releaseDate: manifest.releaseDate,
      releaseNotes: manifest.releaseNotes,
      platformInfo,
      downloadUrl,
      mandatory: platformInfo?.mandatory ?? false,
      updateType,
    };

    notifyUpdateListeners(result);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn('[AppUpdateService] Version check failed (offline or unreachable):', errorMsg);
    const fallbackResult: UpdateCheckResult = {
      hasUpdate: false,
      runtime,
      currentVersion,
      latestVersion: currentVersion,
      error: `Could not connect to update server: ${errorMsg}`,
      updateType: runtime === 'capacitor' ? 'native-apk' : runtime === 'electron' ? 'native-installer' : 'web-reload',
    };
    notifyUpdateListeners(fallbackResult);
    return fallbackResult;
  }
}

/**
 * Safely applies an application update and refreshes the browser page.
 * Strictly verifies whether unsaved form input exists, and alerts the user
 * before reloading to avoid data loss.
 * NEVER reloads automatically during active billing or data-entry operations.
 */
export async function executeSafeWebReload(force = false): Promise<{ success: boolean; message: string }> {
  if (typeof window === 'undefined') {
    return { success: false, message: 'Window is unavailable' };
  }

  if (!force && hasUnsavedInput()) {
    const confirmed = window.confirm(
      'New update available. You have unsaved changes in an open form. Updating now will reload the page and unsaved edits will be lost. Save your work and update now, or continue editing?\n\nPress OK to reload now, or Cancel to finish and save your work first.'
    );
    if (!confirmed) {
      return {
        success: false,
        message: 'Update postponed. Please save your work and click Update Now when ready.',
      };
    }
  }

  // Record pending reload state to prevent loop if running bundle takes a moment to reload
  if (cachedCheckResult?.hasUpdate) {
    setPendingUpdateReload(cachedCheckResult.latestVersion, cachedCheckResult.buildId);
  }

  // Attempt PWA service worker SKIP_WAITING and controller-driven reload
  const applied = await applyPwaUpdate(true);
  if (applied) {
    return { success: true, message: 'Updating application and refreshing...' };
  }

  // Guaranteed fallback reload
  try {
    window.location.reload();
  } catch {
    window.location.assign(window.location.href);
  }
  return { success: true, message: 'Reloading application...' };
}

/**
 * Initiates the update download and installation process across any active platform.
 */
export async function executeAppUpdate(
  downloadUrl?: string,
  options?: {
    expectedSha256?: string;
    expectedSizeBytes?: number;
    onProgress?: (progress: DownloadProgress) => void;
    force?: boolean;
  }
): Promise<{ success: boolean; message: string }> {
  const runtime = getRuntimeEnvironment();
  const url =
    downloadUrl ||
    (runtime === 'electron'
      ? OFFICIAL_DISTRIBUTION.downloads.windows.latestUrl
      : OFFICIAL_DISTRIBUTION.downloads.android.latestUrl);

  if (runtime === 'electron') {
    const electronApi = (window as unknown as { electronAPI?: { startUpdate?: (url: string) => Promise<{ success: boolean; message?: string }> } }).electronAPI;
    if (electronApi && typeof electronApi.startUpdate === 'function') {
      try {
        const res = await electronApi.startUpdate(url);
        return {
          success: res.success,
          message: res.message || 'Daily Fresh ERP update installer launched. Please close this app to complete updating.',
        };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return { success: false, message: `Update failed to launch: ${errMsg}` };
      }
    }

    // Fallback: open in browser
    window.open(url, '_blank');
    return {
      success: true,
      message: 'Downloading installer in browser. Please run DailyFresh-Setup.exe to complete updating.',
    };
  }

  if (runtime === 'capacitor') {
    let progressListenerHandle: { remove: () => Promise<void> } | undefined;
    if (options?.onProgress) {
      try {
        progressListenerHandle = await NativeAppUpdate.addListener('downloadProgress', options.onProgress);
      } catch (err) {
        console.warn('[AppUpdateService] Failed to attach progress listener:', err);
      }
    }

    try {
      const res = await NativeAppUpdate.downloadAndInstallApk({
        downloadUrl: url,
        expectedSha256: options?.expectedSha256,
        expectedSizeBytes: options?.expectedSizeBytes,
      });
      return {
        success: res.success,
        message: res.message,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Android update failed: ${errMsg}`,
      };
    } finally {
      if (progressListenerHandle) {
        progressListenerHandle.remove().catch(() => {});
      }
    }
  }

  // Web & PWA standalone runtime
  return executeSafeWebReload(options?.force ?? false);
}

export async function canRequestAndroidInstalls(): Promise<boolean> {
  const runtime = getRuntimeEnvironment();
  if (runtime !== 'capacitor') return true;
  try {
    const res = await NativeAppUpdate.canRequestPackageInstalls();
    return res.canInstall;
  } catch {
    return true;
  }
}

export async function openAndroidInstallSettings(): Promise<void> {
  const runtime = getRuntimeEnvironment();
  if (runtime !== 'capacitor') return;
  try {
    await NativeAppUpdate.openInstallPermissionSettings();
  } catch (err) {
    console.warn('[AppUpdateService] Failed to open install settings:', err);
  }
}

export async function cancelAndroidUpdateDownload(): Promise<void> {
  const runtime = getRuntimeEnvironment();
  if (runtime !== 'capacitor') return;
  try {
    await NativeAppUpdate.cancelDownload();
  } catch (err) {
    console.warn('[AppUpdateService] Failed to cancel download:', err);
  }
}

/**
 * Initializes proactive update check lifecycle for the web application:
 * 1. App startup check after a gentle 2.5s delay
 * 2. Active tab return (visibilitychange to visible and focus event) with 5-minute cooldown
 * 3. Periodic check every 20 minutes
 * 4. Device reconnection to internet
 */
let lifecycleInitialized = false;

export function initAppUpdateLifecycle(): () => void {
  if (typeof window === 'undefined' || lifecycleInitialized) {
    return () => {};
  }
  lifecycleInitialized = true;

  let lastCheckTimestamp = 0;
  const MIN_FOREGROUND_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes cooldown

  const triggerThrottledCheck = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const now = Date.now();
    if (now - lastCheckTimestamp >= MIN_FOREGROUND_CHECK_INTERVAL) {
      lastCheckTimestamp = now;
      checkForAppUpdate().catch(() => {});
    }
  };

  // 1. Initial check shortly after app startup
  const startupTimer = setTimeout(() => {
    triggerThrottledCheck();
  }, 2500);

  // 2. Active tab return
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      triggerThrottledCheck();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', triggerThrottledCheck);

  // 3. Periodic background check every 20 minutes
  const intervalId = setInterval(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    checkForAppUpdate().catch(() => {});
  }, 20 * 60 * 1000);

  // 4. Device online event
  const onOnline = () => {
    triggerThrottledCheck();
  };
  window.addEventListener('online', onOnline);

  return () => {
    clearTimeout(startupTimer);
    clearInterval(intervalId);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', triggerThrottledCheck);
    window.removeEventListener('online', onOnline);
    lifecycleInitialized = false;
  };
}
