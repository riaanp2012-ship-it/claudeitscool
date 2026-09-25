import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build runs from any path (static hosting, file shares, artifact pages).
  base: './',
  server: { port: Number(process.env.PORT ?? 5173), strictPort: true },
  preview: { port: Number(process.env.PORT ?? 4173), strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    // three.js + the game is ~1.33 MB minified / ~425 KB gzipped, inside the 900 KB gzip budget (spec §10.2).
    chunkSizeWarningLimit: 1500,
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
  // Pre-bundle heavy deps so the dev server never re-optimizes mid-load (aborted requests in harness shots).
  optimizeDeps: { include: ['three', 'postprocessing'] },
});
