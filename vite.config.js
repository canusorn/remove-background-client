import { defineConfig } from 'vite';

export default defineConfig({
  base: '/cynoai/background-remove/',
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          'transformers': ['@xenova/transformers']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['@xenova/transformers']
  },
  define: {
    global: 'globalThis'
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin'
    }
  }
});
