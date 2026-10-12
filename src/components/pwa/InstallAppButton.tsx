import React from 'react';
import { Download, CheckCircle2, Smartphone, Monitor } from 'lucide-react';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import InstallInstructionsModal from './InstallInstructionsModal';
import { cn } from '../../lib/utils';

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
    platform,
    showInstructions,
    setShowInstructions,
    triggerInstall,
  } = usePwaInstall();

  // If already running inside installed standalone PWA, render nothing or installed badge
  if (isStandalone) {
    return null;
  }

  // Label based on detected platform
  const platformLabel =
    platform === 'android' ? 'Android' :
    platform === 'windows' ? 'Windows' :
    platform === 'ios' ? 'iPhone / iPad' :
    'Device';

  const platformBadge =
    platform === 'ios' ? 'iPhone & iPad' :
    platform === 'android' ? 'Android' :
    platform === 'windows' ? 'Windows PC' :
    'Mobile & PC';

  const handleClick = async () => {
    await triggerInstall();
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
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200',
            'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400',
            'border border-emerald-200/80 dark:border-emerald-800/60 shadow-xs',
            'hover:bg-emerald-100/90 dark:hover:bg-emerald-900/50 hover:scale-[1.02] active:scale-[0.98]',
            className
          )}
        >
          <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
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
            'hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-700 dark:hover:text-emerald-300 hover:border-emerald-200 dark:hover:border-emerald-800',
            className
          )}
        >
          <Download className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
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
            'bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200',
            'border border-emerald-200/70 dark:border-emerald-800/60 shadow-xs',
            'hover:bg-emerald-100/80 dark:hover:bg-emerald-900/40 hover:border-emerald-300 dark:hover:border-emerald-700',
            className
          )}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm group-hover:scale-105 transition-transform">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold leading-tight flex items-center gap-1.5">
                Install Daily Fresh App
                <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-emerald-200/60 dark:bg-emerald-800/60 font-semibold text-emerald-800 dark:text-emerald-200">
                  {platformBadge}
                </span>
              </p>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium mt-0.5">
                Launch fast directly from your home screen or desktop
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 underline underline-offset-2 shrink-0 ml-2">
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
            'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40',
            'hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border border-emerald-200/60 dark:border-emerald-800/40',
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
        onTriggerNativePrompt={triggerInstall}
      />
    </>
  );
}
