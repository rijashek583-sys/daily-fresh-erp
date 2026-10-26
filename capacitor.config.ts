import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dailyfresh.erp',
  appName: 'Daily Fresh ERP',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
