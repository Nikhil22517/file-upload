import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // Node libraries the ingestion packages use on the server load from node_modules at runtime instead of
  // being bundled: pdf.js finds its fonts and worker beside its own files, pg and exceljs ship native/CJS parts.
  // They are listed in this app's dependencies (same versions as the packages) so pnpm resolves them from here.
  ssr: { external: ['pdfjs-dist', 'exceljs', 'papaparse', 'pg', 'drizzle-orm'] },
  plugins: [tailwindcss(), tanstackStart(), viteReact()], // tanstackStart must come before react()
});
