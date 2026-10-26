import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // Floating dictation capsule: its own entry, its own window.
        capsule: resolve(__dirname, 'capsule.html'),
      },
    },
  },
  server: {
    // Tauri's devUrl must match this port.
    port: 1420,
    strictPort: true,
    watch: {
      // Never crawl the Rust build directory: its artifacts are locked while
      // cargo is running, which crashes the watcher with EBUSY on Windows.
      ignored: ['**/src-tauri/**'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', '@heroicons/react/24/outline'],
  },
});