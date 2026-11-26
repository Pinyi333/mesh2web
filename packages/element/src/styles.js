/**
 * Shadow DOM styles. Public hooks:
 *   --web-model-aspect-ratio   default 4 / 3
 *   --web-model-accent         progress bar and prompt color
 *   --web-model-poster-fit     object-fit for the poster (default contain)
 *   --web-model-fade           fade duration (default 600ms)
 * and ::part(stage | poster | canvas | prompt | ar-button | progress).
 */
export const styles = `
:host {
  display: block;
  position: relative;
  aspect-ratio: var(--web-model-aspect-ratio, 4 / 3);
  contain: layout paint;
  outline: none;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
}
:host([hidden]) { display: none; }
:host(:focus-visible) { box-shadow: 0 0 0 2px var(--web-model-accent, currentColor); border-radius: 4px; }
:host([data-state="loaded"]:not([controls="none"])) { cursor: grab; }
:host([data-state="loaded"]:not([controls="none"]):active) { cursor: grabbing; }
.stage { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; container-type: size; }
.poster, canvas {
  position: absolute; inset: 0; width: 100%; height: 100%;
  transition: opacity var(--web-model-fade, 600ms) cubic-bezier(.2, .7, .2, 1);
}
.poster { object-fit: var(--web-model-poster-fit, contain); pointer-events: none; }
.poster[hidden] { display: none; }
canvas { display: block; opacity: 0; }
:host([data-state="loaded"]) canvas { opacity: 1; }
:host([data-state="loaded"]) .poster { opacity: 0; }
.progress {
  position: absolute; left: 0; right: 0; bottom: 0; height: 2px; overflow: hidden;
  opacity: 0; transition: opacity .3s ease;
}
:host([data-state="loading"]) .progress { opacity: 1; }
.progress span {
  display: block; height: 100%; background: var(--web-model-accent, currentColor);
  transform: scaleX(0); transform-origin: left; transition: transform .2s ease;
}
.prompt {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
  display: inline-flex; align-items: center; gap: .6em;
  padding: .7em 1.2em; border: 1px solid currentColor; border-radius: 999px;
  background: color-mix(in srgb, Canvas 75%, transparent); color: inherit;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  font: 500 13px/1 system-ui, sans-serif; letter-spacing: .02em; cursor: pointer;
  transition: transform .3s cubic-bezier(.2,.7,.2,1), background .3s ease;
}
.prompt:hover { transform: translateX(-50%) translateY(-2px); }
.prompt:focus-visible { outline: 2px solid var(--web-model-accent, currentColor); outline-offset: 2px; }
.prompt[hidden] { display: none; }
.prompt__icon {
  width: 14px; height: 14px; border: 1.5px solid currentColor; border-radius: 3px;
  transform: rotate(45deg) skew(-8deg, -8deg);
}
.ar {
  position: absolute; right: 12px; bottom: 12px;
  display: inline-flex; align-items: center; gap: .55em; min-height: 40px;
  padding: .65em 1em; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 999px;
  background: color-mix(in srgb, Canvas 78%, transparent); color: inherit;
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  font: 500 13px/1 system-ui, sans-serif; letter-spacing: .02em; cursor: pointer;
  transition: transform .3s cubic-bezier(.2,.7,.2,1), border-color .3s ease;
}
.ar:hover { transform: translateY(-2px); border-color: currentColor; }
.ar:focus-visible { outline: 2px solid var(--web-model-accent, currentColor); outline-offset: 2px; }
.ar[hidden] { display: none; }
.ar__icon {
  width: 14px; height: 14px; border: 1.5px solid currentColor; border-radius: 2px;
  transform: perspective(40px) rotateX(55deg);
}
/* Icon-only on very narrow embeds, or when it would collide with the centered prompt. */
@container (max-width: 300px) {
  .ar { padding: 0; width: 40px; justify-content: center; }
  .ar__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
@container (max-width: 520px) {
  .prompt:not([hidden]) ~ .ar { padding: 0; width: 40px; justify-content: center; }
  .prompt:not([hidden]) ~ .ar .ar__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
.fallback { display: none; }
:host([data-state="error"]) .fallback { display: contents; }
@media (prefers-reduced-motion: reduce) {
  .poster, canvas, .progress span, .prompt, .ar { transition: none; }
}
`;
