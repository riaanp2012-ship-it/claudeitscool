/**
 * Declarative description of every setting the Settings screen edits (pure; no DOM, no store).
 * The screen renders these and writes through `settings.update` / `settings.applyPreset`.
 */
import {
  QUALITY_PRESETS,
  type GraphicsSettings,
  type Preset,
  type Quality,
  type Settings,
} from '../core/settings';
import { formatPercent } from './format';

export type SettingsSection = 'graphics' | 'controls' | 'audio' | 'gameplay' | 'accessibility';

export const SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: 'graphics', label: 'Graphics' },
  { id: 'controls', label: 'Controls' },
  { id: 'audio', label: 'Audio' },
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'accessibility', label: 'Accessibility' },
];

export interface ChoiceOption {
  value: string;
  label: string;
  /** When set, the option is shown disabled and this sentence explains why. */
  disabled?: string;
  /** Optional token color swatch shown next to the label (for example the HUD color). */
  swatch?: string;
}

interface FieldBase {
  /** 'section.key' */
  id: string;
  section: SettingsSection;
  key: string;
  label: string;
  help: string;
}

export interface ChoiceField extends FieldBase {
  kind: 'choice';
  options: readonly ChoiceOption[];
  /** The quality preset selector: written through settings.applyPreset. */
  preset?: boolean;
}

export interface ToggleField extends FieldBase {
  kind: 'toggle';
}

export interface RangeField extends FieldBase {
  kind: 'range';
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}

export type SettingsField = ChoiceField | ToggleField | RangeField;
export type FieldValue = string | number | boolean;

type Keys<S extends SettingsSection> = Extract<keyof Settings[S], string>;

const bag = (s: Settings, section: SettingsSection): Record<string, unknown> =>
  s[section] as unknown as Record<string, unknown>;

function choice<S extends SettingsSection>(
  section: S,
  key: Keys<S>,
  label: string,
  help: string,
  options: readonly ChoiceOption[],
): ChoiceField {
  return { kind: 'choice', id: `${section}.${key}`, section, key, label, help, options };
}

function toggle<S extends SettingsSection>(
  section: S,
  key: Keys<S>,
  label: string,
  help: string,
): ToggleField {
  return { kind: 'toggle', id: `${section}.${key}`, section, key, label, help };
}

function range<S extends SettingsSection>(
  section: S,
  key: Keys<S>,
  label: string,
  help: string,
  min: number,
  max: number,
  step: number,
  format: (v: number) => string,
): RangeField {
  return { kind: 'range', id: `${section}.${key}`, section, key, label, help, min, max, step, format };
}

const pct = (v: number): string => formatPercent(v);
const lmh: readonly ChoiceOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const presetField: ChoiceField = {
  ...choice(
    'graphics',
    'preset',
    'Quality preset',
    'Sets every quality option below at once. Changing a single option switches the preset to Custom.',
    [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'ultra', label: 'Ultra' },
      {
        value: 'custom',
        label: 'Custom',
        disabled: 'Selected automatically when an individual quality option differs from every preset.',
      },
    ],
  ),
  preset: true,
};

