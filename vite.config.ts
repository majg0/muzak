import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  worker: { format: 'es' },
  plugins: [{
    name: 'local-reference-corpus',
    apply: 'serve',
    configureServer(server) {
      // Local analysis inputs are never copied to public/ or the production build.
      const root = resolve(server.config.root, 'research/corpus');
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        if (!path?.startsWith('/__references')) return next();
        if (request.method !== 'GET') { response.statusCode = 405; response.end(); return; }
        try {
          const registry = JSON.parse(readFileSync(resolve(server.config.root, 'docs/research/corpus-candidates.json'), 'utf8')) as {
            analysisCandidates: Array<{ id: string; artist: string; work: string; game?: string; edition: string; sourceUrls: string[]; asset: { path: string } }>;
          };
          const available = registry.analysisCandidates.filter(item => {
            const asset = resolve(server.config.root, item.asset.path);
            return asset.startsWith(root + sep) && existsSync(asset);
          });
          response.setHeader('Cache-Control', 'no-store');
          if (path === '/__references') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(available.map(({ id, artist, work, game, edition, sourceUrls }) => ({ id, artist, work, game, edition, sourceUrls }))));
          } else {
            const item = available.find(item => `/__references/${encodeURIComponent(item.id)}` === path);
            if (!item) { response.statusCode = 404; response.end(); return; }
            response.setHeader('Content-Type', 'audio/midi');
            response.end(readFileSync(resolve(server.config.root, item.asset.path)));
          }
        } catch { response.statusCode = 500; response.end('Local reference registry could not be read.'); }
      });
    },
  }],
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        instrument: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
});
