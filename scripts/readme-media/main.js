/* global gsap */
/**
 * Deterministic composition: both models share one turntable and the timeline
 * is paused, so scripts/readme-media.js can render frame t with __frame(t).
 * The loop is seamless: the turntable makes exactly one turn per LOOP seconds.
 */
const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'gif';
const LOOP = Number(params.get('loop')) || 6;
document.documentElement.dataset.mode = mode;

const models = [...document.querySelectorAll('web-model')];
const [before, after] = models;
before.setAttribute('src', params.get('before') || '../../test-assets/bad-knot.glb');
after.setAttribute('src', params.get('after') || '../../.scratch/readme-media/bad-knot.glb');

const tl = gsap.timeline({ paused: true });
// A scan line sweeps across the optimized pane once per loop and is invisible at the seam.
tl.fromTo('[data-scan]', { xPercent: -100, opacity: 0 }, { xPercent: 360, duration: 2.2, ease: 'power2.inOut' }, 0.6)
  .to('[data-scan]', { opacity: 1, duration: 0.5, ease: 'power1.out' }, 0.6)
  .to('[data-scan]', { opacity: 0, duration: 0.6, ease: 'power1.in' }, 2.2)
  .set({}, {}, LOOP);

function frame(t) {
  tl.seek(t % LOOP, false);
  const azimuth = -30 + (360 * (t % LOOP)) / LOOP;
  for (const m of models) {
    m.camera.azimuth = azimuth;
    m.camera.polar = 72;
    m.renderOnce();
  }
}

window.__ready = (async () => {
  await customElements.whenDefined('web-model');
  await Promise.all(models.map((m) => m.ready));
  await document.fonts.ready;
  frame(mode === 'social' ? 0.9 : 0);
  return { loop: LOOP };
})();
window.__frame = frame;
