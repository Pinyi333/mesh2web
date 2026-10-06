import optimize from './optimize.json' with { type: 'json' };
import lighting from './lighting.json' with { type: 'json' };

/** Optimization presets keyed by name: `hero`, `product`, `ambient`. */
export const optimizePresets = optimize;

/** Lighting presets keyed by name: `studio-soft`, `studio-hard`, `outdoor`, `neon`, `flat`. */
export const lightingPresets = lighting;

export const DEFAULT_OPTIMIZE_PRESET = 'product';
export const DEFAULT_LIGHTING_PRESET = 'studio-soft';
