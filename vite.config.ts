import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  // Base path for GitHub Pages deployment
  base: '/3DVIEW/',

  // Treat DXF files as static assets
  assetsInclude: ['**/*.dxf'],

  // Explicitly set public directory
  publicDir: 'public',

  build: {
    // Prevent inlining large DXF files
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },

  resolve: {
    alias: {
      '@': '/src',
    },
  },

  server: {
    port: 5173,
    strictPort: false,
    fs: {
      // Allow serving files from one level up (project root)
      allow: ['..']
    }
  }
});