import type { CapacitorConfig } from '@capacitor/cli';
const localAndroid = process.env.TEUM_ANDROID_DEV === '1';
const config: CapacitorConfig = {
  appId: 'io.teum.notes', appName: '틈', webDir: process.env.TEUM_ANDROID_ASSETS || 'dist',
  server: { cleartext: localAndroid },
  android: { allowMixedContent: localAndroid }
};
export default config;