export const FIELDS: Readonly<Record<SettingsSection, readonly SettingsField[]>> = {
  graphics: [
    presetField,
    range(
      'graphics',
      'renderScale',
      'Render scale',
      'Resolution of the 3D scene relative to the screen. Menus and the HUD always draw at full resolution.',
      0.5,
      1,
      0.05,
      pct,
    ),
    toggle(
      'graphics',
      'adaptive',
      'Adaptive resolution',
      'Lowers the render scale during heavy scenes to hold 60 frames per second, and raises it again when there is headroom.',
    ),
    choice('graphics', 'shadows', 'Shadows', 'Shadow detail for aircraft, structures and terrain.', [
      { value: 'off', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
    ]),
    choice('graphics', 'clouds', 'Clouds', 'Cloud layer resolution and the number of cloud layers.', lmh),
    choice(
      'graphics',
      'terrain',
      'Terrain detail',
      'Terrain mesh density and view distance for ground detail.',
      lmh,
    ),
    range(
      'graphics',
      'vegetation',
      'Vegetation density',
      'Trees, rocks and ground props. Lower values thin out forests far from the aircraft first.',
      0,
      1,
      0.05,
      pct,
    ),
    choice(
      'graphics',
      'effects',
      'Effects',
      'Particle counts for smoke, explosions, debris and trails.',
      lmh,
    ),
    toggle('graphics', 'antialias', 'Anti-aliasing', 'Smooths jagged edges on aircraft and terrain (SMAA).'),
    toggle('graphics', 'bloom', 'Bloom', 'Glow around the sun, afterburners, flares and explosions.'),
    range(
      'graphics',
      'fov',
      'Field of view',
      'Camera field of view in degrees. Wider shows more of the sky; narrower makes distant aircraft larger.',
      60,
      100,
      1,
      (v) => `${Math.round(v)}°`,
    ),
    toggle('graphics', 'showFps', 'Show frame rate', 'Frame rate counter in the top corner of the screen.'),
  ],
  controls: [
    choice(
      'controls',
      'scheme',
      'Control scheme',
      'Mouse aim: point where you want to fly and the flight computer steers there. Direct: the mouse moves the stick.',
      [
        { value: 'mouse', label: 'Mouse aim' },
        { value: 'direct', label: 'Direct' },
      ],
    ),
    range(
      'controls',
      'sensitivity',
      'Sensitivity',
      'Mouse and stick response. Applies to aiming, free look and direct control.',
      0.2,
      3,
      0.1,
      (v) => `${v.toFixed(1)}×`,
    ),
    toggle(
      'controls',
      'invertPitch',
      'Invert pitch',
      'Swaps pitch up and pitch down for the mouse and the stick.',
    ),
    range(
      'controls',
      'deadzone',
      'Stick deadzone',
      'Radial deadzone for gamepad sticks. Raise it if the aircraft drifts with the stick released.',
      0,
      0.4,
      0.01,
      pct,
    ),
  ],
  audio: [
    range('audio', 'master', 'Master volume', 'Overall output level.', 0, 1, 0.05, pct),
    range('audio', 'music', 'Music', 'Menu music level.', 0, 1, 0.05, pct),
    range(
      'audio',
      'effects',
      'Effects',
      'Engines, weapons, explosions, wind and cockpit warning tones.',
      0,
      1,
      0.05,
      pct,
    ),
    range('audio', 'radio', 'Radio', 'Wingman, controller and instructor radio calls.', 0, 1, 0.05, pct),
    range('audio', 'ui', 'Interface', 'Menu navigation and confirmation sounds.', 0, 1, 0.05, pct),
    toggle(
      'audio',
      'muteUnfocused',
      'Mute in background',
      'Silences the game while its window or tab does not have focus.',
    ),
  ],
  gameplay: [
    choice(
      'gameplay',
      'flightModel',
      'Flight model',
      'Standard keeps stall and over-G protection. Sim removes the limiters: the aircraft can depart controlled flight.',
      [
        { value: 'standard', label: 'Standard' },
        { value: 'sim', label: 'Sim' },
      ],
    ),
    choice('gameplay', 'units', 'Units', 'Speed and altitude units on the HUD and in the hangar.', [
      { value: 'imperial', label: 'kt / ft' },
      { value: 'metric', label: 'km/h / m' },
    ]),
    choice('gameplay', 'hudColor', 'HUD color', 'Symbol color of the head-up display.', [
      { value: 'green', label: 'Green', swatch: 'var(--hud-green)' },
      { value: 'amber', label: 'Amber', swatch: 'var(--hud-amber)' },
      { value: 'white', label: 'White', swatch: 'var(--hud-white)' },
    ]),
    toggle(
      'gameplay',
      'killCam',
      'Kill cam',
      'A short slow-motion view of each kill. Any flight input skips it.',
    ),
    toggle('gameplay', 'autoLevel', 'Auto-level', 'Rolls the wings level when the controls are released.'),
    toggle(
      'gameplay',
      'subtitles',
      'Radio subtitles',
      'Shows every radio call as text at the bottom of the screen.',
    ),
    toggle(
      'gameplay',
      'autoFlares',
      'Auto countermeasures',
      'Releases flares and chaff automatically when a missile is inbound.',
    ),
  ],
  accessibility: [
    range(
      'accessibility',
      'uiScale',
      'Interface scale',
      'Size of menus and text. Applies immediately; on small screens it is limited so nothing overlaps.',
      0.8,
      1.4,
      0.05,
      pct,
    ),
    choice(
      'accessibility',
      'colorblind',
      'Colorblind mode',
      'Adjusts friend, foe and warning colors for protanopia, deuteranopia or tritanopia. Shapes always differ as well.',
      [
        { value: 'off', label: 'Off' },
        { value: 'protan', label: 'Protan' },
        { value: 'deutan', label: 'Deutan' },
        { value: 'tritan', label: 'Tritan' },
      ],
    ),
    range(
      'accessibility',
      'shake',
      'Camera shake',
      'Strength of camera shake from gunfire, explosions, turbulence and high G.',
      0,
      1,
      0.05,
      pct,
    ),
    toggle(
      'accessibility',
      'reduceFlashes',
      'Reduce flashes',
      'Dims explosion and muzzle flashes and keeps warning blinks below 3 Hz.',
    ),
  ],
};

export function readField(s: Settings, f: SettingsField): FieldValue {
  const v = bag(s, f.section)[f.key];
  if (f.kind === 'toggle') return v === true;
  if (f.kind === 'range') return typeof v === 'number' ? v : f.min;
  return typeof v === 'string' ? v : String(v);
}

/** Graphics keys a quality preset controls; changing one of these can change the preset. */
export const PRESET_KEYS = Object.keys(
  QUALITY_PRESETS.medium,
) as (keyof (typeof QUALITY_PRESETS)['medium'])[];

/** The preset whose values all match `g`, or 'custom'. The current preset wins ties (High and Ultra). */
export function derivePreset(g: GraphicsSettings): Preset {
  const matches = (q: Quality): boolean => PRESET_KEYS.every((k) => g[k] === QUALITY_PRESETS[q][k]);
  if (g.preset !== 'custom' && matches(g.preset)) return g.preset;
  for (const q of ['low', 'medium', 'high', 'ultra'] as const) if (matches(q)) return q;
  return 'custom';
}

/**
 * Writes one field into a Settings draft (inside settings.update). Graphics quality options keep the
 * preset honest: the preset becomes Custom as soon as the values stop matching it.
 */
export function writeField(s: Settings, f: SettingsField, value: FieldValue): void {
  if (f.kind === 'choice' && f.preset) {
    const q = value as Quality;
    if (q in QUALITY_PRESETS) {
      Object.assign(s.graphics, QUALITY_PRESETS[q]);
      s.graphics.preset = q;
    }
    return;
  }
  if (f.kind === 'choice' && !f.options.some((o) => o.value === value && !o.disabled)) return;
  bag(s, f.section)[f.key] = value;
  if (f.section === 'graphics' && (PRESET_KEYS as readonly string[]).includes(f.key)) {
    s.graphics.preset = derivePreset(s.graphics);
  }
}
