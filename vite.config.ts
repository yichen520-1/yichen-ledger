import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 版本号只维护一处：package.json。
 *
 * 之前界面底部的 "v0.1.0" 是手写的字面量，发 0.1.1 时忘了改，
 * 装好的新版本界面上还写着旧版本号。现在构建时把 package.json 的
 * version 注入成 __APP_VERSION__，界面里直接用它，就不会再对不上。
 */
function readVersion(): string {
  const raw = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

export default defineConfig({
  plugins: [react()],
  // 用相对路径：Electron 用 file:// 加载 dist/index.html 时必须这样，
  // Capacitor 的 capacitor://localhost 同理。
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(readVersion()),
  },
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
});
