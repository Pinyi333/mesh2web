import type { Scene, WebGLRenderer } from 'three';

export type LoadingStrategy = 'lazy' | 'eager' | 'interaction';
export type QualityTier = 'high' | 'medium' | 'low';
export type LightingPreset = 'studio-soft' | 'studio-hard' | 'outdoor' | 'neon' | 'flat';

/** Tween-friendly camera. Angles in degrees, distance in model radii. */
export interface WebModelCamera {
  azimuth: number;
  polar: number;
  distance: number;
  fov: number;
}

/** Tween-friendly animation controller for the model's clips. */
export interface WebModelAnimation {
  /** 0–1 position in the active clip. Setting it scrubs and pauses. */
  progress: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly names: string[];
  play(clip?: string | number): void;
  pause(): void;
}

export interface WebModelEventMap extends HTMLElementEventMap {
  load: CustomEvent<{ url: string; quality: QualityTier; animations: string[] }>;
  progress: CustomEvent<{ progress: number }>;
  error: CustomEvent<{ error: Error; code: 'no-webgl' | 'load-failed' | string }>;
  'quality-change': CustomEvent<{ tier: QualityTier; fps: number }>;
}

export class WebModel extends HTMLElement {
  src: string;
  poster: string;
  alt: string;
  lighting: LightingPreset | string;
  loading: LoadingStrategy;
  autorotate: boolean;
  /** Tone-mapping exposure. Tweenable. */
  exposure: number;
  readonly camera: WebModelCamera;
  readonly animation: WebModelAnimation;
  /** Resolves with the element once the model has loaded. */
  readonly ready: Promise<WebModel>;
  readonly loaded: boolean;
  readonly reducedMotion: boolean;
  readonly quality: QualityTier | null;
  /** three.js scene, available after load. */
  readonly scene: Scene | null;
  /** three.js renderer, available after load. */
  readonly renderer: WebGLRenderer | null;
  /** Start loading now regardless of `loading`. */
  load(): Promise<void>;
  /** Request a re-render (frames are drawn on demand). */
  invalidate(): void;
  /** Render synchronously. */
  renderOnce(): void;
  /** Capture the current view. */
  snapshot(type?: string, quality?: number): Promise<Blob | null>;

  addEventListener<K extends keyof WebModelEventMap>(type: K, listener: (this: WebModel, ev: WebModelEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
}

/** Register `<web-model>` (or a custom tag). Called automatically on import. */
export function define(tagName?: string): void;
export function detectTier(): QualityTier;

declare global {
  interface HTMLElementTagNameMap {
    'web-model': WebModel;
  }
}
