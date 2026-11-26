import { describe, expect, it } from 'vitest';
import { OrbitState } from '../src/controls.js';
import { pickSource, lowerTier } from '../src/quality.js';

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

describe('AR', async () => {
  const { detectARMode, sceneViewerIntent } = await import('../src/ar.js');

  it('detects the platform AR viewer', () => {
    expect(detectARMode({ quickLook: true, userAgent: '' })).toBe('quick-look');
    expect(detectARMode({ quickLook: false, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131' })).toBe('scene-viewer');
    expect(detectARMode({ quickLook: false, userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Firefox/131' })).toBe(null);
    expect(detectARMode({ quickLook: false, userAgent: 'Mozilla/5.0 (Macintosh) Chrome/131' })).toBe(null);
  });

  it('builds a Scene Viewer intent', () => {
    const url = sceneViewerIntent('https://example.com/m/a b.glb', { title: 'Chair', placement: 'wall', scale: 'fixed', fallbackUrl: 'https://example.com/p' });
    expect(url.startsWith('intent://arvr.google.com/scene-viewer/1.0?')).toBe(true);
    const query = new URLSearchParams(url.slice(url.indexOf('?') + 1, url.indexOf('#')));
    expect(query.get('file')).toBe('https://example.com/m/a b.glb');
    expect(query.get('mode')).toBe('ar_preferred');
    expect(query.get('enable_vertical_placement')).toBe('true');
    expect(query.get('resizable')).toBe('false');
    expect(url).toContain('package=com.google.ar.core');
    expect(url).toContain(`S.browser_fallback_url=${encodeURIComponent('https://example.com/p')};end;`);
  });
});
