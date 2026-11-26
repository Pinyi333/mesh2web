import { describe, expect, it } from 'vitest';
import { OrbitState } from '../src/controls.js';
import { pickSource, lowerTier } from '../src/quality.js';
import { environmentKind, parseToneMapping } from '../src/environment.js';

describe('pickSource', () => {
  it('chooses LODs by tier', () => {
    const lods = ['a.lod1.glb', 'a.lod2.glb'];
    expect(pickSource('a.glb', lods, 'high')).toBe('a.glb');
    expect(pickSource('a.glb', lods, 'medium')).toBe('a.lod1.glb');
    expect(pickSource('a.glb', lods, 'low')).toBe('a.lod2.glb');
    expect(pickSource('a.glb', [], 'low')).toBe('a.glb');
  });
  it('lowers tiers down to null', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('low')).toBe(null);
  });
});

describe('OrbitState', () => {
  it('applies and damps inertia within limits', () => {
    const o = new OrbitState();
    o.vPolar = 500;
    expect(o.step()).toBe(true);
    expect(o.polar).toBe(o.maxPolar);
    let frames = 0;
    while (o.step() && frames < 1000) frames++;
    expect(frames).toBeLessThan(1000);
    expect(o.vPolar).toBe(0);
  });
});

describe('environment helpers', () => {
  it('detects .hdr environments, ignoring query and hash', () => {
    expect(environmentKind('studio.hdr')).toBe('hdr');
    expect(environmentKind('/env/Studio.HDR?v=2#x')).toBe('hdr');
    expect(environmentKind('studio.jpg')).toBe('image');
    expect(environmentKind('https://cdn.example/hdr/studio.webp')).toBe('image');
    expect(environmentKind('')).toBe(null);
    expect(environmentKind(null)).toBe(null);
  });
  it('accepts only known tone mappings', () => {
    expect(parseToneMapping('ACES')).toBe('aces');
    expect(parseToneMapping(' none ')).toBe('none');
    expect(parseToneMapping('filmic')).toBe(null);
    expect(parseToneMapping(null)).toBe(null);
  });
});
