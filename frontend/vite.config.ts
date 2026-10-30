import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
declare const process: { env: Record<string, string | undefined> };
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: { '/api': { target: 'http://backend:8000', changeOrigin: true } }
  },
});
