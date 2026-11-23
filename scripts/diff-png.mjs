// Debug helper: compare two PNGs pixel-by-pixel and report where they differ.

import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const a = PNG.sync.read(readFileSync(process.argv[2]));
const b = PNG.sync.read(readFileSync(process.argv[3]));

console.log('A:', a.width, 'x', a.height, 'len', a.data.length);
console.log('B:', b.width, 'x', b.height, 'len', b.data.length);

if (a.width !== b.width || a.height !== b.height) {
  console.log('SIZE MISMATCH');
  process.exit(2);
}

let differing = 0;
const rows = new Map();
for (let i = 0; i < a.data.length; i += 4) {
  const dr = Math.abs(a.data[i] - b.data[i]);
  const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
  const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
  const da = Math.abs(a.data[i + 3] - b.data[i + 3]);
  if (dr > 12 || dg > 12 || db > 12 || da > 12) {
    differing++;
    const px = i / 4;
    const y = Math.floor(px / a.width);
    rows.set(y, (rows.get(y) ?? 0) + 1);
  }
}
const pixels = a.width * a.height;
console.log(
  'differing pixels:',
  differing,
  'of',
  pixels,
  '=',
  `${((differing / pixels) * 100).toFixed(4)}%`
);
const top = [...rows.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10);
console.log('top differing rows (y: count):', JSON.stringify(top));
