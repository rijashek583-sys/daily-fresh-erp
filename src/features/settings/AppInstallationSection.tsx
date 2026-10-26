import React, { useState } from 'react';
import {
  Copy, Share2, Check, Smartphone, Monitor, Laptop,
  Download, CheckCircle2, ShieldCheck, MessageCircle,
  Globe, RefreshCw
} from 'lucide-react';
import { Button } from '../../components/ui';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import {
  OFFICIAL_DISTRIBUTION,
  getRuntimeEnvironment,
  isInstalledAppRuntime,
} from '../../config/distribution';
import { triggerAppUpdateCheck } from '../../services/appUpdateService';
import InstallInstructionsModal from '../../components/pwa/InstallInstructionsModal';
import { toast } from 'sonner';

const CANONICAL_URL = typeof window !== 'undefined' && window.location.origin
  ? window.location.origin
  : 'https://daily-fresh-billing-system.web.app';

export default function AppInstallationSection() {
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

  const [copied, setCopied] = useState(false);
  const [activeGuideTab, setActiveGuideTab] = useState<'android' | 'ios' | 'windows' | 'macos'>(
    platform === 'ios' ? 'ios' :
    platform === 'windows' ? 'windows' :
    platform === 'macos' ? 'macos' :
    'android'
  );

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(CANONICAL_URL);
      setCopied(true);
      toast.success('App link copied to clipboard!', {
        description: CANONICAL_URL,
      });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('Failed to copy link to clipboard');
    }
  };

  const handleShareLink = async () => {
    const shareData = {
      title: 'Daily Fresh ERP',
      text: 'Daily Fresh ERP — Food production operations & billing platform.',
      url: CANONICAL_URL,
    };

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(shareData);
        toast.success('App link shared successfully');
        return;
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'AbortError') {
          return;
        }
      }
    }

    // Fallback: Copy link
    await handleCopyLink();
  };

  const handleWhatsAppShare = () => {
    const text = encodeURIComponent(
      `Daily Fresh ERP: Access the system and install the app on your device here:\n${CANONICAL_URL}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-lg font-bold text-[var(--color-text-main)]">
            App Installation &amp; Sharing
          </h3>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-semibold uppercase tracking-wider">
            All Users
          </span>
        </div>
        <p className="text-sm font-medium text-[var(--color-text-muted)]">
          Distribute and install Daily Fresh ERP across mobile phones, tablets, and desktop computers.
        </p>
      </div>

      {/* Current Device Installation Status */}
      {(() => {
        const runtime = getRuntimeEnvironment();
        const isInstalledApp = isInstalledAppRuntime() || isStandalone || isInstalled;
        const runtimeTitle =
          runtime === 'electron' ? 'Daily Fresh Windows Desktop App' :
          runtime === 'capacitor' ? 'Daily Fresh Android Native App' :
          isStandalone ? 'Installed Standalone Web App' :
          'Web Browser Mode';

        const runtimeSubtitle =
          runtime === 'electron' ? `Running as native 64-bit desktop application (v${OFFICIAL_DISTRIBUTION.version})` :
          runtime === 'capacitor' ? `Running as native Android application (v${OFFICIAL_DISTRIBUTION.version})` :
          isStandalone ? 'Running in standalone home-screen app mode' :
          'Not yet installed on this device (running inside browser)';

        return (
          <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  isInstalledApp
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
                }`}>
                  {isInstalledApp ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <Download className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                    This Device Status ({platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : platform === 'windows' ? 'Windows' : platform === 'macos' ? 'macOS' : 'Browser'})
                  </p>
                  <p className="text-sm font-bold text-[var(--color-text-main)] mt-0.5">
                    {runtimeTitle}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {runtimeSubtitle}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => triggerAppUpdateCheck()}
                  icon={<RefreshCw className="w-4 h-4 text-gray-500 dark:text-gray-400" />}
                >
                  Check for Updates
                </Button>

                {!isInstalledApp && (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => triggerInstall()}
                    icon={<Download className="w-4 h-4" />}
                  >
                    {platform === 'windows' ? 'Download Windows Setup' : platform === 'android' ? 'Download Android APK' : 'Install App'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Official Distributable Packages Section */}
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-bold text-[var(--color-text-main)]">
            Official Production Download Packages
          </h4>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Verified release artifacts with SHA-256 integrity checksums for Windows administration and Android staff phones.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Windows Desktop Setup */}
          <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xs space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-900/40">
                  <Monitor className="w-5 h-5" />
                </div>
                <div>
                  <h5 className="text-sm font-bold text-[var(--color-text-main)]">
                    Windows Desktop Installer
                  </h5>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {OFFICIAL_DISTRIBUTION.downloads.windows.fileName} • {OFFICIAL_DISTRIBUTION.downloads.windows.fileSize}
                  </p>
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold uppercase tracking-wider">
                Admin PCs
              </span>
            </div>

            <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/40 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-gray-500">Target OS:</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200">Windows 10 / 11 (64-bit)</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-gray-500">Version:</span>
                <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">v{OFFICIAL_DISTRIBUTION.version}</span>
              </div>
              <div className="flex flex-col gap-0.5 pt-1 border-t border-gray-200/50 dark:border-gray-700/50 text-[10px]">
                <span className="text-gray-500 font-mono">SHA-256 Checksum:</span>
                <span className="font-mono text-[9px] text-gray-700 dark:text-gray-300 select-all break-all">
                  {OFFICIAL_DISTRIBUTION.downloads.windows.sha256}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
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
                className="flex-1 py-2 px-3 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm flex items-center justify-center gap-1.5 transition-all text-center"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Setup.exe</span>
              </a>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(OFFICIAL_DISTRIBUTION.downloads.windows.latestUrl);
                  toast.success('Windows installer URL copied to clipboard');
                }}
                icon={<Copy className="w-3.5 h-3.5" />}
              >
                Copy Link
              </Button>
            </div>
          </div>

          {/* Android Release APK */}
          <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xs space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-100 dark:border-emerald-900/40">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h5 className="text-sm font-bold text-[var(--color-text-main)]">
                    Android Signed Release APK
                  </h5>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {OFFICIAL_DISTRIBUTION.downloads.android.fileName} • {OFFICIAL_DISTRIBUTION.downloads.android.fileSize}
                  </p>
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold uppercase tracking-wider">
                Staff Phones
              </span>
            </div>

            <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/40 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-gray-500">Signing Scheme:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">Signed (v2 Scheme Verified)</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-gray-500">Version:</span>
                <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">v{OFFICIAL_DISTRIBUTION.version}</span>
              </div>
              <div className="flex flex-col gap-0.5 pt-1 border-t border-gray-200/50 dark:border-gray-700/50 text-[10px]">
                <span className="text-gray-500 font-mono">SHA-256 Checksum:</span>
                <span className="font-mono text-[9px] text-gray-700 dark:text-gray-300 select-all break-all">
                  {OFFICIAL_DISTRIBUTION.downloads.android.sha256}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
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
                className="flex-1 py-2 px-3 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm flex items-center justify-center gap-1.5 transition-all text-center"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download DailyFresh.apk</span>
              </a>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(OFFICIAL_DISTRIBUTION.downloads.android.latestUrl);
                  toast.success('Android APK URL copied to clipboard');
                }}
                icon={<Copy className="w-3.5 h-3.5" />}
              >
                Copy Link
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* App Production URL & Quick Actions */}
      <div className="space-y-3">
        <label className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          Canonical Production ERP Link
        </label>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm font-mono text-gray-800 dark:text-gray-200 shadow-2xs select-all overflow-x-auto">
            <Globe className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="truncate">{CANONICAL_URL}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyLink}
              icon={copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            >
              {copied ? 'Copied' : 'Copy Link'}
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleShareLink}
              icon={<Share2 className="w-4 h-4" />}
            >
              Share App Link
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleWhatsAppShare}
              title="Share via WhatsApp"
              aria-label="Share via WhatsApp"
              className="px-2.5"
              icon={<MessageCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
            />
          </div>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          Share this link with delivery drivers, billing staff, or administration. Opening this URL will allow them to install the app or use it directly.
        </p>
      </div>

      {/* Cross-Platform Installation Guide */}
      <div className="space-y-4 pt-2">
        <div>
          <h4 className="text-sm font-bold text-[var(--color-text-main)]">
            Step-by-Step Installation Guides
          </h4>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Clear instructions to guide staff on each operating system and browser.
          </p>
        </div>

        {/* Platform Selector Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
          <button
            type="button"
            onClick={() => setActiveGuideTab('android')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border ${
              activeGuideTab === 'android'
                ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 shrink-0" />
            <span>Android</span>
            {platform === 'android' && (
              <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-white/20 font-semibold">Your device</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveGuideTab('ios')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border ${
              activeGuideTab === 'ios'
                ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <Share2 className="w-3.5 h-3.5 shrink-0" />
            <span>iPhone &amp; iPad</span>
            {platform === 'ios' && (
              <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-white/20 font-semibold">Your device</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveGuideTab('windows')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border ${
              activeGuideTab === 'windows'
                ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <Monitor className="w-3.5 h-3.5 shrink-0" />
            <span>Windows PC</span>
            {platform === 'windows' && (
              <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-white/20 font-semibold">Your device</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveGuideTab('macos')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border ${
              activeGuideTab === 'macos'
                ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <Laptop className="w-3.5 h-3.5 shrink-0" />
            <span>macOS</span>
            {platform === 'macos' && (
              <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-white/20 font-semibold">Your device</span>
            )}
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          {activeGuideTab === 'android' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-primary)]">
                  Android Installation Guide
                </span>
                <span className="text-[11px] text-gray-400">(Chrome, Edge, Samsung Internet)</span>
              </div>
              <ol className="space-y-2.5 text-xs text-[var(--color-text-main)]">
                <li className="flex items-start gap-3 p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40">
                  <span className="w-5 h-5 rounded-full bg-amber-200/80 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 font-bold flex items-center justify-center shrink-0 text-[11px]">
                    !
                  </span>
                  <div>
                    <strong className="block text-amber-950 dark:text-amber-100">Opened from WhatsApp or Social Media?</strong>
                    <span className="text-amber-800 dark:text-amber-300 text-[11px]">In-app browsers block app installation. Tap the 3 vertical dots (⋮) in the corner and tap <strong>&ldquo;Open in Chrome&rdquo;</strong> first.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                  <span className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0 text-[11px]">
                    1
                  </span>
                  <div>
                    <strong className="block">Open in Google Chrome or Microsoft Edge</strong>
                    <span className="text-gray-500 dark:text-gray-400">Navigate to {CANONICAL_URL} on your Android device.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                  <span className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0 text-[11px]">
                    2
                  </span>
                  <div>
                    <strong className="block">Tap &ldquo;Install App&rdquo; or Browser Menu (⋮)</strong>
                    <span className="text-gray-500 dark:text-gray-400">If the install banner appears, tap it. Alternatively, tap the 3 vertical dots at the top right of Chrome.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                  <span className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0 text-[11px]">
                    3
                  </span>
                  <div>
                    <strong className="block">Choose &ldquo;Install app&rdquo; / &ldquo;Add to Home screen&rdquo;</strong>
                    <span className="text-gray-500 dark:text-gray-400">Tap <strong>Install</strong> to confirm. Daily Fresh will appear as an app in your phone app drawer and Home Screen.</span>
                  </div>
                </li>
              </ol>
            </div>
          )}

          {activeGuideTab === 'ios' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-primary)]">
                  iPhone &amp; iPad Installation Guide
                </span>
                <span className="text-[11px] text-gray-400">(Apple Safari)</span>
              </div>
              <ol className="space-y-2.5 text-xs text-[var(--color-text-main)]">
                <li className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                  <span className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0 text-[11px]">
                    1
                  </span>
                  <div>
                    <strong className="block">Open in Apple Safari</strong>
                    <span className="text-gray-500 dark:text-gray-400">Open {CANONICAL_URL} in Safari. Apple iOS requires Safari to add PWAs to the Home Screen.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                  <span className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0 text-[11px]">
                    2
                  </span>
                  <div>
                    <strong className="block">Tap the Share Button</strong>
                    <span className="text-gray-500 dark:text-gray-400">Tap the Share icon (square with upward arrow) in the bottom toolbar on iPhone or top-right toolbar on iPad.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                  <span className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0 text-[11px]">
                    3
                  </span>
                  <div>
                    <strong className="block">Select &ldquo;Add to Home Screen&rdquo;</strong>
                    <span className="text-gray-500 dark:text-gray-400">Scroll down the share sheet, tap <strong>Add to Home Screen</strong>, and tap <strong>Add</strong> in the top right. Daily Fresh runs in full-screen standalone mode.</span>
                  </div>
                </li>
              </ol>
            </div>
          )}

          {activeGuideTab === 'windows' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-primary)]">
                  Windows PC Installation Guide
                </span>
                <span className="text-[11px] text-gray-400">(Microsoft Edge &amp; Google Chrome)</span>
              </div>
              <ol className="space-y-2.5 text-xs text-[var(--color-text-main)]">
                <li className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                  <span className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0 text-[11px]">
                    1
                  </span>
                  <div>
                    <strong className="block">Open in Chrome or Edge on Windows 10/11</strong>
                    <span className="text-gray-500 dark:text-gray-400">Navigate to {CANONICAL_URL}.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                  <span className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0 text-[11px]">
                    2
                  </span>
                  <div>
                    <strong className="block">Click the Install Icon in the Address Bar</strong>
                    <span className="text-gray-500 dark:text-gray-400">Click the install monitor icon on the right side of the address bar, or menu (… / ⋮) &rarr; Apps &rarr; Install Daily Fresh.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                  <span className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0 text-[11px]">
                    3
                  </span>
                  <div>
                    <strong className="block">Pin to Windows Taskbar</strong>
                    <span className="text-gray-500 dark:text-gray-400">Daily Fresh launches in its own dedicated window. Right-click its taskbar icon to pin it for quick 1-click access.</span>
                  </div>
                </li>
              </ol>
            </div>
          )}

          {activeGuideTab === 'macos' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-primary)]">
                  macOS Installation Guide
                </span>
                <span className="text-[11px] text-gray-400">(Safari 14+, Google Chrome, or Edge)</span>
              </div>
              <ol className="space-y-2.5 text-xs text-[var(--color-text-main)]">
                <li className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                  <span className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0 text-[11px]">
                    1
                  </span>
                  <div>
                    <strong className="block">In Safari (macOS Sonoma 14+)</strong>
                    <span className="text-gray-500 dark:text-gray-400">Open {CANONICAL_URL} in Safari. Click <strong>File</strong> in the top menu bar &rarr; <strong>Add to Dock…</strong> &rarr; Click <strong>Add</strong>.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                  <span className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0 text-[11px]">
                    2
                  </span>
                  <div>
                    <strong className="block">In Chrome or Edge for Mac</strong>
                    <span className="text-gray-500 dark:text-gray-400">Click the <strong>Install</strong> icon in the address bar (or menu ⋮ &rarr; Save and share &rarr; Install Daily Fresh).</span>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                  <span className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 text-[var(--color-primary)] font-bold flex items-center justify-center shrink-0 text-[11px]">
                    3
                  </span>
                  <div>
                    <strong className="block">Run as Native Mac App</strong>
                    <span className="text-gray-500 dark:text-gray-400">The app runs in a clean window, appears in Launchpad and the Mac Dock, and supports Command+Tab switching.</span>
                  </div>
                </li>
              </ol>
            </div>
          )}
        </div>
      </div>

      {/* Technical Summary */}
      <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 flex items-start gap-3 text-xs text-gray-500 dark:text-gray-400">
        <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-gray-700 dark:text-gray-300">
            Progressive Web App (PWA) Architecture
          </p>
          <p>
            Daily Fresh installs seamlessly without requiring App Store or Google Play downloads. It uses standard HTTPS manifest and service worker caching for instant startup, while orders, payments, clients, and inventory synchronize live with Firestore in real time.
          </p>
        </div>
      </div>

      {/* Fallback Instructions Modal */}
      <InstallInstructionsModal
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
        detectedPlatform={platform}
        hasNativePrompt={hasNativePrompt}
        isInAppBrowser={isInAppBrowser}
        onTriggerNativePrompt={triggerInstall}
      />
    </div>
  );
}
