// Computes the SHA-256 CSP hash for every inline <script> in the built HTML.
// Usage: node scripts/csp-hash.mjs [htmlPath]
// Output: one "sha256-<base64>" line per inline script, plus a ready-to-paste
// script-src directive.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.argv[2] ?? 'dist/index.html');

if (!existsSync(target)) {
  console.error(`ERROR: ${target} not found. Run \`npm run build\` first.`);
  process.exit(1);
}

const html = readFileSync(target, 'utf8');

// Inline scripts only — a <script src="..."> is covered by 'self' and needs no hash.
const inlinePattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const hashes = [];
let match = null;
let index = 0;

while (true) {
  match = inlinePattern.exec(html);
  if (match === null) break;
  const body = match[1].trim();
  if (!body) {
    console.log(`[${index}] (empty) — skipped`);
    index++;
    continue;
  }
  const hash = createHash('sha256').update(body, 'utf8').digest('base64');
  hashes.push(`'sha256-${hash}'`);
  console.log(`[${index}] ${body.length} bytes -> 'sha256-${hash}'`);
  console.log(`     ${body.slice(0, 100).replace(/\n/g, ' ')}`);
  index++;
}

if (hashes.length === 0) {
  console.log("\nNo inline scripts found — script-src may be plain 'self'.");
} else {
  console.log(`\nscript-src 'self' ${hashes.join(' ')} 'strict-dynamic'`);
}
console.log(`\nTotal inline scripts: ${hashes.length}`);
