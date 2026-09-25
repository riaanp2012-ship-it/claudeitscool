// Builds the publishable page for a web artifact from the Vite production build in dist/.
// The artifact host supplies <html>/<head>/<body>, so the page holds only its title, styles, root and scripts.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const tags = [...html.matchAll(/<(script|link)\b[^>]*(?:src|href)="\.\/assets\/[^"]+"[^>]*>(?:<\/script>)?/g)].map((m) =>
  m[0].replace(/\s+crossorigin/g, ''),
);
const page = `<title>SPLASH ONE</title>
<style>
  :root { color-scheme: dark; --ink: #0a0c0d; }
  html, body { height: 100%; margin: 0; background: var(--ink); overflow: hidden; }
  #app { position: fixed; inset: 0; }
</style>
<div id="app"></div>
${tags.join('\n')}
`;
writeFileSync('dist/splash-one.html', page);
const assets = readdirSync('dist/assets');
writeFileSync('dist/artifact-files.json', JSON.stringify(Object.fromEntries(assets.map((a) => [`assets/${a}`, `dist/assets/${a}`])), null, 2));
console.info(`artifact page: ${tags.length} tags, ${assets.length} asset files`);
