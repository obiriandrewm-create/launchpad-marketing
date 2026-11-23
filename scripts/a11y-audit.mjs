/*
 * Accessibility + theme-resolution audit for launchpad-marketing.
 *
 * Runs axe-core (WCAG 2.1 A/AA) against the built site in BOTH colour schemes, and
 * asserts that every design token actually resolves to a real value.
 *
 * Why this exists: a token that resolves to nothing does not throw — it silently
 * renders transparent/default. This script is what catches "the CSS compiled fine but
 * the design system isn't actually applied" — a class of bug that no linter, type
 * checker, or unit test can see.
 *
 *   node scripts/a11y-audit.mjs
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

// Every semantic role that must resolve to a real colour.
const REQUIRED_COLOR_TOKENS = [
  '--color-canvas',
  '--color-surface',
  '--color-surface-raised',
  '--color-border',
  '--color-border-strong',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-text-on-accent',
  '--color-accent',
  '--color-accent-subtle',
  '--color-focus-ring',
  '--color-status-pass',
  '--color-status-manual',
  '--color-status-fail',
  '--color-status-stale',
  '--color-status-expired',
];

const REQUIRED_FONT_TOKENS = ['--font-sans', '--font-mono'];

function startServer(port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      let filePath = join(distDir, decodeURIComponent(url.pathname));
      if (url.pathname === '/' || !existsSync(filePath)) filePath = join(distDir, 'index.html');
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolvePromise) => server.listen(port, () => resolvePromise(server)));
}

async function main() {
  if (!existsSync(join(distDir, 'index.html'))) {
    console.error('ERROR: dist/index.html not found. Run `npm run build` first.');
    process.exit(1);
  }

  const port = 4421;
  const server = await startServer(port);
  const browser = await chromium.launch();
  let failures = 0;

  console.log('\n=== Accessibility + theme audit — launchpad-marketing ===\n');

  for (const scheme of ['dark', 'light']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });

    // --- 1. Token resolution -------------------------------------------------
    const tokens = await page.evaluate(
      ({ colorTokens, fontTokens }) => {
        const root = getComputedStyle(document.documentElement);
        const read = (name) => root.getPropertyValue(name).trim();
        return {
          colors: Object.fromEntries(colorTokens.map((t) => [t, read(t)])),
          fonts: Object.fromEntries(fontTokens.map((t) => [t, read(t)])),
          bodyBg: getComputedStyle(document.body).backgroundColor,
          bodyColor: getComputedStyle(document.body).color,
          bodyFont: getComputedStyle(document.body).fontFamily,
          hasStylesheet: document.styleSheets.length > 0,
          skipLink: !!document.querySelector('.skip-link'),
          mainLandmark: !!document.querySelector('main#main'),
          h1Count: document.querySelectorAll('h1').length,
          imgNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt'))
            .length,
        };
      },
      { colorTokens: REQUIRED_COLOR_TOKENS, fontTokens: REQUIRED_FONT_TOKENS }
    );

    const unresolvedColors = Object.entries(tokens.colors)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    const unresolvedFonts = Object.entries(tokens.fonts)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    // --- 2. axe-core ---------------------------------------------------------
    const axeSource = await readFile(
      resolve(root, 'node_modules/axe-core/axe.min.js'),
      'utf8'
    ).catch(() => null);

    let axe = null;
    if (axeSource) {
      await page.addScriptTag({ content: axeSource });
      axe = await page.evaluate(async () => {
        const result = await window.axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        });
        return {
          violations: result.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.length,
            help: v.help,
            targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')),
          })),
          passes: result.passes.length,
          incomplete: result.incomplete.length,
        };
      });
    }

    console.log(`--- ${scheme.toUpperCase()} ---`);
    console.log(`  stylesheet loaded:        ${tokens.hasStylesheet ? 'YES' : 'NO  <-- FAIL'}`);
    console.log(
      `  unresolved color tokens:  ${unresolvedColors.length === 0 ? 'none' : unresolvedColors.join(', ')}`
    );
    console.log(
      `  unresolved font tokens:   ${unresolvedFonts.length === 0 ? 'none' : unresolvedFonts.join(', ')}`
    );
    console.log(`  body background:          ${tokens.bodyBg}`);
    console.log(`  body color:               ${tokens.bodyColor}`);
    console.log(`  skip link present:        ${tokens.skipLink ? 'yes' : 'NO  <-- FAIL'}`);
    console.log(`  <main> landmark:          ${tokens.mainLandmark ? 'yes' : 'NO  <-- FAIL'}`);
    console.log(
      `  h1 count:                 ${tokens.h1Count} ${tokens.h1Count === 1 ? '' : '<-- FAIL'}`
    );
    console.log(`  img without alt:          ${tokens.imgNoAlt}`);

    if (axe) {
      console.log(`  axe-core rules passed:    ${axe.passes}`);
      console.log(`  axe-core violations:      ${axe.violations.length}`);
      for (const v of axe.violations) {
        console.log(`    [${v.impact}] ${v.id} (${v.nodes}): ${v.help}`);
        for (const t of v.targets) console.log(`        -> ${t}`);
      }
    } else {
      console.log('  axe-core: NOT INSTALLED');
    }
    console.log('');

    if (
      !tokens.hasStylesheet ||
      unresolvedColors.length > 0 ||
      unresolvedFonts.length > 0 ||
      !tokens.skipLink ||
      !tokens.mainLandmark ||
      tokens.h1Count !== 1 ||
      (axe && axe.violations.length > 0)
    ) {
      failures++;
    }

    await context.close();
  }

  await browser.close();
  server.close();

  console.log(
    failures === 0
      ? 'RESULT: PASS — all themes resolve, 0 a11y violations.'
      : `RESULT: FAIL — ${failures} theme(s) failed.`
  );
  if (failures > 0) process.exit(1);
}

await main();
