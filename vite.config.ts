import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
  milestone: string;
};

const buildDate = new Date().toISOString().slice(0, 10);

// One build command produces dist/index.html: a single self-contained file
// (code + data inlined) that is published as the playable link.
// Real art in public/assets is copied next to it and published alongside.
export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __MILESTONE__: JSON.stringify(pkg.milestone),
    __BUILD_DATE__: JSON.stringify(buildDate),
    __DEV__: JSON.stringify(mode !== 'release'),
  },
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
  },
}));
