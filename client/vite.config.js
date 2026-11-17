import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  publicDir: resolve(root, 'public'),
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3000' },
    fs: { allow: [resolve(root, '..')] },
  },
  build: {
    outDir: resolve(root, '..', 'client-dist'),
    emptyOutDir: true,
    rollupOptions: { input: { app: resolve(root, 'index.html'), oidcCallback: resolve(root, 'oidc-callback.html') } },
  },
});
