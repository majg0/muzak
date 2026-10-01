import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        instrument: fileURLToPath(new URL('./index.html', import.meta.url)),
        audit: fileURLToPath(new URL('./audio-audit.html', import.meta.url)),
      },
    },
  },
});
