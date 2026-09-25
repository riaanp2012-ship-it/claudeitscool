import type { AircraftId } from '../../core/types';
import type { JetDesign } from '../airframe';
import { borzoi } from './borzoi';
import { harrow } from './harrow';
import { kestrel } from './kestrel';
import { wyvern } from './wyvern';

/** Finished designs. Jets missing here fall back to the Kestrel airframe and report as unavailable. */
export const DESIGNS: Partial<Record<AircraftId, JetDesign>> = {
  kestrel,
  harrow,
  wyvern,
  borzoi,
};

export function designFor(id: AircraftId): JetDesign {
  return DESIGNS[id] ?? kestrel;
}

export function hasDesign(id: AircraftId): boolean {
  return DESIGNS[id] !== undefined;
}
