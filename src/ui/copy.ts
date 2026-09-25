/**
 * Menu copy (spec §8.7): short uppercase labels (upper-cased by CSS), plain sentence-case descriptions,
 * documentary tone, no exclamation marks.
 */
import type { HardpointKind } from '../core/types';

export interface MenuEntryCopy {
  id: 'campaign' | 'instant' | 'survival' | 'free' | 'training' | 'hangar' | 'settings' | 'credits';
  label: string;
  note: string;
  code: string;
  description: string;
  facts: readonly [string, string][];
}

export const MAIN_MENU: readonly MenuEntryCopy[] = [
  {
    id: 'campaign',
    label: 'Sortie',
    note: 'Campaign',
    code: 'OPERATION LOW TIDE',
    description:
      'Nine missions for Allied Coastal Command against the Varen Republic, from the first patrol over Kessel Strait to the last duel with their ace squadron.',
    facts: [
      ['Missions', '9'],
      ['Theaters', '4'],
    ],
  },
  {
    id: 'instant',
    label: 'Instant action',
    note: 'Dogfight',
    code: 'DOGFIGHT // CONFIGURABLE',
    description:
      'A single engagement on your terms: theater, aircraft, up to twelve bandits and seven wingmen, AI skill and weapons rules.',
    facts: [
      ['Bandits', '1–12'],
      ['Wingmen', '0–7'],
    ],
  },
  {
    id: 'survival',
    label: 'Survival',
    note: 'Endless waves',
    code: 'SURVIVAL // ONE AIRCRAFT',
    description: 'Endless escalating waves. One aircraft, repaired and rearmed between waves.',
    facts: [
      ['Waves', 'Endless'],
      ['Lives', '1'],
    ],
  },
  {
    id: 'free',
    label: 'Free flight',
    note: 'No threats',
    code: 'FREE FLIGHT // NO THREATS',
    description:
      'No enemies and no clock. Take off from the runway or start in the air, fly the ring course or practice on target drones.',
    facts: [
      ['Start', 'Runway or air'],
      ['Targets', 'Drones, rings'],
    ],
  },
  {
    id: 'training',
    label: 'Training',
    note: 'Academy',
    code: 'ACADEMY // 8 LESSONS',
    description:
      'Instructor-led lessons from basic handling to missile defense and ground attack. Medals are awarded for time and accuracy.',
    facts: [
      ['Lessons', '8'],
      ['Medals', 'Bronze to gold'],
    ],
  },
  {
    id: 'hangar',
    label: 'Hangar',
    note: 'Fleet',
    code: 'FLEET // 6 AIRFRAMES',
    description:
      'Every airframe in the fleet with its published performance figures. Choose the aircraft you fly; new types unlock with rank.',
    facts: [
      ['Airframes', '6'],
      ['Unlocks', 'By rank'],
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    note: 'Configuration',
    code: 'CONFIG // SAVED LOCALLY',
    description:
      'Graphics, controls, audio, gameplay and accessibility. Changes apply immediately and are saved in this browser.',
    facts: [
      ['Sections', '5'],
      ['Storage', 'This device'],
    ],
  },
  {
    id: 'credits',
    label: 'Credits',
    note: 'Licenses',
    code: 'CREDITS // LICENSES',
    description: 'Who made the game, and the typefaces and open-source libraries it is built on.',
    facts: [
      ['Typefaces', 'SIL OFL 1.1'],
      ['Libraries', 'MIT, Zlib'],
    ],
  },
];

/** Loading tips, written as pilot knowledge. */
export const TIPS: readonly string[] = [
  'Break into a missile, not away from it. Time the flares to the last two seconds.',
  'Speed is life. A slow jet is a target; trade altitude for airspeed before you need it.',
  'Corner speed gives the fastest turn. Above it you pull too many G; below it you bleed energy.',
  'Put the lead pip on the target and fire in short bursts. Most gun kills happen inside 600 meters.',
  'An IR missile wants a hot engine. From the rear quarter the tone is loud; head-on it may never lock.',
  'Radar missiles lose their lock when you beam them. Turn to put the threat at your three or nine o’clock.',
  'Never fly straight and level inside a SAM ring. Terrain masking beats every countermeasure.',
  'When the stall horn sounds, unload: push the nose down, then add power.',
  'Check your six after every kill. The wingman you did not see is the one that shoots.',
  'Bingo fuel means turn for home now, not after one more pass.',
  'Extend in afterburner to reset a fight you are losing, then come back with the energy advantage.',
  'Spike on the warning receiver means you are locked. A launch tone means it is already in the air.',
  'In the canyon, fly the shadow line. The radar cannot see what the rock hides.',
  'Fox Two is a heat seeker, Fox Three an active radar missile. Call it so your wingmen clear the lane.',
];

export interface BindingRow {
  action: string;
  keyboard: string;
  gamepad: string;
}

/** Default controls (spec §5.12). Shown read-only in Settings > Controls. */
export const DEFAULT_BINDINGS: readonly BindingRow[] = [
  { action: 'Aim / steer', keyboard: 'Mouse, or W S A D', gamepad: 'Left stick' },
  { action: 'Yaw', keyboard: 'Q / E', gamepad: 'LB / RB' },
  { action: 'Throttle up / down', keyboard: 'Shift / X', gamepad: 'RT / LT' },
  { action: 'Guns', keyboard: 'Left mouse', gamepad: 'X (hold)' },
  { action: 'Fire missile', keyboard: 'Right mouse / Space', gamepad: 'A' },
  { action: 'Cycle weapon', keyboard: 'Tab', gamepad: 'D-pad up' },
  { action: 'Lock / look at target', keyboard: 'T / hold C', gamepad: 'Y / hold Y' },
  { action: 'Flares / chaff', keyboard: 'F / G', gamepad: 'B / D-pad down' },
  { action: 'Camera / free look', keyboard: 'V / hold middle mouse', gamepad: 'View / right stick' },
  { action: 'Gear / airbrake / flaps', keyboard: 'L / B / K', gamepad: 'D-pad left / LT idle / D-pad right' },
  { action: 'Wingman commands', keyboard: '1 to 4', gamepad: 'Hold RB + face button' },
  { action: 'Map / scoreboard', keyboard: 'M', gamepad: 'Hold View' },
  { action: 'Pause', keyboard: 'Esc', gamepad: 'Start' },
  { action: 'HUD / performance overlay', keyboard: 'H / F3', gamepad: 'None' },
];

export interface CreditEntry {
  name: string;
  detail: string;
  license?: string;
}

export interface CreditSection {
  title: string;
  entries: readonly CreditEntry[];
}

export const CREDITS: readonly CreditSection[] = [
  {
    title: 'Production',
    entries: [
      {
        name: 'SPLASH ONE',
        detail:
          'Designed and built with Claude Code. Terrain, aircraft, effects and audio are generated at runtime.',
      },
      {
        name: 'Fiction',
        detail:
          'Allied Coastal Command, the Varen Republic, every aircraft, squadron and place are fictional. Any resemblance to real insignia is unintended.',
      },
    ],
  },
  {
    title: 'Typefaces',
    entries: [
      { name: 'Barlow Condensed', detail: 'The Barlow Project Authors, 2017', license: 'SIL OFL 1.1' },
      { name: 'IBM Plex Sans', detail: 'IBM Corp., 2019', license: 'SIL OFL 1.1' },
      { name: 'JetBrains Mono', detail: 'The JetBrains Mono Project Authors, 2020', license: 'SIL OFL 1.1' },
    ],
  },
  {
    title: 'Libraries',
    entries: [
      { name: 'three.js', detail: 'three.js authors, 2010–2026', license: 'MIT' },
      { name: 'postprocessing', detail: 'Raoul van Rüschen, 2015', license: 'Zlib' },
    ],
  },
];

/** Short labels for hardpoint stations in the hangar loadout strip. */
export const STORE_LABEL: Readonly<Record<HardpointKind, string>> = {
  srm: 'SRM',
  mrm: 'MRM',
  lraam: 'LRAAM',
  rocketPod: 'RKT',
  bomb: 'BOMB',
  agm: 'AGM',
  tank: 'TANK',
};

export const STORE_NAME: Readonly<Record<HardpointKind, string>> = {
  srm: 'Short-range IR missile',
  mrm: 'Medium-range radar missile',
  lraam: 'Long-range radar missile',
  rocketPod: 'Rocket pod',
  bomb: 'Guided bomb',
  agm: 'Air-to-ground missile',
  tank: 'Drop tank',
};

export const SKILL_LABEL = { rookie: 'Rookie', veteran: 'Veteran', ace: 'Ace' } as const;
export const WEAPONS_LABEL = { guns: 'Guns only', standard: 'Standard', unlimited: 'Unlimited' } as const;
export const MEDAL_LABEL = { none: 'No medal', bronze: 'Bronze', silver: 'Silver', gold: 'Gold' } as const;

/** Reason shown for a map the game reports as unavailable. */
export const MAP_UNAVAILABLE = 'This theater is not available in this build.';
export const LESSON_UNAVAILABLE = 'This lesson is not available in this build.';
export const unlockReason = (rank: number): string => `Unlocks at rank ${rank}.`;
