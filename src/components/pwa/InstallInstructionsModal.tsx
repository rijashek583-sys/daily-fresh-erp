import React, { useState } from 'react';
import {
  X, Smartphone, Monitor, Download, CheckCircle2,
  Share2, ShieldCheck, HelpCircle
} from 'lucide-react';
import { type Platform } from '../../hooks/usePwaInstall';
import { Button } from '../ui';

interface InstallInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  detectedPlatform: Platform;
  hasNativePrompt?: boolean;
  onTriggerNativePrompt?: () => void;
}

export default function InstallInstructionsModal({
  isOpen,
  onClose,
  detectedPlatform,
  hasNativePrompt,
  onTriggerNativePrompt,
}: InstallInstructionsModalProps) {
  // Default tab to detected platform
  const initialTab: 'android' | 'windows' | 'ios' =
    detectedPlatform === 'windows' ? 'windows' :
    detectedPlatform === 'ios' ? 'ios' : 'android';

  const [activeTab, setActiveTab] = useState<'android' | 'windows' | 'ios'>(initialTab);

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
                Fast standalone app for Android & Windows
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
        <div className="px-6 pt-4 border-b border-gray-100 dark:border-gray-800/60 bg-gray-50/30 dark:bg-gray-900/20">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('android')}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all border ${
                activeTab === 'android'
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                  : 'bg-[var(--color-card)] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Android Phone</span>
              {detectedPlatform === 'android' && (
                <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-white/20 font-semibold">Your device</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('windows')}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all border ${
                activeTab === 'windows'
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                  : 'bg-[var(--color-card)] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Windows PC</span>
              {detectedPlatform === 'windows' && (
                <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-white/20 font-semibold">Your device</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ios')}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all border ${
                activeTab === 'ios'
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                  : 'bg-[var(--color-card)] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>iPhone / iOS</span>
              {detectedPlatform === 'ios' && (
                <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-white/20 font-semibold">Your device</span>
              )}
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
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
            <div className="space-y-3">
              <p className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                How to Install on Android (Chrome / Edge)
              </p>
              <ol className="space-y-2.5 text-xs text-[var(--color-text-main)]">
                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <div>
                    <p className="font-bold">Open Daily Fresh in Google Chrome</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Ensure you are viewing this page in Google Chrome or Microsoft Edge on your Android phone.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <div>
                    <p className="font-bold">Tap the Browser Menu (⋮)</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Tap the three vertical dots located in the top-right corner of Chrome.
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
                      Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong> if shown).
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
            </div>
          )}

          {/* Windows Step-by-Step */}
          {activeTab === 'windows' && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                How to Install on Windows PC (Chrome / Edge)
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

          {/* iOS Step-by-Step */}
          {activeTab === 'ios' && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
                How to Install on iPhone / iPad (Safari)
              </p>
              <ol className="space-y-2.5 text-xs text-[var(--color-text-main)]">
                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <div>
                    <p className="font-bold">Open Daily Fresh in Safari</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      On iOS devices, Progressive Web Apps must be added via Apple Safari.
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
                      Tap the <strong>Share</strong> icon (square with an upward arrow) at the bottom of Safari.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0">
                    3
                  </span>
                  <div>
                    <p className="font-bold">Tap &ldquo;Add to Home Screen&rdquo;</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Scroll down in the share sheet and select <strong>Add to Home Screen</strong>.
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
                      Tap <strong>Add</strong> in the top-right corner to place Daily Fresh on your home screen.
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
