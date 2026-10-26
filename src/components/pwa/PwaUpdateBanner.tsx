import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, X, Sparkles, AlertTriangle } from 'lucide-react';
import {
  subscribeToAppUpdates,
  executeSafeWebReload,
  isUpdateDismissedForVersion,
  setDismissedUpdateVersion,
  type UpdateCheckResult,
} from '../../services/appUpdateService';
import { subscribeToPwaUpdates, getIsUpdateReady } from '../../lib/pwaUpdate';
import { getRuntimeEnvironment } from '../../config/distribution';
import { hasUnsavedInput } from '../../lib/lazyRetry';
import { toast } from 'sonner';

export default function PwaUpdateBanner() {
  const runtime = getRuntimeEnvironment();
  const isNative = runtime === 'capacitor' || runtime === 'electron';

  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [swReady, setSwReady] = useState(getIsUpdateReady());
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);

  useEffect(() => {
    if (isNative) return;

    // 1. Subscribe to app update service events
    const unsubApp = subscribeToAppUpdates((res) => {
      setUpdateInfo(res);
    });

    // 2. Subscribe to service worker registration updates
    const unsubPwa = subscribeToPwaUpdates(() => {
      setSwReady(getIsUpdateReady());
    });

    return () => {
      unsubApp();
      unsubPwa();
    };
  }, [isNative]);

  const targetVersion = updateInfo?.latestVersion || (swReady ? 'latest' : null);
  const hasUpdate = (updateInfo?.hasUpdate || swReady) && Boolean(targetVersion);

  // Check if this version was already dismissed by the user in this session
  const isDismissed =
    Boolean(targetVersion && isUpdateDismissedForVersion(targetVersion)) ||
    (targetVersion !== null && dismissedVersion === targetVersion);

  const handleDismiss = useCallback(() => {
    if (targetVersion) {
      setDismissedUpdateVersion(targetVersion);
      setDismissedVersion(targetVersion);
    }
  }, [targetVersion]);

  const handleUpdateClick = async (force = false) => {
    if (!force && hasUnsavedInput()) {
      setShowUnsavedWarning(true);
      return;
    }

    setIsUpdating(true);
    setShowUnsavedWarning(false);
    try {
      const res = await executeSafeWebReload(force);
      if (!res.success) {
        setIsUpdating(false);
        toast.info(res.message);
      }
    } catch {
      setIsUpdating(false);
    }
  };

  if (isNative || !hasUpdate || isDismissed) {
    return null;
  }

  return (
    <aside
      aria-label="Application update available"
      className="fixed bottom-20 md:bottom-6 right-4 left-4 sm:left-auto sm:right-6 sm:max-w-md z-50 animate-in slide-in-from-bottom-4 fade-in duration-300"
      id="app-update-notification-banner"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-2xl border border-red-200 dark:border-red-900/60 ring-1 ring-black/5 dark:ring-white/10 space-y-3">
        {/* Main Alert Card */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 border border-red-100 dark:border-red-900/40">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h4 className="text-xs font-black uppercase tracking-wider text-red-600 dark:text-red-400">
                  Update Available
                </h4>
                {updateInfo?.latestVersion && (
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300">
                    v{updateInfo.latestVersion}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleDismiss}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 -mr-1 rounded-lg transition-colors cursor-pointer"
                title="Dismiss for now"
                aria-label="Dismiss update notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-gray-800 dark:text-gray-200 font-medium mt-1 leading-relaxed">
              New update available. Save your work and update now.
            </p>

            {updateInfo?.releaseNotes && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 leading-snug">
                {updateInfo.releaseNotes}
              </p>
            )}

            {/* Unsaved Changes Inline Warning */}
            {showUnsavedWarning && (
              <div className="mt-2.5 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900/60 text-amber-950 dark:text-amber-200 text-[11px] space-y-2 animate-in fade-in duration-200">
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="leading-snug">
                    <strong>Unsaved data detected:</strong> You have text or numbers in an open form. Updating will refresh the page.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleUpdateClick(true)}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-white bg-amber-600 hover:bg-amber-700 transition-colors cursor-pointer"
                  >
                    Discard & Update Now
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowUnsavedWarning(false)}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors cursor-pointer"
                  >
                    Keep Editing
                  </button>
                </div>
              </div>
            )}

            {!showUnsavedWarning && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleUpdateClick(false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 transition-colors shadow-sm disabled:opacity-60 cursor-pointer"
                  id="app-update-now-button"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
                  <span>{isUpdating ? 'Updating...' : 'Update now'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDismiss}
                  className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                >
                  Later
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
