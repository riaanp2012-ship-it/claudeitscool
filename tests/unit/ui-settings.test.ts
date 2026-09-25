import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, QUALITY_PRESETS, type Settings } from '../../src/core/settings';
import { derivePreset, FIELDS, readField, SECTIONS, writeField } from '../../src/ui/settings-fields';

const fresh = (): Settings => structuredClone(DEFAULT_SETTINGS);
const field = (id: string) => {
  const f = Object.values(FIELDS)
    .flat()
    .find((x) => x.id === id);
  if (!f) throw new Error(`no field ${id}`);
  return f;
};

describe('settings fields', () => {
  it('covers every stored setting except the version and the binding overrides', () => {
    const ids = new Set(
      Object.values(FIELDS)
        .flat()
        .map((f) => f.id),
    );
    for (const s of SECTIONS) {
      for (const key of Object.keys(DEFAULT_SETTINGS[s.id])) {
        if (s.id === 'controls' && key === 'bindings') continue;
        expect(ids.has(`${s.id}.${key}`), `${s.id}.${key}`).toBe(true);
      }
    }
  });

  it('keeps defaults inside each range and among each choice', () => {
    const s = fresh();
    for (const f of Object.values(FIELDS).flat()) {
      const v = readField(s, f);
      if (f.kind === 'range') {
        expect(v as number).toBeGreaterThanOrEqual(f.min);
        expect(v as number).toBeLessThanOrEqual(f.max);
      } else if (f.kind === 'choice') {
        expect(f.options.some((o) => o.value === v)).toBe(true);
      } else {
        expect(typeof v).toBe('boolean');
      }
    }
  });

  it('switches the preset to custom when a quality option changes', () => {
    const s = fresh();
    writeField(s, field('graphics.shadows'), 'off');
    expect(s.graphics.shadows).toBe('off');
    expect(s.graphics.preset).toBe('custom');
  });

  it('returns to a named preset when the values match it again', () => {
    const s = fresh();
    writeField(s, field('graphics.shadows'), 'off');
    writeField(s, field('graphics.shadows'), 'low');
    expect(s.graphics.preset).toBe('medium');
  });

  it('does not touch the preset for options presets do not control', () => {
    const s = fresh();
    writeField(s, field('graphics.fov'), 90);
    writeField(s, field('graphics.showFps'), true);
    expect(s.graphics.preset).toBe('medium');
    writeField(s, field('audio.master'), 0.3);
    expect(s.graphics.preset).toBe('medium');
  });

  it('applies a whole preset through the preset field', () => {
    const s = fresh();
    writeField(s, field('graphics.preset'), 'low');
    expect(s.graphics.preset).toBe('low');
    expect(s.graphics.shadows).toBe(QUALITY_PRESETS.low.shadows);
    expect(s.graphics.renderScale).toBe(QUALITY_PRESETS.low.renderScale);
  });

  it('refuses disabled or unknown choices', () => {
    const s = fresh();
    writeField(s, field('graphics.preset'), 'custom');
    expect(s.graphics.preset).toBe('medium');
    writeField(s, field('gameplay.hudColor'), 'purple');
    expect(s.gameplay.hudColor).toBe('green');
  });

  it('prefers the current preset when two presets match', () => {
    const s = fresh();
    Object.assign(s.graphics, QUALITY_PRESETS.high);
    s.graphics.preset = 'high';
    expect(derivePreset(s.graphics)).toBe('high');
    s.graphics.vegetation = QUALITY_PRESETS.ultra.vegetation;
    expect(derivePreset(s.graphics)).toBe('ultra');
  });
});
