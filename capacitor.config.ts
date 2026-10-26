import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 配置：把同一份 web 产物打包成 Android / iOS 原生壳。
 * - appId 是包名，发布后不可随意改
 * - webDir 指向 Vite 的构建输出
 */
const config: CapacitorConfig = {
  appId: 'com.yichen.ledger',
  appName: '忆尘记账',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'always',
  },
};

export default config;
