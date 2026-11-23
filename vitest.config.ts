import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// Два проекта: узел (ядро, сервер) — без DOM; UI (Vue-компоненты) — happy-dom.
export default defineConfig({
  plugins: [vue()],
  test: {
    projects: [
      { test: { name: 'node', include: ['test/node/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'ui', include: ['test/ui/**/*.test.ts'], environment: 'happy-dom' } },
    ],
  },
});
