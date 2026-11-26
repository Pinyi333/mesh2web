/**
 * Helpers for the `environment` and `tone-mapping` attributes. Kept free of
 * three.js so the element shell can use them and tests can run in Node.
 */

export const TONE_MAPPINGS = ['aces', 'agx', 'neutral', 'none'];

/**
 * How an environment URL should be decoded: Radiance `.hdr` files go through
 * the HDR loader, everything else (JPG, PNG, WebP, AVIF) is a plain image.
 * @param {string} url
 * @returns {'hdr' | 'image' | null}
 */
export function environmentKind(url) {
  const value = String(url || '').trim();
  if (!value) return null;
  const path = value.split(/[?#]/)[0];
  return /\.hdr$/i.test(path) ? 'hdr' : 'image';
}

/**
 * Normalize a `tone-mapping` attribute value. Unknown values return null,
 * meaning "use the lighting preset's tone mapping".
 * @param {string | null | undefined} value
 * @returns {'aces' | 'agx' | 'neutral' | 'none' | null}
 */
export function parseToneMapping(value) {
  const name = String(value ?? '').trim().toLowerCase();
  return TONE_MAPPINGS.includes(name) ? /** @type {any} */ (name) : null;
}
