/**
 * AR hand-off for `<web-model>`. No WebXR session and no extra download: the
 * model is handed to the platform's own AR viewer.
 *   - iOS / iPadOS Safari: AR Quick Look (USDZ, from `ios-src` or built on demand)
 *   - Android: Google Scene Viewer (GLB, from `ar-src` or `src`)
 * Kept out of viewer.js so the button can appear before three.js loads.
 */

/** @typedef {'quick-look' | 'scene-viewer'} ARMode */

/**
 * Which AR viewer this device can open, or null.
 * @param {{ userAgent?: string, quickLook?: boolean }} [env]  Overrides for tests.
 * @returns {ARMode | null}
 */
export function detectARMode(env = {}) {
  if (typeof document === 'undefined' && env.quickLook === undefined) return null;
  const quickLook = env.quickLook ?? !!document.createElement('a').relList?.supports?.('ar');
  if (quickLook) return 'quick-look';
  const ua = env.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  // Scene Viewer ships with Google Play Services for AR; Firefox and headset
  // browsers cannot open the intent.
  if (/android/i.test(ua) && !/firefox|oculus|quest|xr/i.test(ua)) return 'scene-viewer';
  return null;
}

/**
 * Build the Android intent URL that opens Scene Viewer in AR mode.
 * https://developers.google.com/ar/develop/scene-viewer
 * @param {string} modelUrl   Absolute URL of a GLB (Scene Viewer fetches it itself).
 * @param {{ title?: string, placement?: string, scale?: string, fallbackUrl?: string }} [opts]
 */
export function sceneViewerIntent(modelUrl, { title, placement, scale, fallbackUrl } = {}) {
  const params = new URLSearchParams({ file: modelUrl, mode: 'ar_preferred' });
  if (title) params.set('title', title);
  if (placement === 'wall') params.set('enable_vertical_placement', 'true');
  if (scale === 'fixed') params.set('resizable', 'false');
  const extras = fallbackUrl ? `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};` : '';
  return `intent://arvr.google.com/scene-viewer/1.0?${params}#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;${extras}end;`;
}

/**
 * Open AR Quick Look. Safari only intercepts a click on an `<a rel="ar">`
 * whose first child is an image.
 * @param {string} usdzUrl
 * @param {{ scale?: string }} [opts]
 */
export function openQuickLook(usdzUrl, { scale } = {}) {
  const anchor = document.createElement('a');
  anchor.rel = 'ar';
  anchor.href = scale === 'fixed' ? `${usdzUrl}#allowsContentScaling=0` : usdzUrl;
  anchor.appendChild(document.createElement('img'));
  anchor.click();
}
