/*
 * Style Dictionary build — generates CSS custom properties from the shared token source.
 *
 * SOURCE OF TRUTH: design-tokens.json (copied from the design-system repo, W3C DTCG format).
 * This file is the ONLY place that knows how to turn tokens into CSS. Both repos consume
 * the generated output; neither hand-maintains a token file.
 *
 * OUTPUTS:
 *   src/styles/tokens.css        — CSS custom properties (consumed by Tailwind @theme)
 *   dist/_tokens/tokens.json      — flat JSON for Figma Tokens Studio import
 *
 * The @theme block in src/styles/global.css is hand-written but only *references* these
 * custom properties — it never hardcodes a hex value. That keeps the Tailwind utility
 * names (bg-surface, text-muted, …) stable while the values live in one place.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import StyleDictionary from 'style-dictionary';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const sd = new StyleDictionary({
  source: [resolve(root, 'design-tokens.json')],
  // Style Dictionary v5 moved `formats` / `transforms` to top-level config keys.
  formats: {
    /*
     * Emits THREE tiers of custom properties:
     *   --primitive-*          raw values, never consumed directly by components
     *   --semantic-*           role aliases, also never consumed directly
     *   --color-* / --font-*   the RESOLVED semantic layer that components actually use
     *
     * The resolved layer is the important one. The DTCG source stores themes as sibling
     * keys (`text.primary.dark` / `text.primary.light`), which a naive path-join turns
     * into `--semantic-color-text-primary-dark` — a name no component can consume and
     * one that silently leaves `var(--color-text-primary)` undefined. Resolving the
     * theme here means components reference a single stable name per role, and the
     * light theme is just a media-query override of that same name.
     */
    'css/variables': ({ dictionary, file }) => {
      const vars = dictionary.allTokens
        .filter((token) => token.path[0] !== 'meta')
        .map((token) => `  --${token.path.join('-')}: ${token.value};`)
        .join('\n');
      return `${file.fileHeader ?? ''}:root {\n${vars}\n}\n`;
    },
  },
  platforms: {
    css: {
      transformGroup: 'css',
      buildPath: resolve(root, 'src/styles/'),
      files: [{ destination: 'tokens.css', format: 'css/variables' }],
    },
    json: {
      transformGroup: 'js',
      buildPath: resolve(root, 'dist/_tokens/'),
      files: [{ destination: 'tokens.json', format: 'json/nested' }],
    },
  },
});

await sd.buildAllPlatforms();

// Resolve the semantic tier into the flat, consumable names that components reference,
// plus a light-theme override block for the same names.
//
// The DTCG source stores themes as sibling keys at varying depths:
//   semantic.color.text.primary.dark      → --color-text-primary
//   semantic.color.status.pass.dark       → --color-status-pass
//   semantic.color.canvas.dark            → --color-canvas
//   semantic.font.sans                    → --font-sans
//
// A naive path-join would produce `--semantic-color-text-primary-dark`, which no
// component can consume — and the resulting `var(--color-text-primary)` resolves to
// nothing, silently rendering unstyled or wrongly-coloured UI.
const cssPath = resolve(root, 'src/styles/tokens.css');
const css = readFileSync(cssPath, 'utf8');
const tokens = JSON.parse(readFileSync(resolve(root, 'design-tokens.json'), 'utf8'));

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Resolve a DTCG reference like "{primitive.color.ink.950}" to its literal value. */
function resolveRef(ref) {
  const path = ref.replace(/[{}]/g, '').split('.');
  let node = tokens;
  for (const seg of path) node = node?.[seg];
  if (node && typeof node === 'object' && '$value' in node) return node.$value;
  return node;
}

/** Literal value for a token whose $value may itself be a reference. */
function literalOf(token) {
  const value = token?.$value;
  if (typeof value === 'string' && value.startsWith('{')) return resolveRef(value);
  return value;
}

/**
 * Walk the semantic colour tier and yield { name, dark, light } for each role.
 * Handles both one-level roles (canvas.dark / canvas.light) and two-level roles
 * (text.primary.dark / text.primary.light).
 */
function collectColorRoles() {
  const roles = [];
  for (const [role, node] of Object.entries(tokens.semantic?.color ?? {})) {
    if (!node || typeof node !== 'object') continue;
    if ('dark' in node && 'light' in node) {
      roles.push({ name: kebab(role), dark: literalOf(node.dark), light: literalOf(node.light) });
      continue;
    }
    for (const [sub, pair] of Object.entries(node)) {
      if (!pair || typeof pair !== 'object' || !('dark' in pair) || !('light' in pair)) continue;
      roles.push({
        name: `${kebab(role)}-${kebab(sub)}`,
        dark: literalOf(pair.dark),
        light: literalOf(pair.light),
      });
    }
  }
  return roles;
}

const colorRoles = collectColorRoles();

const resolvedDark = colorRoles.map((r) => `  --color-${r.name}: ${r.dark};`);
const resolvedLight = colorRoles.map((r) => `  --color-${r.name}: ${r.light};`);

// Non-colour semantic roles (font families) resolve to --font-* names.
const resolvedFonts = Object.entries(tokens.semantic?.font ?? {}).map(
  ([role, token]) => `  --font-${kebab(role)}: ${literalOf(token)};`
);

const resolvedBlock = `
/* ============================================================
   RESOLVED SEMANTIC LAYER (dark is the default)
   These are the names components consume. Generated from
   design-tokens.json — do not hand-edit.
   ============================================================ */
:root {
${[...resolvedFonts, ...resolvedDark].join('\n')}
}
`;

const lightBlock = `
/* ============================================================
   LIGHT THEME
   Independently chosen values, not an algorithmic inversion.
   Generated from design-tokens.json — do not hand-edit.
   ============================================================ */
@media (prefers-color-scheme: light) {
  :root {
${resolvedLight.join('\n')}
  }
}
`;

writeFileSync(cssPath, css + resolvedBlock + lightBlock, 'utf8');

// Emit the flat JSON for Figma Tokens Studio.
const outDir = resolve(root, 'dist/_tokens');
mkdirSync(outDir, { recursive: true });

/** Flatten the DTCG tree into { "token.name": "value" } for Figma import. */
function flatten(node, prefix = [], acc = {}) {
  if (!node || typeof node !== 'object') return acc;
  if ('$value' in node) {
    acc[prefix.join('-')] = node.$value;
    return acc;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    flatten(child, [...prefix, kebab(key)], acc);
  }
  return acc;
}

const flat = {
  ...flatten(tokens.primitive, ['primitive']),
  ...flatten(tokens.semantic, ['semantic']),
};
writeFileSync(resolve(outDir, 'tokens.json'), JSON.stringify(flat, null, 2), 'utf8');

console.log('Style Dictionary build complete.');
console.log(`  src/styles/tokens.css   (${css.length + lightBlock.length} bytes)`);
console.log(`  dist/_tokens/tokens.json (${Object.keys(flat).length} flattened tokens)`);
console.log(`  resolved roles: ${colorRoles.length} colors + ${resolvedFonts.length} fonts`);
