import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serviceWorkerSource } from './scripts/service-worker.ts';

export default defineConfig({
  base: process.env.BASE_PATH || '/', // e.g. /fabric/ for GitHub Pages project sites
  plugins: [{
    name: 'service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter(f => !f.endsWith('.map') && f !== 'sw.js' && f !== 'guide.md');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(files) });
    },
  }, {
    name: 'publish-guide',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'guide.md', source: readFileSync(new URL('./docs/guide.md', import.meta.url), 'utf8') });
    },
    configureServer(server) {
      server.middlewares.use('/guide.md', (_request, response) => {
        response.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        response.end(readFileSync(new URL('./docs/guide.md', import.meta.url), 'utf8'));
      });
    },
  }],
  build: {
    rollupOptions: {
      input: { scan: fileURLToPath(new URL('./index.html', import.meta.url)), deck: fileURLToPath(new URL('./deck.html', import.meta.url)) },
      output: { manualChunks: { three: ['three'] } },
    },
  },
});
