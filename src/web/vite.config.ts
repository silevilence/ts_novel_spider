import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const devServerHost = process.env.VITE_DEV_HOST ?? '127.0.0.1';
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3000';
const usePolling = process.env.VITE_USE_POLLING === 'true';

const diagnosticPlugin: Plugin = {
  name: 'dev-diagnostics',
  configureServer(server) {
    console.info(`[dev-diagnostics] Vite server configured: host=${devServerHost}, port=5173, proxy=${apiProxyTarget}, polling=${usePolling}`);
    server.httpServer?.on('error', (error) => console.error('[dev-diagnostics] Vite HTTP server error:', error.stack ?? error.message));
    server.watcher.on('error', (error) => console.error('[dev-diagnostics] Vite watcher error:', error.stack ?? error.message));
  },
};

export default defineConfig({
  root: __dirname,
  plugins: [react(), diagnosticPlugin],
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
