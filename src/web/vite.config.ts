import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const devServerHost = process.env.VITE_DEV_HOST ?? '127.0.0.1';
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3000';
const usePolling = process.env.VITE_USE_POLLING === 'true';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    host: devServerHost,
    port: 5173,
    watch: {
      usePolling,
    },
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../../dist/web'),
    emptyOutDir: true,
  },
});