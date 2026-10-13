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
    rolldownOptions: {
      output: {
        // Dữ liệu OCR: Tesseract tự ghép "<thư mục>/vie.traineddata.gz" nên giữ nguyên tên file, hash đặt ở tên thư mục.
        assetFileNames: (a) => (a.names[0]?.endsWith('.traineddata.gz') ? 'assets/ocr-[hash]/[name][extname]' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
});
