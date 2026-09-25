import { createAircraftModel, createOrdnanceModel, isAircraftAvailable } from './art';
import { createAudio } from './audio';
import { createFx } from './fx';
import { Game } from './game';
import { createHud } from './hud';
import { createUi, loadFonts } from './ui';
import { createWorld, isMapAvailable } from './world';

/**
 * Entry point: global error reporting, then boot the game with every module wired in.
 */
const app = document.getElementById('app');
if (!app) throw new Error('Missing #app container');

const game = new Game(app, {
  createWorld,
  isMapAvailable,
  createAircraftModel,
  createOrdnanceModel,
  isAircraftAvailable,
  createFx,
  createAudio,
  createHud,
  createUi,
  loadFonts,
});

void game.boot();
