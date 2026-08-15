import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const projectDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(projectDir, 'src/background.ts'),
        popup: resolve(projectDir, 'popup.html'),
        options: resolve(projectDir, 'options.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
