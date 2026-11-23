// @ts-check

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  integrations: [],
  vite: {
    plugins: [tailwindcss()],
  },
  // Security headers via middleware (see src/middleware/security.ts)
  // Output: static for marketing pages (default in Astro 7+)
  adapter: undefined, // Will add Netlify/Vercel/Cloudflare adapter when deploying
  // Experimental: enable client-side navigation for islands
  prefetch: { prefetchAll: true },
  // Compression
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
  },
});
