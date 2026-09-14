import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相对路径：打包后可以直接放到任意目录 / 静态服务器上，不必挂在域名根目录
  base: './',
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // 正式应用 + Phase 0 的 Layout/Zoom Prototype 共用一份配置
      input: {
        main: 'index.html',
        prototype: 'prototype/index.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
