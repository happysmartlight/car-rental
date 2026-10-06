import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../api/src/shared'),
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://localhost:3002' },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
