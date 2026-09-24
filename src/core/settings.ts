import { readJson, sanitize, writeJson } from './storage';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type Preset = Quality | 'custom';

export interface GraphicsSettings {
  preset: Preset;
  renderScale: number; // 0.5..1
  adaptive: boolean;
  shadows: 'off' | 'low' | 'high';
  clouds: 'low' | 'medium' | 'high';
  terrain: 'low' | 'medium' | 'high';
  vegetation: number; // 0..1 density
  effects: 'low' | 'medium' | 'high';
  antialias: boolean;
  bloom: boolean;
  fov: number;
  showFps: boolean;
}

export interface Settings {
  version: number;
  graphics: GraphicsSettings;
  controls: {
    scheme: 'mouse' | 'direct';
    sensitivity: number; // 0.2..3
    invertPitch: boolean;
    deadzone: number; // 0..0.4
    bindings: Record<string, string[]>;
  };
  audio: {
    master: number;
    music: number;
    effects: number;
    radio: number;
    ui: number;
    muteUnfocused: boolean;
  };
  gameplay: {
    flightModel: 'standard' | 'sim';
    units: 'imperial' | 'metric';
    hudColor: 'green' | 'amber' | 'white';
    killCam: boolean;
    autoLevel: boolean;
    subtitles: boolean;
    autoFlares: boolean;
  };
  accessibility: {
    uiScale: number; // 0.8..1.4
    colorblind: 'off' | 'protan' | 'deutan' | 'tritan';
    shake: number; // 0..1
    reduceFlashes: boolean;
  };
}

export const QUALITY_PRESETS: Record<
  Quality,
  Omit<GraphicsSettings, 'preset' | 'fov' | 'showFps' | 'adaptive'>
> = {
  low: {
    renderScale: 0.75,
    shadows: 'off',
    clouds: 'low',
    terrain: 'low',
    vegetation: 0.35,
    effects: 'low',
    antialias: false,
    bloom: false,
  },
  medium: {
    renderScale: 0.9,
    shadows: 'low',
    clouds: 'medium',
    terrain: 'medium',
    vegetation: 0.6,
    effects: 'medium',
    antialias: true,
    bloom: true,
  },
  high: {
    renderScale: 1,
    shadows: 'high',
    clouds: 'high',
    terrain: 'high',
    vegetation: 0.85,
    effects: 'high',
    antialias: true,
    bloom: true,
  },
  ultra: {
    renderScale: 1,
    shadows: 'high',
    clouds: 'high',
    terrain: 'high',
    vegetation: 1,
    effects: 'high',
    antialias: true,
    bloom: true,
  },
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  graphics: { preset: 'medium', ...QUALITY_PRESETS.medium, adaptive: true, fov: 70, showFps: false },
  controls: { scheme: 'mouse', sensitivity: 1, invertPitch: false, deadzone: 0.12, bindings: {} },
  audio: { master: 0.8, music: 0.5, effects: 0.9, radio: 0.8, ui: 0.6, muteUnfocused: true },
  gameplay: {
    flightModel: 'standard',
    units: 'imperial',
    hudColor: 'green',
    killCam: true,
    autoLevel: false,
    subtitles: true,
    autoFlares: false,
  },
  accessibility: { uiScale: 1, colorblind: 'off', shake: 1, reduceFlashes: false },
};

const KEY = 'splash1.settings';
type Listener = (s: Settings) => void;

class SettingsStore {
  private current: Settings;
  private listeners: Listener[] = [];

  constructor() {
    this.current = sanitize(DEFAULT_SETTINGS, readJson(KEY));
  }

  get value(): Settings {
    return this.current;
  }

  update(mutator: (s: Settings) => void): void {
    const next = structuredClone(this.current);
    mutator(next);
    this.current = sanitize(DEFAULT_SETTINGS, next);
    writeJson(KEY, this.current);
    for (const l of this.listeners) l(this.current);
  }

  applyPreset(preset: Quality): void {
    this.update((s) => {
      Object.assign(s.graphics, QUALITY_PRESETS[preset]);
      s.graphics.preset = preset;
    });
  }

  reset(section: Exclude<keyof Settings, 'version'>): void {
    this.update((s) => {
      (s as unknown as Record<string, unknown>)[section] = structuredClone(DEFAULT_SETTINGS[section]);
    });
  }

  onChange(l: Listener): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }
}

export const settings = new SettingsStore();
