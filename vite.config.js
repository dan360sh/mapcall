import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'src',
  envDir: __dirname,
  base: './',
  build: {
    outDir: '../www',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        callback: resolve(__dirname, 'src/callback.html'),
      },
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
});
