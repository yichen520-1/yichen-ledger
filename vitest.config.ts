/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

/**
 * 测试配置单独放一个文件：
 * vitest 自带一份 vite，如果和项目里的 vite 版本不同，
 * 把 `test` 字段混进 vite.config.ts 会触发插件类型冲突。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
  },
});
