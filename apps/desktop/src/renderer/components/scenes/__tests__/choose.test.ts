import { describe, it, expect } from 'bun:test';
import type { LoginScene } from '@shared/types';
import { POOL, RANDOM, chooseScenes, formatPool, parsePool } from '../choose';

const scene = (id: string): LoginScene => ({ id, name: id, source: '', marks: 'square', fps: 1, cell: 4 });
const all = [scene('clouds'), scene('bridge'), scene('harbour/lighthouse')];
const ids = (list: readonly LoginScene[]): string[] => list.map((s) => s.id);

describe('chooseScenes', () => {
  it('random offers every scene', () => {
    expect(ids(chooseScenes(all, RANDOM, 'clouds'))).toEqual(['clouds', 'bridge', 'harbour/lighthouse']);
  });

  it('pool offers only the pooled scenes that are installed', () => {
    expect(ids(chooseScenes(all, POOL, 'harbour/lighthouse,gone/scene,clouds'))).toEqual(['clouds', 'harbour/lighthouse']);
  });

  it('an empty or stale pool falls back to every scene', () => {
    expect(chooseScenes(all, POOL, '')).toHaveLength(3);
    expect(chooseScenes(all, POOL, 'gone/scene')).toHaveLength(3);
  });

  it('one scene is shown alone, or every scene when it was removed', () => {
    expect(ids(chooseScenes(all, 'bridge', ''))).toEqual(['bridge']);
    expect(chooseScenes(all, 'koi/pond', '')).toHaveLength(3);
  });
});

describe('pool text', () => {
  it('round-trips ids, dropping blanks and repeats', () => {
    expect(parsePool(' clouds, ,harbour/lighthouse ')).toEqual(['clouds', 'harbour/lighthouse']);
    expect(formatPool(['clouds', 'bridge', 'clouds'])).toBe('clouds,bridge');
    expect(parsePool('')).toEqual([]);
  });
});
