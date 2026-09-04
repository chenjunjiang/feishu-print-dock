import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 官方静态托管契约：base './' 相对路径（docs/官方边栏插件开发指南.md 硬要求）
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
