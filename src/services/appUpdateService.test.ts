import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('virtual:pwa-register', () => ({
  registerSW: vi.fn(),
}));

import {
  compareSemver,
  getDismissedUpdateVersion,
  setDismissedUpdateVersion,
  isUpdateDismissedForVersion,
  clearDismissedUpdateVersion,
  getPendingUpdateReload,
  setPendingUpdateReload,
  clearPendingUpdateReload,
  checkForAppUpdate,
  executeSafeWebReload,
} from './appUpdateService';
import * as lazyRetry from '../lib/lazyRetry';
import * as pwaUpdate from '../lib/pwaUpdate';
import { OFFICIAL_DISTRIBUTION } from '../config/distribution';
import { isFeatureEnabled } from '../config/features';

describe('Application Version & Update System', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockStorage = {};
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => { mockStorage[k] = v; },
      removeItem: (k: string) => { delete mockStorage[k]; },
      clear: () => { mockStorage = {}; },
    });
    clearDismissedUpdateVersion();
    clearPendingUpdateReload();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearDismissedUpdateVersion();
    clearPendingUpdateReload();
  });

  // ── 1. Semver Comparison ──────────────────────────────────────────────────
  describe('compareSemver', () => {
    it('correctly compares major versions', () => {
      expect(compareSemver('2.0.0', '1.0.9')).toBe(1);
      expect(compareSemver('1.0.9', '2.0.0')).toBe(-1);
    });

    it('correctly compares minor versions', () => {
      expect(compareSemver('1.1.0', '1.0.9')).toBe(1);
      expect(compareSemver('1.0.9', '1.1.0')).toBe(-1);
    });

    it('correctly compares patch versions (multi-digit integers)', () => {
      expect(compareSemver('1.0.10', '1.0.9')).toBe(1);
      expect(compareSemver('1.0.9', '1.0.10')).toBe(-1);
      expect(compareSemver('1.0.9', '1.0.9')).toBe(0);
    });

    it('gracefully handles "v" prefixes and varying segment lengths', () => {
      expect(compareSemver('v1.0.10', '1.0.9')).toBe(1);
      expect(compareSemver('v1.0.9', 'v1.0.9')).toBe(0);
      expect(compareSemver('1.0', '1.0.0')).toBe(0);
      expect(compareSemver('1.0.1', '1.0')).toBe(1);
    });

    it('handles empty or malformed strings without throwing', () => {
      expect(compareSemver('', '')).toBe(0);
      expect(compareSemver('1.0.0', '')).toBe(1);
      expect(compareSemver('abc', '1.0.0')).toBe(-1);
    });
  });

  // ── 2. Dismissal Memory (Suppress Repeat Notifications) ───────────────────
  describe('Notification Dismissal Memory', () => {
    beforeEach(() => {
      mockStorage = {};
      clearDismissedUpdateVersion();
      clearPendingUpdateReload();
    });

    it('records dismissed version and prevents repeat notifications for that version', () => {
      expect(getDismissedUpdateVersion()).toBeNull();
      expect(isUpdateDismissedForVersion('1.0.10')).toBe(false);

      setDismissedUpdateVersion('1.0.10');

      expect(getDismissedUpdateVersion()).toBe('1.0.10');
      expect(isUpdateDismissedForVersion('1.0.10')).toBe(true);
    });

    it('does NOT suppress notifications when a newer version arrives', () => {
      setDismissedUpdateVersion('1.0.10');

      // 1.0.10 is dismissed
      expect(isUpdateDismissedForVersion('1.0.10')).toBe(true);
      // But 1.0.11 is NOT dismissed
      expect(isUpdateDismissedForVersion('1.0.11')).toBe(false);
    });

    it('clears dismissed record properly', () => {
      setDismissedUpdateVersion('1.0.10');
      expect(isUpdateDismissedForVersion('1.0.10')).toBe(true);

      clearDismissedUpdateVersion();
      expect(isUpdateDismissedForVersion('1.0.10')).toBe(false);
    });
  });

  // ── 3. Manifest Request Handling & Detection ──────────────────────────────
  describe('checkForAppUpdate Manifest Handling', () => {
    it('detects a newer version from the remote manifest', async () => {
      const newerVersion = '1.0.13';
      const mockManifest = {
        version: newerVersion,
        buildId: `v${newerVersion}-20261027-r1`,
        name: 'Daily Fresh ERP',
        releaseDate: '2026-10-27T10:00:00.000Z',
        releaseNotes: 'Performance improvements and bug fixes',
        platforms: {
          web: {
            version: newerVersion,
            canonicalUrl: 'https://daily-fresh-billing-system.web.app',
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockManifest,
      }));

      const res = await checkForAppUpdate();
      expect(res.hasUpdate).toBe(true);
      expect(res.latestVersion).toBe(newerVersion);
      expect(res.currentVersion).toBe(OFFICIAL_DISTRIBUTION.version);
      expect(res.releaseNotes).toBe(mockManifest.releaseNotes);
      expect(res.error).toBeUndefined();
    });

    it('reports no update when manifest version matches current version', async () => {
      const mockManifest = {
        version: OFFICIAL_DISTRIBUTION.version,
        buildId: OFFICIAL_DISTRIBUTION.buildId,
        name: 'Daily Fresh ERP',
        releaseDate: '2026-10-24T10:00:00.000Z',
        platforms: {
          web: {
            version: OFFICIAL_DISTRIBUTION.version,
            buildId: OFFICIAL_DISTRIBUTION.buildId,
            canonicalUrl: 'https://daily-fresh-billing-system.web.app',
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockManifest,
      }));

      // Ensure mock PWA service worker does not have pending update
      vi.spyOn(pwaUpdate, 'checkForPwaServiceWorkerUpdate').mockResolvedValue(false);

      const res = await checkForAppUpdate();
      expect(res.hasUpdate).toBe(false);
      expect(res.latestVersion).toBe(OFFICIAL_DISTRIBUTION.version);
    });

    it('propagates remote feature overrides from the version manifest', async () => {
      const mockManifest = {
        version: OFFICIAL_DISTRIBUTION.version,
        name: 'Daily Fresh ERP',
        releaseDate: '2026-10-24T10:00:00.000Z',
        features: {
          bulk_ordering: false, // Emergency remote kill switch test
        },
        platforms: {
          web: { version: OFFICIAL_DISTRIBUTION.version },
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockManifest,
      }));

      expect(isFeatureEnabled('bulk_ordering')).toBe(true);
      await checkForAppUpdate();
      expect(isFeatureEnabled('bulk_ordering')).toBe(false);
    });

    it('handles network failure (HTTP 500) gracefully without crashing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      }));

      const res = await checkForAppUpdate();
      expect(res.hasUpdate).toBe(false);
      expect(res.error).toContain('HTTP 500');
    });

    it('handles offline state cleanly without network requests', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const res = await checkForAppUpdate();
      expect(res.hasUpdate).toBe(false);
      expect(res.error).toContain('offline');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ── 4. Unsaved Work Protection & Safe Reload ──────────────────────────────
  describe('Safe Reload with Unsaved Input Protection', () => {
    beforeEach(() => {
      vi.stubGlobal('window', {
        location: { reload: vi.fn(), assign: vi.fn(), href: 'http://localhost/' },
        confirm: vi.fn(),
      });
    });

    it('blocks reload and postpones update if unsaved form data exists and user cancels', async () => {
      vi.spyOn(lazyRetry, 'hasUnsavedInput').mockReturnValue(true);
      vi.spyOn(window, 'confirm').mockReturnValue(false); // User clicks Cancel

      const result = await executeSafeWebReload(false);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Update postponed');
      expect(window.location.reload).not.toHaveBeenCalled();
    });

    it('proceeds with reload when user explicitly confirms despite unsaved data', async () => {
      vi.spyOn(lazyRetry, 'hasUnsavedInput').mockReturnValue(true);
      vi.spyOn(window, 'confirm').mockReturnValue(true); // User clicks OK
      vi.spyOn(pwaUpdate, 'applyPwaUpdate').mockResolvedValue(true);

      const result = await executeSafeWebReload(false);

      expect(result.success).toBe(true);
      expect(pwaUpdate.applyPwaUpdate).toHaveBeenCalledWith(true);
    });

    it('immediately proceeds without confirmation prompt when form is clean', async () => {
      vi.spyOn(lazyRetry, 'hasUnsavedInput').mockReturnValue(false);
      const confirmSpy = vi.spyOn(window, 'confirm');
      vi.spyOn(pwaUpdate, 'applyPwaUpdate').mockResolvedValue(true);

      const result = await executeSafeWebReload(false);

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(pwaUpdate.applyPwaUpdate).toHaveBeenCalledWith(true);
    });
  });

  // ── 5. Regression Tests: Popup Loop Prevention & State Transitions ───────
  describe('Update Popup Loop Prevention & Reload State Transitions', () => {
    beforeEach(() => {
      mockStorage = {};
      clearDismissedUpdateVersion();
      clearPendingUpdateReload();
      vi.stubGlobal('window', {
        location: { reload: vi.fn(), assign: vi.fn(), href: 'http://localhost/' },
        confirm: vi.fn(),
      });
    });

    it('reports no update when running version and buildId match manifest', async () => {
      const mockManifest = {
        version: OFFICIAL_DISTRIBUTION.version,
        buildId: OFFICIAL_DISTRIBUTION.buildId,
        name: 'Daily Fresh ERP',
        releaseDate: '2026-10-24T10:00:00.000Z',
        platforms: {
          web: {
            version: OFFICIAL_DISTRIBUTION.version,
            buildId: OFFICIAL_DISTRIBUTION.buildId,
            canonicalUrl: 'https://daily-fresh-billing-system.web.app',
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockManifest,
      }));
      vi.spyOn(pwaUpdate, 'checkForPwaServiceWorkerUpdate').mockResolvedValue(false);

      const res = await checkForAppUpdate();
      expect(res.hasUpdate).toBe(false);
      expect(res.latestVersion).toBe(OFFICIAL_DISTRIBUTION.version);
    });

    it('triggers update when service worker has a waiting update', async () => {
      const mockManifest = {
        version: OFFICIAL_DISTRIBUTION.version,
        buildId: OFFICIAL_DISTRIBUTION.buildId,
        name: 'Daily Fresh ERP',
        releaseDate: '2026-10-24T10:00:00.000Z',
        platforms: {
          web: {
            version: OFFICIAL_DISTRIBUTION.version,
            buildId: OFFICIAL_DISTRIBUTION.buildId,
            canonicalUrl: 'https://daily-fresh-billing-system.web.app',
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockManifest,
      }));
      vi.spyOn(pwaUpdate, 'checkForPwaServiceWorkerUpdate').mockResolvedValue(true);

      const res = await checkForAppUpdate();
      expect(res.hasUpdate).toBe(true);
    });

    it('suppresses immediate repeat popup if user recently clicked update reload for this version', async () => {
      const mockManifest = {
        version: '1.0.10',
        buildId: 'v1.0.10-20261025-r1',
        name: 'Daily Fresh ERP',
        releaseDate: '2026-10-25T10:00:00.000Z',
        platforms: {
          web: {
            version: '1.0.10',
            buildId: 'v1.0.10-20261025-r1',
            canonicalUrl: 'https://daily-fresh-billing-system.web.app',
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockManifest,
      }));
      vi.spyOn(pwaUpdate, 'checkForPwaServiceWorkerUpdate').mockResolvedValue(false);

      // Simulate that user just initiated update reload for 1.0.10
      setPendingUpdateReload('1.0.10', 'v1.0.10-20261025-r1');

      const res = await checkForAppUpdate();
      expect(res.hasUpdate).toBe(false); // Suppressed to avoid endless loop
    });

    it('records pending reload info when executeSafeWebReload is executed', async () => {
      const newerVersion = '1.0.13';
      const newerBuildId = `v${newerVersion}-20261027-r1`;
      const mockManifest = {
        version: newerVersion,
        buildId: newerBuildId,
        name: 'Daily Fresh ERP',
        releaseDate: '2026-10-27T10:00:00.000Z',
        platforms: {
          web: {
            version: newerVersion,
            buildId: newerBuildId,
            canonicalUrl: 'https://daily-fresh-billing-system.web.app',
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockManifest,
      }));
      vi.spyOn(pwaUpdate, 'checkForPwaServiceWorkerUpdate').mockResolvedValue(false);
      vi.spyOn(lazyRetry, 'hasUnsavedInput').mockReturnValue(false);
      vi.spyOn(pwaUpdate, 'applyPwaUpdate').mockResolvedValue(true);

      // Check for update first so cachedCheckResult is populated
      await checkForAppUpdate();

      await executeSafeWebReload(false);

      const pending = getPendingUpdateReload();
      expect(pending).not.toBeNull();
      expect(pending?.targetVersion).toBe(newerVersion);
      expect(pending?.targetBuildId).toBe(newerBuildId);
    });

    it('clears pending reload suppression once running build matches target', async () => {
      // Simulate pending reload was for current version and current build
      setPendingUpdateReload(OFFICIAL_DISTRIBUTION.version, OFFICIAL_DISTRIBUTION.buildId);

      const mockManifest = {
        version: OFFICIAL_DISTRIBUTION.version,
        buildId: OFFICIAL_DISTRIBUTION.buildId,
        name: 'Daily Fresh ERP',
        releaseDate: '2026-10-24T10:00:00.000Z',
        platforms: {
          web: {
            version: OFFICIAL_DISTRIBUTION.version,
            buildId: OFFICIAL_DISTRIBUTION.buildId,
            canonicalUrl: 'https://daily-fresh-billing-system.web.app',
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockManifest,
      }));
      vi.spyOn(pwaUpdate, 'checkForPwaServiceWorkerUpdate').mockResolvedValue(false);

      await checkForAppUpdate();

      expect(getPendingUpdateReload()).toBeNull();
    });
  });
});
