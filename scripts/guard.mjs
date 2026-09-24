// Fails the build when shipped source contains placeholders or debugging leftovers.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../src', import.meta.url).pathname;
const rules = [
  { re: /\bTODO\b|\bFIXME\b|\bXXX\b/, msg: 'placeholder marker' },
  { re: /lorem ipsum/i, msg: 'lorem ipsum' },
  { re: /console\.log\(/, msg: 'console.log' },
  { re: /@ts-ignore/, msg: '@ts-ignore' },
  { re: /\bdebugger\b/, msg: 'debugger statement' },
  { re: /coming soon/i, msg: '"coming soon" placeholder' },
  { re: /Math\.random\(/, msg: 'Math.random (use core/rng)', allow: ['core/rng.ts'] },
];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|css|html|glsl)$/.test(name)) files.push(p);
  }
};
walk(root);

let failures = 0;
for (const file of files) {
  const rel = relative(root, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const rule of rules) {
      if (rule.allow?.includes(rel)) continue;
      if (rule.re.test(line)) {
        console.error(`guard: ${rel}:${i + 1}: ${rule.msg}`);
        failures++;
      }
    }
  });
}
if (failures > 0) {
  console.error(`guard: ${failures} problem(s) found`);
  process.exit(1);
}
console.info(`guard: ${files.length} files clean`);
