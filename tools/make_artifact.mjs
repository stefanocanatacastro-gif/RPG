// Turns dist/index.html (a full single-file page) into dist/play.html, the file
// published as the playable link. The Artifact host adds its own doctype/html/
// head/body wrapper, so those tags are stripped and everything else is kept.
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const src = readFileSync('dist/index.html', 'utf8');
const out = src
  .replace(/<!doctype html>/i, '')
  .replace(/<\/?html[^>]*>/gi, '')
  .replace(/<\/?head>/gi, '')
  .replace(/<\/?body[^>]*>/gi, '')
  .replace(/<meta charset[^>]*>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .trim();
writeFileSync('dist/play.html', out + '\n');
const kb = (statSync('dist/play.html').size / 1024).toFixed(0);
console.log(`dist/play.html ready (${kb} KB)`);
