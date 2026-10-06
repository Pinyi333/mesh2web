/**
 * GSAP ScrollTrigger bridge for `<web-model>`.
 * GSAP is a peer: pass your own `gsap` instance (with ScrollTrigger registered),
 * so pages that do not use GSAP never download it.
 *
 * @example
 * import { gsap } from 'gsap';
 * import { ScrollTrigger } from 'gsap/ScrollTrigger';
 * import { scrollModel } from '@mesh2web/element/gsap';
 * gsap.registerPlugin(ScrollTrigger);
 * scrollModel(gsap, document.querySelector('web-model'), {
 *   scrollTrigger: { trigger: '#story', start: 'top top', end: '+=2000', scrub: true, pin: true },
 *   steps: [
 *     { camera: { azimuth: 180, distance: 4 } },
 *     { animation: { progress: 1 }, at: 0 },
 *     { exposure: 1.4, at: 0.5 },
 *   ],
 * });
 */

/**
 * @typedef {Object} ScrollStep
 * @property {{ azimuth?: number, polar?: number, distance?: number, fov?: number }} [camera]
 * @property {{ progress?: number }} [animation]
 * @property {number} [exposure]
 * @property {number | string} [at]      Timeline position (GSAP position parameter).
 * @property {number} [duration]
 * @property {string} [ease]
 */

/**
 * Build a scroll-linked timeline driving the model's camera, animation and
 * exposure. Waits for the model to load; returns the timeline promise.
 * With `prefers-reduced-motion`, the timeline is still created (scrolling is
 * user-driven) but `scrub` smoothing is disabled so nothing animates on its own.
 *
 * @param {any} gsap
 * @param {import('./web-model.js').WebModel} model
 * @param {{ scrollTrigger: Record<string, any>, steps: ScrollStep[], defaults?: Record<string, any> }} options
 */
export async function scrollModel(gsap, model, { scrollTrigger, steps, defaults = { ease: 'none' } }) {
  if (!gsap?.timeline) throw new Error('scrollModel: pass the gsap instance as the first argument.');
  await model.ready;
  const trigger = { ...scrollTrigger };
  if (model.reducedMotion && typeof trigger.scrub === 'number') trigger.scrub = true;
  const tl = gsap.timeline({ defaults, scrollTrigger: trigger });
  for (const step of steps) {
    const position = step.at;
    const tween = { duration: step.duration ?? 1, ...(step.ease ? { ease: step.ease } : {}) };
    if (step.camera) tl.to(model.camera, { ...step.camera, ...tween }, position);
    if (step.animation) tl.to(model.animation, { ...step.animation, ...tween }, position ?? '<');
    if (step.exposure != null) tl.to(model, { exposure: step.exposure, ...tween }, position ?? '<');
  }
  return tl;
}
