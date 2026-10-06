import { OrbitState } from './controls.js';
import { detectTier, hasWebGL, pickSource } from './quality.js';
import { styles } from './styles.js';

/**
 * @typedef {'lazy' | 'eager' | 'interaction'} LoadingStrategy
 */

const reducedMotionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** Parse "30deg 75deg 3.2" (units optional) into orbit values. */
function parseOrbit(value) {
  const [azimuth, polar, distance] = String(value || '').trim().split(/\s+/).map((v) => parseFloat(v));
  return { azimuth, polar, distance };
}

/**
 * Tween-friendly camera facade. Each property is a plain number, so GSAP
 * (or any tween library) can animate it directly:
 * `gsap.to(model.camera, { azimuth: 180, distance: 4 })`.
 */
class CameraController {
  /** @param {WebModel} host */
  constructor(host) { this.host = host; }
  /** Horizontal angle in degrees. */
  get azimuth() { return this.host.orbit.azimuth; }
  set azimuth(v) { this.host.orbit.azimuth = +v; this.host.invalidate(); }
  /** Vertical angle in degrees, 0 = top, 90 = side, 180 = bottom. */
  get polar() { return this.host.orbit.polar; }
  set polar(v) { const o = this.host.orbit; o.polar = Math.min(o.maxPolar, Math.max(o.minPolar, +v)); this.host.invalidate(); }
  /** Distance from the model center, in model radii. */
  get distance() { return this.host.orbit.distance; }
  set distance(v) { const o = this.host.orbit; o.distance = Math.min(o.maxDistance, Math.max(o.minDistance, +v)); this.host.invalidate(); }
  /** Vertical field of view in degrees. */
  get fov() { return this.host.viewer?.fovBase ?? 35; }
  set fov(v) {
    const viewer = this.host.viewer;
    if (!viewer) return;
    viewer.fovBase = +v;
    viewer.resize(this.host.clientWidth, this.host.clientHeight);
  }
}

/** Tween-friendly facade over the model's first (or selected) animation clip. */
class AnimationController {
  /** @param {WebModel} host */
  constructor(host) { this.host = host; this.index = 0; this._progress = 0; }
  /** Clip names, available after load. */
  get names() { return this.host.viewer?.actions.map((a) => a.getClip().name) ?? []; }
  get duration() { return this.host.viewer?.animationDuration ?? 0; }
  get playing() { return !!this.host.viewer?.animationPlaying; }
  /** 0–1 position. Setting it scrubs (and pauses) the clip, ideal for scroll. */
  get progress() {
    const action = this.host.viewer?.actions[this.index];
    return action ? action.time / action.getClip().duration : this._progress;
  }
  set progress(v) { this._progress = +v; this.host.viewer?.setAnimationProgress(+v, this.index); }
  /** @param {string | number} [clip] Name or index. */
  play(clip) {
    if (clip !== undefined) this.index = typeof clip === 'number' ? clip : Math.max(0, this.names.indexOf(clip));
    this.host.viewer?.playAnimation(this.index);
  }
  pause() { this.host.viewer?.pauseAnimation(); }
}

export class WebModel extends HTMLElement {
  static get observedAttributes() {
    return ['src', 'lod-src', 'poster', 'alt', 'lighting', 'controls', 'autorotate', 'autorotate-speed',
      'gesture', 'camera-orbit', 'exposure', 'shadow', 'disable-zoom', 'loading'];
  }

