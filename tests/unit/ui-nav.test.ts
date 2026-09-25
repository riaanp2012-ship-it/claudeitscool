import { describe, expect, it } from 'vitest';
import {
  firstEnabled,
  initialPos,
  moveCol,
  moveRow,
  nearestEnabled,
  stepIndex,
  validate,
  type NavShape,
} from '../../src/ui/nav-model';
import { countsAsAnyKey, keyToAction, RepeatGate } from '../../src/ui/keymap';

describe('stepIndex', () => {
  const list = [true, false, true, true, false];

  it('skips disabled items in both directions', () => {
    expect(stepIndex(list, 0, 1, false)).toBe(2);
    expect(stepIndex(list, 2, -1, false)).toBe(0);
    expect(stepIndex(list, 2, 1, false)).toBe(3);
  });

  it('stops at the ends without wrap', () => {
    expect(stepIndex(list, 3, 1, false)).toBe(3);
    expect(stepIndex(list, 0, -1, false)).toBe(0);
  });

  it('wraps past the ends and still skips disabled items', () => {
    expect(stepIndex(list, 3, 1, true)).toBe(0);
    expect(stepIndex(list, 0, -1, true)).toBe(3);
  });

  it('stays put when nothing else is enabled', () => {
    expect(stepIndex([false, true, false], 1, 1, true)).toBe(1);
    expect(stepIndex([false, false], 0, 1, true)).toBe(-1);
    expect(stepIndex([], 0, 1, true)).toBe(-1);
  });

  it('starts from -1 (no focus yet)', () => {
    expect(stepIndex([false, true], -1, 1, false)).toBe(1);
  });
});

describe('firstEnabled / nearestEnabled', () => {
  it('finds the first enabled entry from a preferred index', () => {
    expect(firstEnabled([false, false, true])).toBe(2);
    expect(firstEnabled([true, false, true], 1)).toBe(2);
    expect(firstEnabled([true, false, false], 1)).toBe(0);
    expect(firstEnabled([false])).toBe(-1);
  });

  it('keeps the column when moving between rows of different widths', () => {
    expect(nearestEnabled([true, true, true], 5)).toBe(2);
    expect(nearestEnabled([true, false, true], 1)).toBe(0);
    expect(nearestEnabled([false, false], 0)).toBe(-1);
  });
});

describe('grid navigation', () => {
  // row 0: one item, row 1: disabled row, row 2: one item, row 3: button group with a disabled middle
  const shape: NavShape = [[true], [false], [true], [true, false, true]];

  it('picks the first enabled cell initially, or the preferred one', () => {
    expect(initialPos(shape)).toEqual({ row: 0, col: 0 });
    expect(initialPos(shape, { row: 3, col: 2 })).toEqual({ row: 3, col: 2 });
    expect(initialPos(shape, { row: 1, col: 0 })).toEqual({ row: 0, col: 0 });
    expect(initialPos([[false]])).toBeNull();
  });

  it('skips disabled rows vertically and wraps', () => {
    expect(moveRow(shape, { row: 0, col: 0 }, 1, true)).toEqual({ row: 2, col: 0 });
    expect(moveRow(shape, { row: 2, col: 0 }, -1, true)).toEqual({ row: 0, col: 0 });
    expect(moveRow(shape, { row: 3, col: 2 }, 1, true)).toEqual({ row: 0, col: 0 });
    expect(moveRow(shape, { row: 0, col: 0 }, -1, true)).toEqual({ row: 3, col: 0 });
    expect(moveRow(shape, { row: 0, col: 0 }, -1, false)).toEqual({ row: 0, col: 0 });
  });

  it('moves horizontally inside a row, skipping disabled cells, without wrapping', () => {
    expect(moveCol(shape, { row: 3, col: 0 }, 1)).toEqual({ row: 3, col: 2 });
    expect(moveCol(shape, { row: 3, col: 2 }, 1)).toEqual({ row: 3, col: 2 });
    expect(moveCol(shape, { row: 3, col: 2 }, -1)).toEqual({ row: 3, col: 0 });
    expect(moveCol(shape, { row: 0, col: 0 }, 1)).toEqual({ row: 0, col: 0 });
  });

  it('revalidates focus when the focused item becomes disabled', () => {
    const next: NavShape = [[true], [false], [false], [true, false, true]];
    expect(validate(next, { row: 2, col: 0 })).toEqual({ row: 3, col: 0 });
    expect(validate(next, { row: 3, col: 1 })).toEqual({ row: 3, col: 0 });
    expect(validate(next, { row: 0, col: 0 })).toEqual({ row: 0, col: 0 });
  });
});

describe('keyboard map', () => {
  it('maps arrows and WASD consistently', () => {
    expect(keyToAction('ArrowUp')).toBe('up');
    expect(keyToAction('KeyW')).toBe('up');
    expect(keyToAction('KeyS')).toBe('down');
    expect(keyToAction('KeyA')).toBe('left');
    expect(keyToAction('ArrowRight')).toBe('right');
  });

  it('maps confirm, back and tabs', () => {
    expect(keyToAction('Enter')).toBe('confirm');
    expect(keyToAction('Space')).toBe('confirm');
    expect(keyToAction('Escape')).toBe('back');
    expect(keyToAction('Backspace')).toBe('back');
    expect(keyToAction('KeyQ')).toBe('tabPrev');
    expect(keyToAction('KeyE')).toBe('tabNext');
    expect(keyToAction('Tab')).toBe('down');
    expect(keyToAction('Tab', true)).toBe('up');
    expect(keyToAction('KeyZ')).toBeNull();
  });

  it('does not treat modifiers or function keys as "any key"', () => {
    expect(countsAsAnyKey('ShiftLeft')).toBe(false);
    expect(countsAsAnyKey('F5')).toBe(false);
    expect(countsAsAnyKey('KeyK')).toBe(true);
    expect(countsAsAnyKey('Escape')).toBe(true);
  });
});

describe('RepeatGate', () => {
  it('fires on press, waits for the delay, then repeats at the interval', () => {
    const g = new RepeatGate(400, 100);
    expect(g.update(true, 0)).toBe(true);
    expect(g.update(true, 200)).toBe(false);
    expect(g.update(true, 399)).toBe(false);
    expect(g.update(true, 400)).toBe(true);
    expect(g.update(true, 450)).toBe(false);
    expect(g.update(true, 500)).toBe(true);
    expect(g.update(false, 510)).toBe(false);
    expect(g.update(true, 520)).toBe(true);
  });

  it('ignores an input already held when latched until it is released', () => {
    const g = new RepeatGate(400, 100);
    g.latch(0);
    expect(g.update(true, 16)).toBe(false);
    expect(g.update(true, 2000)).toBe(false);
    expect(g.update(false, 2016)).toBe(false);
    expect(g.update(true, 2032)).toBe(true);
  });
});
