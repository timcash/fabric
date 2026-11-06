import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: process.env.BASE_PATH || '/', // e.g. /fabric/ for GitHub Pages project sites
  plugins: [{
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
      input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), scan: fileURLToPath(new URL('./scan.html', import.meta.url)) },
      output: { manualChunks: { three: ['three'] } },
    },
  },
});