  constructor() {
    super();
    this.orbit = new OrbitState();
    /** Tweenable camera: `azimuth`, `polar` (degrees), `distance` (model radii), `fov`. */
    this.camera = new CameraController(this);
    /** Tweenable animation: `progress` (0–1), `play()`, `pause()`. */
    this.animation = new AnimationController(this);
    /** @type {import('./viewer.js').Viewer | null} */
    this.viewer = null;
    this.loaded = false;
    this._loading = null;
    this._loadToken = 0;
    this._exposure = null;
    this._resetReady();

    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${styles}</style>
      <div class="stage" part="stage">
        <img class="poster" part="poster" alt="" aria-hidden="true" decoding="async">
        <canvas part="canvas" aria-hidden="true"></canvas>
        <button class="prompt" part="prompt" type="button" hidden>
          <span class="prompt__icon" aria-hidden="true"></span><span class="prompt__label">View in 3D</span>
        </button>
        <div class="progress" part="progress" aria-hidden="true"><span></span></div>
        <div class="fallback"><slot></slot></div>
      </div>`;
    this.$poster = root.querySelector('.poster');
    this.$canvas = root.querySelector('canvas');
    this.$prompt = root.querySelector('.prompt');
    this.$progress = root.querySelector('.progress span');
    this.$prompt.addEventListener('click', (e) => { e.stopPropagation(); this.load(); });
    this._onMotionChange = () => this._applyAutorotate();
  }

  _resetReady() {
    /** Resolves when the model has loaded and rendered its first frame. */
    this.ready = new Promise((resolve, reject) => { this._resolveReady = resolve; this._rejectReady = reject; });
    this.ready.catch(() => {}); // errors are also dispatched as an `error` event
  }

  connectedCallback() {
    if (!this.hasAttribute('role')) this.setAttribute('role', 'img');
    if (!this.hasAttribute('aria-roledescription')) this.setAttribute('aria-roledescription', '3D model');
    if (!this.hasAttribute('tabindex') && this.getAttribute('controls') !== 'none') this.tabIndex = 0;
    this._syncAlt();
    this._syncPoster();
    reducedMotionQuery?.addEventListener?.('change', this._onMotionChange);
    this._scheduleLoad();
  }

  disconnectedCallback() {
    reducedMotionQuery?.removeEventListener?.('change', this._onMotionChange);
    this._lazyObserver?.disconnect();
    this._visibilityObserver?.disconnect();
    this._resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this._onPageVisibility);
    this.viewer?.dispose();
    this.viewer = null;
    this.loaded = false;
    this._loading = null;
    this.removeAttribute('data-state');
    this._resetReady();
  }

  attributeChangedCallback(name, oldValue, value) {
    if (oldValue === value) return;
    switch (name) {
      case 'alt': this._syncAlt(); break;
      case 'poster': this._syncPoster(); break;
      case 'src':
      case 'lod-src':
        if (this.viewer) this._loadModel().catch((error) => this._fail(error));
        else if (this.isConnected && !this._loading) this._scheduleLoad();
        break;
      case 'lighting': this.viewer?.setLighting(this.lighting); break;
      case 'autorotate':
      case 'autorotate-speed': this._applyAutorotate(); break;
      case 'controls':
      case 'gesture':
      case 'disable-zoom': this._applyControls(); break;
      case 'camera-orbit': this._applyOrbitAttribute(); break;
      case 'exposure': if (value != null) this.exposure = parseFloat(value); break;
      case 'shadow': if (this.viewer) { this.viewer.shadowEnabled = value !== 'none'; this.viewer.updateShadow(); this.invalidate(); } break;
      case 'loading': if (this.isConnected && !this.loaded) this._scheduleLoad(); break;
      default: break;
    }
  }

  // ---- Reflected properties ---------------------------------------------

  get src() { return this.getAttribute('src') || ''; }
  set src(v) { this.setAttribute('src', v); }
  get poster() { return this.getAttribute('poster') || ''; }
  set poster(v) { this.setAttribute('poster', v); }
  get alt() { return this.getAttribute('alt') || ''; }
  set alt(v) { this.setAttribute('alt', v); }
  get lighting() { return this.getAttribute('lighting') || 'studio-soft'; }
  set lighting(v) { this.setAttribute('lighting', v); }
  /** @returns {LoadingStrategy} */
  get loading() {
    const v = this.getAttribute('loading');
    return v === 'eager' || v === 'interaction' ? v : 'lazy';
  }
  set loading(v) { this.setAttribute('loading', v); }
  get autorotate() { return this.hasAttribute('autorotate'); }
  set autorotate(v) { this.toggleAttribute('autorotate', !!v); }

  /** Tone-mapping exposure. Tweenable. */
  get exposure() { return this.viewer ? this.viewer.exposure : (this._exposure ?? 1); }
  set exposure(v) {
    this._exposure = +v;
    if (this.viewer) this.viewer.exposure = +v;
  }

  /** True when the user prefers reduced motion. Scroll/auto animations should respect it. */
  get reducedMotion() { return !!reducedMotionQuery?.matches; }

  /** Current quality tier: 'high' | 'medium' | 'low'. */
  get quality() { return this.viewer?.tier ?? this._tier ?? null; }

  /** The three.js scene (after load), for advanced use. */
  get scene() { return this.viewer?.scene ?? null; }
  /** The three.js renderer (after load). */
  get renderer() { return this.viewer?.renderer ?? null; }

  // ---- Public methods ---------------------------------------------------

  /** Request a re-render (cheap; frames are only drawn when needed). */
  invalidate() { this.viewer?.invalidate(); }

  /** Render synchronously, e.g. before taking a screenshot. */
  renderOnce() { this.viewer?.renderOnce(); }

  /**
   * Capture the current view as an image Blob.
   * @param {string} [type='image/webp'] @param {number} [quality=0.9]
   * @returns {Promise<Blob | null>}
   */
  snapshot(type = 'image/webp', quality = 0.9) {
    if (!this.viewer) return Promise.resolve(null);
    this.viewer.renderOnce();
    return new Promise((resolve) => this.$canvas.toBlob(resolve, type, quality));
  }

  /** Start loading now, regardless of the `loading` strategy. */
  load() {
    if (this._loading) return this._loading;
    this._lazyObserver?.disconnect();
    this.$prompt.hidden = true;
    this._loading = this._start().catch((error) => this._fail(error));
    return this._loading;
  }

  // ---- Internals --------------------------------------------------------

  _syncAlt() {
    const alt = this.alt;
    if (alt) this.setAttribute('aria-label', alt);
  }

  _syncPoster() {
    const poster = this.poster;
    this.$poster.hidden = !poster;
    if (poster) this.$poster.src = poster;
    else this.$poster.removeAttribute('src');
  }

  _scheduleLoad() {
    this._lazyObserver?.disconnect();
    if (!this.src || this._loading) return;
    const strategy = this.loading;
    if (strategy === 'eager') { this.load(); return; }
    if (strategy === 'interaction') {
      this.$prompt.hidden = false;
      return;
    }
    this._lazyObserver = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) this.load();
    }, { rootMargin: '300px 0px' });
    this._lazyObserver.observe(this);
  }

  async _start() {
    if (!hasWebGL()) throw Object.assign(new Error('WebGL is not available; showing the poster instead.'), { code: 'no-webgl' });
    this.dataset.state = 'loading';
    const qualityAttr = this.getAttribute('quality');
    this._tier = ['high', 'medium', 'low'].includes(qualityAttr) ? qualityAttr : detectTier();

    const { Viewer } = await import('./viewer.js');
    if (!this.isConnected) return;
    const viewer = new Viewer(this.$canvas, this, {
      tier: this._tier,
      emit: (type, detail) => this.dispatchEvent(new CustomEvent(type, { detail })),
      orbit: this.orbit,
    });
    viewer.adaptive = !qualityAttr || qualityAttr === 'auto';
    viewer.shadowEnabled = this.getAttribute('shadow') !== 'none';
    this.viewer = viewer;
    viewer.setLighting(this.lighting);
    if (this._exposure != null) viewer.exposure = this._exposure;
    else if (this.hasAttribute('exposure')) viewer.exposure = parseFloat(this.getAttribute('exposure'));
    this._applyControls();
    this._applyAutorotate();
    this._applyOrbitAttribute();

    this._resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      viewer.resize(width, height);
    });
    this._resizeObserver.observe(this);
    viewer.resize(this.clientWidth, this.clientHeight);

    // Pause rendering when off-screen or when the tab is hidden.
    this._visibilityObserver = new IntersectionObserver(([entry]) => {
      this._inView = entry.isIntersecting;
      viewer.setVisible(this._inView && !document.hidden);
    });
    this._visibilityObserver.observe(this);
    this._onPageVisibility = () => viewer.setVisible(!!this._inView && !document.hidden);
    document.addEventListener('visibilitychange', this._onPageVisibility);

    await this._loadModel();
  }

  async _loadModel() {
    const viewer = this.viewer;
    if (!viewer) return;
    const lods = (this.getAttribute('lod-src') || '').split(/\s+/).filter(Boolean);
    const url = pickSource(this.src, lods, viewer.tier);
    if (!url) return;
    // A newer src may arrive while this one downloads; only the latest wins.
    const token = ++this._loadToken;
    this.dataset.state = 'loading';
    this.$progress.style.transform = 'scaleX(0)';
    const gltf = await viewer.load(url, {
      dracoDecoderPath: this.getAttribute('draco-decoder-path') || undefined,
      onProgress: (p) => {
        this.$progress.style.transform = `scaleX(${p})`;
        this.dispatchEvent(new CustomEvent('progress', { detail: { progress: p } }));
      },
    });
    if (this.viewer !== viewer || token !== this._loadToken) {
      viewer.disposeObject(gltf.scene);
      return;
    }
    viewer.setModel(gltf);
    if (this.hasAttribute('autoplay') && !this.reducedMotion) viewer.playAnimation(0);
    else if (this.animation._progress) viewer.setAnimationProgress(this.animation._progress);
    viewer.renderOnce();
    this.loaded = true;
    this.dataset.state = 'loaded';
    this.dispatchEvent(new CustomEvent('load', { detail: { url, quality: viewer.tier, animations: gltf.animations.map((a) => a.name) } }));
    this._resolveReady(this);
  }

  _fail(error) {
    this.dataset.state = 'error';
    this._loading = null;
    this.dispatchEvent(new CustomEvent('error', { detail: { error, code: error.code || 'load-failed' } }));
    this._rejectReady(error);
  }

  _applyControls() {
    const controls = this.viewer?.controls;
    if (!controls) return;
    controls.enabled = this.getAttribute('controls') !== 'none';
    controls.zoom = !this.hasAttribute('disable-zoom');
    controls.setGesture(this.getAttribute('gesture') || 'page-first');
  }

  _applyAutorotate() {
    if (!this.viewer) return;
    this.viewer.autorotate = this.autorotate && !this.reducedMotion;
    const speed = parseFloat(this.getAttribute('autorotate-speed'));
    if (Number.isFinite(speed)) this.viewer.autorotateSpeed = speed;
    this.viewer.invalidate();
  }

  _applyOrbitAttribute() {
    const { azimuth, polar, distance } = parseOrbit(this.getAttribute('camera-orbit'));
    if (Number.isFinite(azimuth)) this.camera.azimuth = azimuth;
    if (Number.isFinite(polar)) this.camera.polar = polar;
    if (Number.isFinite(distance)) this.camera.distance = distance;
  }
}

/** Register `<web-model>` (or a custom tag name). Safe to call twice. */
export function define(tagName = 'web-model') {
  if (!customElements.get(tagName)) customElements.define(tagName, class extends WebModel {});
}
