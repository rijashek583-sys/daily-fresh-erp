import { registerPlugin } from '@capacitor/core';

export interface DownloadProgress {
  progress: number;
  bytesReceived: number;
  totalBytes: number;
}

export interface AppVersionInfo {
  versionName: string;
  versionCode: number;
  packageName: string;
}

export interface DownloadApkResult {
  success: boolean;
  message: string;
  filePath?: string;
  sha256?: string;
}

export interface AppUpdatePluginInterface {
  getAppVersion(): Promise<AppVersionInfo>;
  canRequestPackageInstalls(): Promise<{ canInstall: boolean }>;
  openInstallPermissionSettings(): Promise<void>;
  cancelDownload(): Promise<void>;
  downloadAndInstallApk(options: {
    downloadUrl: string;
    expectedSha256?: string;
    expectedSizeBytes?: number;
  }): Promise<DownloadApkResult>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (progress: DownloadProgress) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

export const NativeAppUpdate = registerPlugin<AppUpdatePluginInterface>('AppUpdatePlugin', {
  web: () => ({
    getAppVersion: async () => ({
      versionName: '1.0.0',
      versionCode: 1,
      packageName: 'com.dailyfresh.erp',
    }),
    canRequestPackageInstalls: async () => ({ canInstall: true }),
    openInstallPermissionSettings: async () => {},
    cancelDownload: async () => {},
    downloadAndInstallApk: async () => ({
      success: false,
      message: 'Native APK update is only available on Android native app.',
    }),
    addListener: async () => ({ remove: async () => {} }),
  }),
});
