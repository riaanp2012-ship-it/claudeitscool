import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createAudio, overrideSfx } from '../../src/audio/index';
import { PATCHES, PATCH_IDS, CATEGORY_LIMITS, MAX_SFX_VOICES } from '../../src/audio/patches';
import type { SfxId } from '../../src/core/types';

const ALL_SFX: SfxId[] = [
  'missileLaunch',
  'rocketLaunch',
  'bombRelease',
  'explosionSmall',
  'explosionLarge',
  'explosionGround',
  'explosionWater',
  'hitMetal',
  'hitTaken',
  'flare',
  'chaff',
  'gearMove',
  'canopy',
  'sonicBoom',
  'touchdown',
  'crash',
  'checkpoint',
  'medal',
  'killConfirm',
  'uiHover',
  'uiConfirm',
  'uiBack',
  'uiError',
  'uiToggle',
];

describe('AudioSystem before unlock (ZD-I01)', () => {
  it('every method is a safe no-op without Web Audio', async () => {
    const a = createAudio();
    expect(a.unlocked).toBe(false);
    const p = new Vector3(1, 2, 3);
    a.setVolumes({ master: 0.5, music: 0.5, effects: 0.5, radio: 0.5, ui: 0.5 });
    a.setListener(p, new Quaternion(), new Vector3());
    a.setPaused(true);
    a.setPaused(false);
    a.setMuted(true);
    a.setMuted(false);
    const e = a.createEngine(true);
    e.set({
      throttle: 1,
      afterburner: 1,
      speed: 300,
      mach: 0.9,
      g: 8,
      aoa: 0.2,
      position: p,
      velocity: p,
      cockpit: true,
      damaged: 0.5,
    });
    const g = a.createGun('gun25', false);
    g.setFiring(true, p, p);
    for (const id of ALL_SFX) a.play(id, { position: p, velocity: p, volume: 1, pitch: 1 });
    a.setCockpitTones({
      seeker: 'locked',
      radarLock: true,
      rwr: 'launch',
      missileWarning: true,
      stall: true,
      pullUp: true,
      g: 9,
    });
    a.radio();
    a.setMenuMusic(true);
    a.update(1 / 60);
    a.stopAll();
    e.dispose();
    g.dispose();
    await a.unlock();
    await a.unlock();
    expect(a.unlocked).toBe(false);
    a.dispose();
    a.dispose();
    await expect(overrideSfx(a, 'uiHover', new ArrayBuffer(8))).resolves.toBe(false);
  });
});

describe('SFX registry', () => {
  it('has a patch for every SfxId plus the radio squelch', () => {
    for (const id of ALL_SFX) expect(PATCHES[id]).toBeDefined();
    expect(PATCHES.radio).toBeDefined();
    expect(PATCH_IDS.length).toBe(ALL_SFX.length + 1);
  });

  it('keeps UI sounds rate limited, quiet and never spatialized', () => {
    for (const id of ['uiHover', 'uiConfirm', 'uiBack', 'uiError', 'uiToggle'] as const) {
      const p = PATCHES[id];
      expect(p.bus).toBe('ui');
      expect(p.spatial).toBeNull();
      expect(p.minInterval).toBeGreaterThanOrEqual(0.04);
      expect(p.gain).toBeLessThanOrEqual(0.8);
    }
  });

  it('gives every patch a valid category under the voice caps', () => {
    for (const id of PATCH_IDS) {
      const p = PATCHES[id];
      expect(CATEGORY_LIMITS[p.category]).toBeGreaterThan(0);
    }
    expect(CATEGORY_LIMITS.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(MAX_SFX_VOICES);
  });
});
