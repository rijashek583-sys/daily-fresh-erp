import React, { useState } from 'react';
import {
  X, Smartphone, Monitor, Download, CheckCircle2,
  Share2, ShieldCheck, Laptop, AlertTriangle, Info, ExternalLink
} from 'lucide-react';
import { type Platform } from '../../hooks/usePwaInstall';
import { OFFICIAL_DISTRIBUTION } from '../../config/distribution';
import { Button } from '../ui';
import { toast } from 'sonner';

interface InstallInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  detectedPlatform: Platform;
  hasNativePrompt?: boolean;
  isInAppBrowser?: boolean;
  onTriggerNativePrompt?: () => void;
}

export default function InstallInstructionsModal({
  isOpen,
  onClose,
  detectedPlatform,
  hasNativePrompt,
  isInAppBrowser,
  onTriggerNativePrompt,
}: InstallInstructionsModalProps) {
  // Default tab to detected platform
  const initialTab: 'android' | 'ios' | 'windows' | 'macos' =
    detectedPlatform === 'ios' ? 'ios' :
    detectedPlatform === 'windows' ? 'windows' :
    detectedPlatform === 'macos' ? 'macos' :
    'android';

  const [activeTab, setActiveTab] = useState<'android' | 'ios' | 'windows' | 'macos'>(initialTab);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-card)] rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col border border-gray-100 dark:border-gray-800 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/70 dark:bg-gray-900/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200/60 dark:border-red-900/40 flex items-center justify-center overflow-hidden shrink-0">
              <img
                src="/logo.png"
                alt="Daily Fresh"
                className="w-8 h-8 object-contain"
                onError={(e) => {
                  e.currentTarget.src = 'https://ui-avatars.com/api/?name=DF&color=B91C1C&background=FAFAFA';
                }}
              />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[var(--color-text-main)] leading-tight">
                Install Daily Fresh App
              </h3>
              <p className="text-xs text-[var(--color-text-muted)] font-medium mt-0.5">
                Fast standalone app for Android, iOS, Windows &amp; Mac
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Platform Selector Tabs */}
        <div className="px-6 pt-4 border-b border-gray-100 dark:border-gray-800/60 bg-gray-50/30 dark:bg-gray-900/20 overflow-x-auto no-scrollbar">
          <div className="flex gap-2 min-w-max pb-1">
            <button
              type="button"
              onClick={() => setActiveTab('android')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
                activeTab === 'android'
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                  : 'bg-[var(--color-card)] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 shrink-0" />
              <span>Android</span>
              {detectedPlatform === 'android' && (
                <span className="text-[9px] px-1 py-0.2 rounded-md bg-white/20 font-semibold">You</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ios')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
                activeTab === 'ios'
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                  : 'bg-[var(--color-card)] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Share2 className="w-3.5 h-3.5 shrink-0" />
              <span>iPhone / iPad</span>
              {detectedPlatform === 'ios' && (
                <span className="text-[9px] px-1 py-0.2 rounded-md bg-white/20 font-semibold">You</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('windows')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
                activeTab === 'windows'
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                  : 'bg-[var(--color-card)] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Monitor className="w-3.5 h-3.5 shrink-0" />
              <span>Windows PC</span>
              {detectedPlatform === 'windows' && (
                <span className="text-[9px] px-1 py-0.2 rounded-md bg-white/20 font-semibold">You</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('macos')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
                activeTab === 'macos'
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                  : 'bg-[var(--color-card)] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Laptop className="w-3.5 h-3.5 shrink-0" />
              <span>macOS</span>
              {detectedPlatform === 'macos' && (
                <span className="text-[9px] px-1 py-0.2 rounded-md bg-white/20 font-semibold">You</span>
              )}
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* In-App Browser Warning (e.g. WhatsApp, Instagram, FB) */}
          {isInAppBrowser && (
            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-bold text-amber-950 dark:text-amber-200">
                  In-App Browser Detected (WhatsApp / Instagram / Facebook)
                </p>
                <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5 leading-relaxed">
                  You are viewing Daily Fresh inside an in-app browser. In-app browsers block direct PWA installation. Tap the button below to open directly in Google Chrome.
                </p>
                <div className="mt-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      const cleanUrl = window.location.href.replace(/^https?:\/\//, '');
                      window.location.href = `intent://${cleanUrl}#Intent;scheme=https;package=com.android.chrome;end`;
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in Google Chrome</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Why direct prompt was unavailable banner */}
          {!hasNativePrompt && !isInAppBrowser && (activeTab === 'android' || activeTab === 'windows') && (
            <div className="p-3.5 rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-800/60 flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-blue-950 dark:text-blue-200">
                  {activeTab === 'android'
                    ? 'Direct Installation Note'
                    : 'Windows Direct Prompt Note'}
                </p>
                <p className="text-[11px] text-blue-800 dark:text-blue-300 mt-0.5 leading-relaxed">
                  {activeTab === 'android'
                    ? "If your browser did not display the direct installation dialog, the install option may have already been moved to Chrome's address bar (+) or browser menu (⋮), or your browser does not support web app prompts."
                    : "If Windows Chrome or Edge did not display the direct installation dialog, click the Install App icon on the right side of the URL address bar or use the browser menu (Apps → Install Daily Fresh)."}
                </p>
              </div>
            </div>
          )}

          {/* Quick 1-click Install Prompt Banner if ready */}
          {hasNativePrompt && onTriggerNativePrompt && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
                    Direct installation is available
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    Click to trigger your browser's 1-click install prompt.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onTriggerNativePrompt();
                  onClose();
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 text-xs py-1.5"
              >
                Install Now
              </Button>
            </div>
          )}

          {/* Android Step-by-Step */}
          {activeTab === 'android' && (
            <div className="space-y-4">
              <p className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                Option 1 (Recommended): Install via Android Browser (Chrome / Edge / Samsung Internet)
              </p>
              <ol className="space-y-2.5 text-xs text-[var(--color-text-main)]">
                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <div>
                    <p className="font-bold">Open Daily Fresh in Google Chrome</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Ensure you are viewing the page in Google Chrome or Microsoft Edge on your Android phone.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <div>
                    <p className="font-bold">Tap the Address Bar (+) or Browser Menu (⋮)</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Look for the <strong>Install (+)</strong> button directly in Chrome&apos;s top address bar (next to tabs), or tap the three vertical dots (⋮) in the top-right corner.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    3
                  </span>
                  <div>
                    <p className="font-bold">Select &ldquo;Install app&rdquo; or &ldquo;Add to Home screen&rdquo;</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong> if shown in the menu).
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    4
                  </span>
                  <div>
                    <p className="font-bold">Confirm &ldquo;Install&rdquo;</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Daily Fresh will be installed directly to your phone screen with its dedicated app icon and full-screen view.
                    </p>
                  </div>
                </li>
              </ol>

              {/* Direct APK Download Alternative Card */}
              <p className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider pt-2">
                Option 2: Standalone Signed Android APK
              </p>
              <div className="p-4 rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold text-gray-900 dark:text-white">
                      Official Android Package (APK)
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-red-700 dark:text-red-300">
                    {OFFICIAL_DISTRIBUTION.downloads.android.fileSize}
                  </span>
                </div>
                <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
                  Download the signed release APK for manual installation on your Android device without Google Play.
                </p>
                <div className="pt-1">
                  <a
                    href={OFFICIAL_DISTRIBUTION.downloads.android.latestUrl}
                    download={OFFICIAL_DISTRIBUTION.downloads.android.fileName}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      toast.info('Downloading DailyFresh.apk', {
                        description: 'Tap Open on the downloaded file in your notification bar to complete installation. (Note: Downloading is not installing).',
                        duration: 8000,
                      });
                    }}
                    className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-red-600 hover:bg-red-700 shadow-md shadow-red-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-center"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download DailyFresh.apk</span>
                  </a>
                </div>
                <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium leading-tight">
                  Note: Downloading the file does not mean the app is installed. You must tap &ldquo;Open&rdquo; in notifications to complete installation.
                </p>
              </div>
            </div>
          )}

          {/* Windows Step-by-Step */}
          {activeTab === 'windows' && (
            <div className="space-y-4">
              {/* Direct Windows Setup Download Card */}
              <div className="p-4 rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold text-gray-900 dark:text-white">
                      Official Windows Desktop Installer
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-red-700 dark:text-red-300">
                    {OFFICIAL_DISTRIBUTION.downloads.windows.fileSize}
                  </span>
                </div>
                <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
                  Download the official 64-bit NSIS setup installer for Windows 10 &amp; 11 PCs.
                </p>
                <div className="pt-1">
                  <a
                    href={OFFICIAL_DISTRIBUTION.downloads.windows.latestUrl}
                    download={OFFICIAL_DISTRIBUTION.downloads.windows.fileName}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      toast.info('Downloading DailyFresh-Setup.exe', {
                        description: 'Run the installer once downloaded to install Daily Fresh ERP on your PC. (Note: Downloading is not installing).',
                        duration: 8000,
                      });
                    }}
                    className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-red-600 hover:bg-red-700 shadow-md shadow-red-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-center"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download DailyFresh-Setup.exe</span>
                  </a>
                </div>
                <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium leading-tight">
                  Note: Downloading the installer does not mean the app is installed. Run the setup file on your PC to complete installation.
                </p>
              </div>

              <p className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                Or Install via Windows Browser (Chrome / Edge)
              </p>
              <ol className="space-y-2.5 text-xs text-[var(--color-text-main)]">
                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <div>
                    <p className="font-bold">Open Daily Fresh in Chrome or Edge</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Use Microsoft Edge or Google Chrome on Windows 10 or 11.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <div>
                    <p className="font-bold">Click the Install Icon in the Address Bar</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Look at the right side of the address bar at the top (next to the star/bookmark icon) for the <strong>Install app</strong> icon.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    3
                  </span>
                  <div>
                    <p className="font-bold">Or use the Browser Menu (… / ⋮)</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      In Edge: click <strong>…</strong> &rarr; <strong>Apps</strong> &rarr; <strong>Install Daily Fresh</strong>.<br />
                      In Chrome: click <strong>⋮</strong> &rarr; <strong>Save and share</strong> &rarr; <strong>Install Daily Fresh</strong>.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    4
                  </span>
                  <div>
                    <p className="font-bold">Launch as Standalone App</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Daily Fresh opens in its own clean desktop window and can be pinned to your Windows Taskbar and Start Menu.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          )}

          {/* iOS / iPadOS Step-by-Step */}
          {activeTab === 'ios' && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                How to Install on iPhone &amp; iPad (Safari)
              </p>
              <ol className="space-y-2.5 text-xs text-[var(--color-text-main)]">
                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <div>
                    <p className="font-bold">Open Daily Fresh in Safari</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      On iOS &amp; iPadOS, standalone apps are added through Apple Safari. If you are in Chrome or another app, tap Share &rarr; <strong>Open in Safari</strong>.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <div>
                    <p className="font-bold">Tap the Share Button</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Tap the <strong>Share</strong> button (square with an upward arrow) located in the <strong>bottom bar</strong> on iPhone, or on the <strong>top-right toolbar</strong> on iPad.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    3
                  </span>
                  <div>
                    <p className="font-bold">Select &ldquo;Add to Home Screen&rdquo;</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Scroll down in the Safari share sheet and tap <strong>Add to Home Screen</strong> (look for the &ldquo;+&rdquo; icon).
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    4
                  </span>
                  <div>
                    <p className="font-bold">Tap &ldquo;Add&rdquo;</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Tap <strong>Add</strong> in the top-right corner. Daily Fresh will appear as an app icon on your home screen and run in clean full-screen standalone mode.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          )}

          {/* macOS Step-by-Step */}
          {activeTab === 'macos' && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                How to Install on macOS (Safari / Chrome / Edge)
              </p>
              <ol className="space-y-2.5 text-xs text-[var(--color-text-main)]">
                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <div>
                    <p className="font-bold">Option A: In Safari (macOS Sonoma 14+)</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Open the app URL in Safari. In the macOS top menu bar, click <strong>File</strong> &rarr; <strong>Add to Dock…</strong>, then click <strong>Add</strong>. Daily Fresh will be pinned to your Mac Dock and Launchpad.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <div>
                    <p className="font-bold">Option B: In Google Chrome or Microsoft Edge</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Click the <strong>Install</strong> icon on the right side of the URL address bar (or click menu <strong>⋮</strong> &rarr; <strong>Save and share</strong> &rarr; <strong>Install Daily Fresh</strong>).
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    3
                  </span>
                  <div>
                    <p className="font-bold">Launch as Dedicated Mac App</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Daily Fresh runs in its own frameless window with independent Command+Tab switching and Mac notifications.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          )}

          {/* Secure PWA note */}
          <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <p>
              Daily Fresh is an installable <strong>Progressive Web App (PWA)</strong>. No APK or EXE file download is required. All billing, orders, and business data synchronize live through your secure account.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end bg-gray-50/40 dark:bg-gray-900/30">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
