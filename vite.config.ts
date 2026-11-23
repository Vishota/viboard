import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Сборка UI (ui/ → dist/ui): сервер отдаёт index.html на «/» и ассеты под «/static/».
// В dev (`npm run dev`) страница работает с уже запущенным `vitask ui` через прокси /api.
export default defineConfig({
  root: 'ui',
  base: '/static/',
  plugins: [vue()],
  resolve: { alias: { '@': '/src', '@core': '../src/core' } },
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8777' },
  },
});
