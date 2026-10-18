import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  // Don't inherit the parent folder's Tailwind/PostCSS setup.
  css: { postcss: {} },
  build: { target: 'es2022' },
});
