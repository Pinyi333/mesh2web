/**
 * Device tiering for adaptive quality. Kept free of three.js so the element
 * shell can decide which LOD to fetch before the renderer chunk loads.
 *
 * Tiers: 'high' | 'medium' | 'low'.
 */

const LOW_GPU = /(mali-[24]|mali-t|adreno \(tm\) [2-5]\d\d|powervr|sgx|swiftshader|llvmpipe|software|intel\(r\) hd graphics [2-5])/i;
const HIGH_GPU = /(apple m\d|apple gpu|nvidia|geforce|radeon rx|rtx|adreno \(tm\) [7-9]\d\d)/i;

/** @returns {string} */
function gpuRenderer() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(name || '');
  } catch {
    return '';
  }
}

let cached;

/**
 * Estimate the device tier from GPU name, CPU cores, memory and screen.
 * Result is cached for the page lifetime.
 * @returns {'high' | 'medium' | 'low'}
 */
export function detectTier() {
  if (cached) return cached;
  const gpu = gpuRenderer();
  const cores = navigator.hardwareConcurrency || 4;
  const memory = /** @type {any} */ (navigator).deviceMemory || 4;
  const saveData = /** @type {any} */ (navigator).connection?.saveData === true;
  const mobile = matchMedia('(pointer: coarse)').matches;

  let score = 0;
  if (HIGH_GPU.test(gpu)) score += 2;
  if (LOW_GPU.test(gpu)) score -= 3;
  if (cores >= 8) score += 1; else if (cores <= 4) score -= 1;
  if (memory >= 8) score += 1; else if (memory <= 2) score -= 2;
  if (mobile) score -= 1;
  if (saveData) score -= 3;

  cached = score >= 2 ? 'high' : score >= 0 ? 'medium' : 'low';
  return cached;
}

/** Whether WebGL is available at all. */
export function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch {
    return false;
  }
}

/** Max device pixel ratio per tier. */
export const PIXEL_RATIO = { high: 2, medium: 1.5, low: 1 };

/** Next lower tier, or null at the bottom. */
export const lowerTier = (tier) => ({ high: 'medium', medium: 'low', low: null }[tier]);

/**
 * Pick a source URL for a tier.
 * @param {string} src            Full-detail model.
 * @param {string[]} lods         Lower-detail variants, highest first.
 * @param {'high' | 'medium' | 'low'} tier
 */
export function pickSource(src, lods, tier) {
  if (!lods.length || tier === 'high') return src;
  if (tier === 'medium') return lods[0];
  return lods[lods.length - 1];
}
