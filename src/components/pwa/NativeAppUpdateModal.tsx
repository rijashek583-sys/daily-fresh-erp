import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Download,
  CheckCircle2,
  AlertCircle,
  X,
  ShieldAlert,
  RefreshCw,
  Layers,
} from 'lucide-react';
import {
  subscribeToAppUpdates,
  checkForAppUpdate,
  executeAppUpdate,
  canRequestAndroidInstalls,
  openAndroidInstallSettings,
  cancelAndroidUpdateDownload,
  type UpdateCheckResult,
} from '../../services/appUpdateService';
import { getRuntimeEnvironment, getPlatformDisplayName } from '../../config/distribution';
import { toast } from 'sonner';

export default function NativeAppUpdateModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadedBytes, setDownloadedBytes] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState<boolean>(false);
  const [installerOpened, setInstallerOpened] = useState<boolean>(false);

  const runtime = getRuntimeEnvironment();
  const platformLabel = getPlatformDisplayName();
  const isWindows = runtime === 'electron';
  const isAndroid = runtime === 'capacitor';

  const performCheck = useCallback(async (isManual: boolean) => {
    if (isManual) {
      setIsOpen(true);
      setDismissed(false);
      setIsChecking(true);
      setErrorMessage(null);
      setStatusMessage(null);
      setInstallerOpened(false);
    }

    try {
      const res = await checkForAppUpdate();
      setUpdateInfo(res);
      setIsChecking(false);

      if (res.error) {
        setErrorMessage(res.error);
        if (isManual) {
          setIsOpen(true);
        }
      } else if (res.hasUpdate) {
        setIsOpen(true);
        setDismissed(false);
        if (isManual) {
          toast.success(`Update available: v${res.latestVersion}`);
        }
      } else {
        if (isManual) {
          setIsOpen(true);
          toast.success(`You're up to date (v${res.currentVersion})`);
        } else {
          setIsOpen(false);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setIsChecking(false);
      setErrorMessage(`Check failed: ${msg}`);
      if (isManual) {
        setIsOpen(true);
        toast.error('Unable to check for updates');
      }
    }
  }, []);

  useEffect(() => {
    // Check Android install permission status on native runtime
    if (isAndroid) {
      canRequestAndroidInstalls().then((canInstall) => {
        setNeedsPermission(!canInstall);
      });
    }

    // Subscribe to update events
    const unsubscribe = subscribeToAppUpdates((result) => {
      setUpdateInfo(result);
      if (result.hasUpdate && (isAndroid || isWindows)) {
        setIsOpen(true);
      }
    });

    // Periodic check every 30 minutes in background
    const interval = setInterval(() => {
      performCheck(false);
    }, 30 * 60 * 1000);

    // Listen for manual check trigger from UI or Electron Help menu
    const handleMenuTrigger = () => {
      performCheck(true);
    };

    window.addEventListener('app:trigger-update-check' as any, handleMenuTrigger);
    const electronApi = (window as unknown as { electronAPI?: { onTriggerUpdateCheck?: (cb: () => void) => () => void } }).electronAPI;
    const unsubElectron = electronApi?.onTriggerUpdateCheck?.(handleMenuTrigger);

    return () => {
      unsubscribe();
      clearInterval(interval);
      window.removeEventListener('app:trigger-update-check' as any, handleMenuTrigger);
      unsubElectron?.();
    };
  }, [isAndroid, performCheck]);

  if (!isOpen || dismissed) {
    return null;
  }

  const handleGrantPermission = async () => {
    await openAndroidInstallSettings();
    toast.info('Enable "Allow from this source", then return to Daily Fresh ERP to complete the update.');
    setTimeout(async () => {
      const allowed = await canRequestAndroidInstalls();
      setNeedsPermission(!allowed);
    }, 1500);
  };

  const handleCancelDownload = async () => {
    if (isAndroid) {
      await cancelAndroidUpdateDownload();
    }
    setIsUpdating(false);
    setDownloadProgress(0);
    setStatusMessage('Download cancelled.');
  };

  const handleClose = () => {
    setIsOpen(false);
    setDismissed(true);
    setErrorMessage(null);
  };

  const handleUpdateClick = async () => {
    if (!updateInfo) return;

    // If Android requires install permission first, prompt user
    if (isAndroid) {
      const canInstall = await canRequestAndroidInstalls();
      if (!canInstall) {
        setNeedsPermission(true);
        toast.warning('Permission required', {
          description: 'Please allow "Install unknown apps" in Settings to proceed.',
        });
        return;
      }
    }

    setIsUpdating(true);
    setErrorMessage(null);
    setStatusMessage(
      isAndroid
        ? 'Initiating secure update package download...'
        : isWindows
        ? 'Launching desktop installer...'
        : 'Updating application and refreshing...'
    );
    setDownloadProgress(0);

    try {
      const res = await executeAppUpdate(updateInfo.downloadUrl, {
        expectedSha256: updateInfo.platformInfo?.sha256,
        expectedSizeBytes: updateInfo.platformInfo?.fileSizeBytes,
        onProgress: (p) => {
          setDownloadProgress(p.progress);
          setDownloadedBytes(p.bytesReceived);
          setTotalBytes(p.totalBytes);
          setStatusMessage(`Downloading update (${p.progress}%)...`);
        },
      });

      if (res.success) {
        setStatusMessage(res.message);
        setInstallerOpened(true);
        toast.success('Update action launched', {
          description: res.message,
          duration: 10000,
        });
        if (isAndroid) {
          // On Android, once system installer intent is launched, dismiss modal
          setDismissed(true);
          setIsOpen(false);
        }
      } else {
        setErrorMessage(res.message);
        setStatusMessage(null);
        toast.error('Update notice', {
          description: res.message,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Update error: ${msg}`);
      setStatusMessage(null);
      toast.error('Failed to launch update', { description: msg });
    } finally {
      setIsUpdating(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 MB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div
      role="dialog"
      aria-label="Application update prompt"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-red-200 dark:border-red-900/60 ring-1 ring-black/10 dark:ring-white/10 space-y-4 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 border border-red-100 dark:border-red-900/40">
              {isChecking ? (
                <RefreshCw className="w-6 h-6 animate-spin" />
              ) : errorMessage ? (
                <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
              ) : updateInfo?.hasUpdate ? (
                <Sparkles className="w-6 h-6 animate-pulse" />
              ) : (
                <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              )}
            </div>
            <div>
              <span className="text-[10px] uppercase font-black tracking-widest text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <Layers className="w-3 h-3 inline" />
                {platformLabel}
              </span>
              <h3 className="text-lg font-black text-gray-900 dark:text-white leading-tight">
                {isChecking
                  ? 'Checking for Updates'
                  : errorMessage
                  ? 'Update Check Notice'
                  : updateInfo?.hasUpdate
                  ? `Daily Fresh ERP v${updateInfo.latestVersion}`
                  : "You're Up to Date"}
              </h3>
            </div>
          </div>
          {!isUpdating && (
            <button
              type="button"
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              title="Close"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* State 1: In-Flight Checking Spinner */}
        {isChecking && (
          <div className="py-8 flex flex-col items-center justify-center text-center space-y-3">
            <div className="relative">
              <RefreshCw className="w-10 h-10 text-red-600 dark:text-red-400 animate-spin" />
              <div className="absolute inset-0 blur-lg bg-red-500/20 rounded-full" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">Connecting to Update Server...</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-xs">
                Checking the official release endpoint and verifying latest platform version.
              </p>
            </div>
          </div>
        )}

        {/* State 2: Error with Retry Option */}
        {errorMessage && !isChecking && !isUpdating && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs text-red-900 dark:text-red-200 space-y-2">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Unable to complete update check</p>
                  <p className="text-[11px] text-red-800 dark:text-red-300 mt-0.5 leading-relaxed">
                    {errorMessage}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 py-3 px-4 rounded-2xl text-xs font-bold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => performCheck(true)}
                className="flex-2 py-3 px-4 rounded-2xl text-xs font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg shadow-red-600/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Check</span>
              </button>
            </div>
          </div>
        )}

        {/* State 3: Up To Date Confirmation */}
        {!isChecking && !errorMessage && updateInfo && !updateInfo.hasUpdate && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-emerald-950 dark:text-emerald-200 space-y-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <p className="text-sm font-black text-emerald-900 dark:text-emerald-200">
                  Daily Fresh ERP is Up to Date
                </p>
              </div>
              <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
                You are currently running the latest official release for <strong>{platformLabel}</strong>. No newer version is available.
              </p>
              <div className="pt-2 border-t border-emerald-200/60 dark:border-emerald-800/60 flex items-center justify-between text-xs">
                <span className="text-emerald-800/80 dark:text-emerald-300/80">Installed Version:</span>
                <span className="font-mono font-bold text-emerald-950 dark:text-white">v{updateInfo.currentVersion}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 py-3 px-4 rounded-2xl text-xs font-bold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer"
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => performCheck(true)}
                className="flex-1 py-3 px-4 rounded-2xl text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/40 border border-red-200 dark:border-red-900/40 transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Check Again</span>
              </button>
            </div>
          </div>
        )}

        {/* State 4: Update Available */}
        {!isChecking && !errorMessage && updateInfo && updateInfo.hasUpdate && (
          <div className="space-y-4">
            {/* Version Compare Details */}
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 text-xs">
              <div>
                <p className="text-gray-500 font-medium">Installed Version</p>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-200 mt-0.5 font-mono">
                  v{updateInfo.currentVersion}
                </p>
              </div>
              <div>
                <p className="text-gray-500 font-medium">Available Release</p>
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 font-mono">
                  v{updateInfo.latestVersion}
                </p>
              </div>
              {updateInfo.platformInfo?.fileSizeFormatted && (
                <div className="col-span-2 pt-2 border-t border-gray-200/60 dark:border-gray-700/60 flex items-center justify-between text-gray-500">
                  <span>Package Size:</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-200">
                    {updateInfo.platformInfo.fileSizeFormatted}
                  </span>
                </div>
              )}
            </div>

            {/* Release Notes */}
            {updateInfo.releaseNotes && (
              <div className="space-y-1">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  What&apos;s New:
                </h4>
                <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed bg-gray-50/50 dark:bg-gray-800/20 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800">
                  {updateInfo.releaseNotes}
                </p>
              </div>
            )}

            {/* Android Permission Warning if needed */}
            {isAndroid && needsPermission && (
              <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-950 dark:text-amber-200 space-y-2">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Android Install Permission Required</p>
                    <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5 leading-relaxed">
                      Android requires permission to install updates directly. Tap below to enable <strong>&ldquo;Allow from this source&rdquo;</strong> in Settings, then return to update.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleGrantPermission}
                  className="w-full py-2 px-3 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 active:scale-[0.98] transition-all cursor-pointer"
                >
                  Grant Permission in Settings
                </button>
              </div>
            )}

            {/* Active Download Progress Bar */}
            {isUpdating && (
              <div className="p-3.5 rounded-2xl bg-red-50/60 dark:bg-red-950/30 border border-red-200/80 dark:border-red-900/50 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-red-900 dark:text-red-200">
                    {isAndroid || isWindows ? 'Downloading Update' : 'Applying Update'}
                  </span>
                  {totalBytes > 0 && (
                    <span className="font-mono font-bold text-red-700 dark:text-red-300">
                      {downloadProgress}%
                    </span>
                  )}
                </div>
                {totalBytes > 0 && (
                  <div className="w-full h-2.5 bg-red-200/60 dark:bg-red-900/40 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-600 transition-all duration-200 rounded-full"
                      style={{ width: `${Math.max(5, downloadProgress)}%` }}
                    />
                  </div>
                )}
                <div className="flex items-center justify-between text-[11px] text-red-700 dark:text-red-400 font-medium">
                  <span>
                    {totalBytes > 0
                      ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
                      : statusMessage || 'Updating...'}
                  </span>
                  {isAndroid && isUpdating && (
                    <button
                      type="button"
                      onClick={handleCancelDownload}
                      className="underline hover:text-red-900 dark:hover:text-red-200 cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Status or Success Message */}
            {statusMessage && !isUpdating && (
              <div className="space-y-2">
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/40 text-xs text-emerald-900 dark:text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed font-medium">{statusMessage}</p>
                </div>
                {!isAndroid && !isWindows && (
                  <button
                    type="button"
                    onClick={() => {
                      window.location.reload();
                    }}
                    className="w-full py-2.5 px-3 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-600/20"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Refresh App Now</span>
                  </button>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              {!isUpdating && (
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 py-3 px-4 rounded-2xl text-xs font-bold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                >
                  {installerOpened || statusMessage ? 'Close' : 'Later'}
                </button>
              )}

              <button
                type="button"
                onClick={handleUpdateClick}
                disabled={isUpdating}
                className="flex-2 py-3 px-4 rounded-2xl text-xs font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg shadow-red-600/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {isAndroid || isWindows ? (
                  <Download className="w-4 h-4" />
                ) : (
                  <RefreshCw className={`w-4 h-4 ${isUpdating ? 'animate-spin' : ''}`} />
                )}
                <span>
                  {isUpdating
                    ? isAndroid || isWindows ? 'Downloading...' : 'Updating...'
                    : installerOpened
                    ? 'Re-open Installer'
                    : isAndroid || isWindows
                    ? 'Update Now'
                    : statusMessage
                    ? 'Try Updating Again'
                    : 'Update & Refresh'}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
