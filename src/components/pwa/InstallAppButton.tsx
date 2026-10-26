import React from 'react';
import { Download, CheckCircle2, Smartphone, Monitor } from 'lucide-react';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import InstallInstructionsModal from './InstallInstructionsModal';
import { cn } from '../../lib/utils';

import { toast } from 'sonner';
import { isInstalledAppRuntime } from '../../config/distribution';

interface InstallAppButtonProps {
  variant?: 'header' | 'login-corner' | 'login-banner' | 'sidebar';
  className?: string;
}

export default function InstallAppButton({
  variant = 'header',
  className,
}: InstallAppButtonProps) {
  const {
    isStandalone,
    isInstalled,
    hasNativePrompt,
    isInAppBrowser,
    platform,
    showInstructions,
    setShowInstructions,
    triggerInstall,
  } = usePwaInstall();

  // If already running inside installed standalone PWA, Windows desktop app, or Android app, NEVER show install action
  if (isStandalone || isInstalled || isInstalledAppRuntime()) {
    return null;
  }

  // Label based on detected platform
  const platformLabel =
    platform === 'android' ? 'Android' :
    platform === 'windows' ? 'Windows' :
    platform === 'ios' ? 'iPhone / iPad' :
    platform === 'macos' ? 'Mac' :
    'Device';

  const platformBadge =
    platform === 'ios' ? 'iPhone & iPad' :
    platform === 'android' ? 'Android APK' :
    platform === 'windows' ? 'Windows PC' :
    platform === 'macos' ? 'macOS' :
    'Mobile & PC';

  const handleClick = async () => {
    const outcome = await triggerInstall();
    if (outcome === 'download-started') {
      if (platform === 'windows') {
        toast.info('Downloading DailyFresh-Setup.exe (108.5 MB)', {
          description: 'Run the setup installer once downloaded to complete installation. (Note: Downloading is not installing).',
          duration: 7000,
        });
      } else if (platform === 'android') {
        toast.info('Downloading DailyFresh.apk (16.1 MB)', {
          description: 'Tap Open on the downloaded file in your notification bar to complete installation. (Note: Downloading is not installing).',
          duration: 7000,
        });
      }
    }
  };

  return (
    <>
      {/* ─── VARIANT: HEADER (Main application header bar) ─── */}
      {variant === 'header' && (
        <button
          type="button"
          onClick={handleClick}
          title={`Install Daily Fresh App (${platformLabel})`}
          aria-label={`Install Daily Fresh App on ${platformLabel}`}
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200',
            'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300',
            'border border-red-200/70 dark:border-red-900/50 shadow-2xs',
            'hover:bg-red-100/80 dark:hover:bg-red-900/50 hover:scale-[1.02] active:scale-[0.98]',
            className
          )}
        >
          <Download className="w-3.5 h-3.5 text-current shrink-0" />
          <span className="hidden sm:inline">Install App</span>
          <span className="sm:hidden">Install</span>
        </button>
      )}

      {/* ─── VARIANT: LOGIN-CORNER (Top right on Login page) ─── */}
      {variant === 'login-corner' && (
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            'inline-flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-bold transition-all duration-200 backdrop-blur-md',
            'bg-white/90 dark:bg-gray-900/90 text-gray-800 dark:text-gray-200',
            'border border-gray-200/80 dark:border-gray-800 shadow-sm',
            'hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-300 hover:border-red-200 dark:hover:border-red-800',
            className
          )}
        >
          <Download className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
          <span>Install App</span>
        </button>
      )}

      {/* ─── VARIANT: LOGIN-BANNER (Prominent banner below login form) ─── */}
      {variant === 'login-banner' && (
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            'w-full flex items-center justify-between p-3.5 rounded-2xl transition-all duration-200 group text-left',
            'bg-red-50/70 dark:bg-red-950/30 text-red-900 dark:text-red-200',
            'border border-red-200/70 dark:border-red-900/50 shadow-2xs',
            'hover:bg-red-100/80 dark:hover:bg-red-900/40 hover:border-red-300 dark:hover:border-red-800',
            className
          )}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0 shadow-sm group-hover:scale-105 transition-transform">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold leading-tight flex items-center gap-1.5">
                Install Daily Fresh App
                <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-red-200/60 dark:bg-red-800/60 font-semibold text-red-800 dark:text-red-200">
                  {platformBadge}
                </span>
              </p>
              <p className="text-[11px] text-red-700 dark:text-red-400 font-medium mt-0.5">
                Fast standalone launch from your home screen or desktop
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-red-700 dark:text-red-400 underline underline-offset-2 shrink-0 ml-2">
            Install &rarr;
          </span>
        </button>
      )}

      {/* ─── VARIANT: SIDEBAR (Sidebar drawer footer) ─── */}
      {variant === 'sidebar' && (
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            'w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-200',
            'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40',
            'hover:bg-red-100 dark:hover:bg-red-900/40 border border-red-200/60 dark:border-red-900/40',
            className
          )}
          title="Install Daily Fresh on your device"
        >
          <Download className="w-4 h-4 shrink-0" />
          <span>Install Daily Fresh</span>
        </button>
      )}

      {/* Fallback Instructions Modal */}
      <InstallInstructionsModal
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
        detectedPlatform={platform}
        hasNativePrompt={hasNativePrompt}
        isInAppBrowser={isInAppBrowser}
        onTriggerNativePrompt={triggerInstall}
      />
    </>
  );
}
