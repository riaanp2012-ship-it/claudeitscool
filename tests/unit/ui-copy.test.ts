import { describe, expect, it } from 'vitest';
import { CREDITS, DEFAULT_BINDINGS, MAIN_MENU, TIPS } from '../../src/ui/copy';
import { FIELDS } from '../../src/ui/settings-fields';

const HYPE = /\b(epic|ultimate|unleash|awesome|amazing|insane|legendary|welcome to)\b/i;

function allCopy(): string[] {
  const out: string[] = [];
  for (const m of MAIN_MENU) out.push(m.label, m.note, m.code, m.description, ...m.facts.flat());
  out.push(...TIPS);
  for (const s of CREDITS) for (const e of s.entries) out.push(e.name, e.detail, e.license ?? '');
  for (const b of DEFAULT_BINDINGS) out.push(b.action, b.keyboard, b.gamepad);
  for (const f of Object.values(FIELDS).flat()) {
    out.push(f.label, f.help);
    if (f.kind === 'choice') for (const o of f.options) out.push(o.label, o.disabled ?? '');
  }
  return out;
}

describe('menu copy (spec §8.7, ZD-M03)', () => {
  it('has no exclamation marks, hype words or placeholders', () => {
    for (const text of allCopy()) {
      expect(text, text).not.toMatch(/!/);
      expect(text, text).not.toMatch(HYPE);
      expect(text, text).not.toMatch(/lorem|placeholder|undefined|NaN|coming soon/i);
    }
  });

  it('writes descriptions and help as full sentences', () => {
    for (const m of MAIN_MENU) expect(m.description.trim().endsWith('.'), m.label).toBe(true);
    for (const f of Object.values(FIELDS).flat()) expect(f.help.trim().endsWith('.'), f.id).toBe(true);
    for (const t of TIPS) expect(/[.]$/.test(t.trim()), t).toBe(true);
  });

  it('lists every default control from the spec', () => {
    expect(DEFAULT_BINDINGS.map((b) => b.action)).toContain('Pause');
    expect(DEFAULT_BINDINGS).toHaveLength(17);
  });

  it('credits every bundled typeface and library with its license', () => {
    const names = CREDITS.flatMap((s) => s.entries.map((e) => `${e.name}:${e.license ?? ''}`));
    expect(names).toContain('Barlow Condensed:SIL OFL 1.1');
    expect(names).toContain('IBM Plex Sans:SIL OFL 1.1');
    expect(names).toContain('JetBrains Mono:SIL OFL 1.1');
    expect(names).toContain('three.js:MIT');
    expect(names).toContain('postprocessing:Zlib');
  });
});
