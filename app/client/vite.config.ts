import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export default defineConfig({
  plugins: [react(), {
    name: 'teum-offline-shell',
    apply: 'build',
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle).map(name => `/${name}`);
      const files = ['/', '/icon.svg', '/fonts/Roboto-Regular.woff', '/fonts/Roboto-Medium.woff', '/fonts/Metropolis-Medium.woff', ...assets];
      const version = createHash('sha256').update(assets.join()).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8').replace('__CACHE_NAME__', `teum-shell-${version}`).replace('__PRECACHE__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    }
  }],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8081' } },
  preview: { port: 5174, proxy: { '/api': 'http://127.0.0.1:8081' } }
});
