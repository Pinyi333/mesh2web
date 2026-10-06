/**
 * The three.js side of `<web-model>`. Loaded lazily by the element, so pages
 * pay for three.js only when a model is actually about to be shown.
 */
import {
  ACESFilmicToneMapping, AgXToneMapping, AmbientLight, AnimationMixer, Box3,
  CanvasTexture, Color, DirectionalLight, Group, HemisphereLight, LoopRepeat,
  Mesh, MeshBasicMaterial, NeutralToneMapping, NoToneMapping, PerspectiveCamera,
  PlaneGeometry, PMREMGenerator, PointLight, Scene, Sphere, SRGBColorSpace,
  Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import lightingPresets from '@mesh2web/presets/lighting.json' with { type: 'json' };
import { OrbitControls, OrbitState } from './controls.js';
import { PIXEL_RATIO, lowerTier } from './quality.js';

const TONE_MAPPING = {
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
  none: NoToneMapping,
};

const DEG = Math.PI / 180;
const DEFAULT_DRACO = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

/** Soft radial gradient used as a cheap contact shadow. */
function createShadowTexture(blur) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const inner = Math.max(0, 0.45 - blur * 0.1);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * inner * 0.5, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Largest distance from `center` to any vertex (world space). */
function tightRadius(root, center) {
  const v = new Vector3();
  let max = 0;
  root.traverse((child) => {
    const position = child.isMesh && child.geometry?.attributes.position;
    if (!position) return;
    // Sample large meshes; the bound only needs to be close, not exact.
    const stride = Math.max(1, Math.floor(position.count / 20000));
    for (let i = 0; i < position.count; i += stride) {
      v.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
      max = Math.max(max, v.distanceToSquared(center));
    }
  });
  return Math.sqrt(max);
}

export class Viewer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} surface      Element receiving pointer input.
   * @param {Object} opts
   * @param {'high' | 'medium' | 'low'} opts.tier
   * @param {(type: string, detail?: any) => void} opts.emit
   * @param {OrbitState} [opts.orbit]  Shared camera state (owned by the element).
   */
  constructor(canvas, surface, { tier, emit, orbit = new OrbitState() }) {
    this.canvas = canvas;
    this.emit = emit;
    this.tier = tier;
    this.renderer = new WebGLRenderer({ canvas, antialias: tier !== 'low', alpha: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PIXEL_RATIO[tier]));

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(35, 1, 0.01, 100);
    this.pivot = new Group();
    this.scene.add(this.pivot);
    this.lights = new Group();
    this.scene.add(this.lights);
    this.pmrem = new PMREMGenerator(this.renderer);

    this.orbit = orbit;
    this.target = new Vector3();
    this.radius = 1;
    this.fovBase = 35;

    this.autorotate = false;
    this.autorotateSpeed = 12; // deg per second
    this.interacting = false;
    this.idleSince = 0;
    this.visible = true;
    this.dirty = true;
    this.running = false;
    this.lastTime = 0;
    this.mixer = null;
    this.actions = [];
    this.animationPlaying = false;
    this.frameTimes = [];

    this.controls = new OrbitControls(surface, this.orbit, {
      onChange: () => this.invalidate(),
      onStart: () => { this.interacting = true; this.invalidate(); },
      onEnd: () => { this.interacting = false; this.idleSince = performance.now(); this.invalidate(); },
    });

    this.loop = this.loop.bind(this);
  }

  /** Request a frame. Rendering is on-demand; idle models cost nothing. */
  invalidate() {
    this.dirty = true;
    if (!this.running && this.visible) {
      this.running = true;
      this.lastTime = performance.now();
      requestAnimationFrame(this.loop);
    }
  }

  setVisible(visible) {
    this.visible = visible;
    if (visible) this.invalidate();
  }

  resize(width, height) {
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Keep the model fully in frame on tall (portrait) viewports.
    this.camera.fov = this.camera.aspect < 1
      ? (2 * Math.atan(Math.tan((this.fovBase * DEG) / 2) / this.camera.aspect)) / DEG
      : this.fovBase;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  /**
   * Fetch and parse a model. Does not display it; call `setModel` with the result.
   * @param {string} url
   * @param {{ dracoDecoderPath?: string, onProgress?: (p: number) => void }} [opts]
   */
  async load(url, { dracoDecoderPath = DEFAULT_DRACO, onProgress } = {}) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader().setDecoderPath(dracoDecoderPath);
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);
    try {
      return await loader.loadAsync(url, (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      });
    } finally {
      draco.dispose();
    }
  }

  setModel(gltf) {
    if (this.model) {
      this.pivot.remove(this.model);
      this.disposeObject(this.model);
    }
    this.model = gltf.scene;
    this.pivot.add(this.model);

    // Frame: center on a tight bounding sphere, distance expressed in radii.
    this.model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(this.model, true);
    const center = box.getCenter(new Vector3());
    this.radius = tightRadius(this.model, center) || box.getBoundingSphere(new Sphere()).radius || 1;
    this.target.copy(center);
    this.floorY = box.min.y;
    this.camera.near = this.radius * 0.01;
    this.camera.far = this.radius * 100;
    this.camera.updateProjectionMatrix();
    this.updateShadow();

    this.mixer = null;
    this.actions = [];
    if (gltf.animations?.length) {
      this.mixer = new AnimationMixer(this.model);
      this.actions = gltf.animations.map((clip) => {
        const action = this.mixer.clipAction(clip);
        action.setLoop(LoopRepeat, Infinity);
        return action;
      });
    }
    this.invalidate();
  }

  /** @param {string} name */
  setLighting(name) {
    const preset = lightingPresets[name] || lightingPresets['studio-soft'];
    this.lightingName = lightingPresets[name] ? name : 'studio-soft';
    this.preset = preset;

    for (const light of [...this.lights.children]) {
      this.lights.remove(light);
      light.dispose?.();
    }
    for (const def of preset.lights) {
      let light;
      if (def.type === 'directional') light = new DirectionalLight(def.color, def.intensity);
      else if (def.type === 'point') light = new PointLight(def.color, def.intensity, 0, 2);
      else if (def.type === 'hemisphere') light = new HemisphereLight(def.sky, def.ground, def.intensity);
      else light = new AmbientLight(def.color, def.intensity);
      // Positions are authored for a unit-radius model.
      if (def.position) light.userData.unitPosition = def.position;
      this.lights.add(light);
    }
    this.placeLights();

    if (this.envTexture) this.envTexture.dispose();
    this.envTexture = null;
    if (preset.environment === 'room') {
      this.envTexture = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = preset.environmentIntensity ?? 1;
    this.scene.background = preset.background ? new Color(preset.background) : null;
    this.renderer.toneMapping = TONE_MAPPING[preset.toneMapping] ?? ACESFilmicToneMapping;
    if (this.exposureOverride == null) this.renderer.toneMappingExposure = preset.exposure ?? 1;
    this.updateShadow();
    this.invalidate();
  }

  placeLights() {
    for (const light of this.lights.children) {
      const p = light.userData.unitPosition;
      if (!p) continue;
      light.position.set(p[0], p[1], p[2]).multiplyScalar(this.radius).add(this.target);
      if (light.target) light.target.position.copy(this.target);
    }
  }

  updateShadow() {
    if (this.shadow) {
      this.scene.remove(this.shadow);
      this.shadow.geometry.dispose();
      this.shadow.material.map?.dispose();
      this.shadow.material.dispose();
      this.shadow = null;
    }
    const def = this.preset?.shadow;
    if (!def || !this.model || this.shadowEnabled === false) return;
    const material = new MeshBasicMaterial({
      map: createShadowTexture(def.blur ?? 2),
      transparent: true,
      opacity: def.opacity ?? 0.4,
      depthWrite: false,
      toneMapped: false,
    });
    this.shadow = new Mesh(new PlaneGeometry(1, 1), material);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.scale.setScalar(this.radius * 1.7);
    this.shadow.position.set(this.target.x, this.floorY + this.radius * 0.002, this.target.z);
    this.shadow.renderOrder = -1;
    this.scene.add(this.shadow);
    this.placeLights();
  }

  set exposure(value) {
    this.exposureOverride = value;
    this.renderer.toneMappingExposure = value;
    this.invalidate();
  }

  get exposure() {
    return this.renderer.toneMappingExposure;
  }

  // ---- Animation --------------------------------------------------------

  get animationDuration() {
    return this.actions[0]?.getClip().duration ?? 0;
  }

  playAnimation(index = 0) {
    if (!this.actions.length) return;
    this.actions.forEach((a, i) => { if (i !== index) a.stop(); });
    const action = this.actions[index] ?? this.actions[0];
    action.paused = false;
    action.play();
    this.animationPlaying = true;
    this.invalidate();
  }

  pauseAnimation() {
    this.animationPlaying = false;
    for (const a of this.actions) a.paused = true;
  }

  /** Scrub to a 0–1 position in the active clip (pauses playback). */
  setAnimationProgress(progress, index = 0) {
    if (!this.mixer) return;
    const action = this.actions[index] ?? this.actions[0];
    if (!action.isRunning() && !action.paused) action.play();
    action.paused = true;
    this.animationPlaying = false;
    action.time = Math.max(0, Math.min(1, progress)) * action.getClip().duration;
    this.mixer.update(0);
    this.invalidate();
  }

  // ---- Render loop ------------------------------------------------------

  updateCamera() {
    const { azimuth, polar, distance } = this.orbit;
    const r = distance * this.radius;
    const phi = polar * DEG;
    const theta = azimuth * DEG;
    this.camera.position.set(
      this.target.x + r * Math.sin(phi) * Math.sin(theta),
      this.target.y + r * Math.cos(phi),
      this.target.z + r * Math.sin(phi) * Math.cos(theta),
    );
    this.camera.lookAt(this.target);
  }

  renderOnce() {
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }

  loop(now) {
    if (!this.visible) { this.running = false; return; }
    const dt = Math.min(Math.max(0, now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    let active = false;

    if (!this.interacting && this.orbit.step()) active = true;
    if (this.autorotate && !this.interacting && performance.now() - this.idleSince > 2500) {
      this.orbit.azimuth += this.autorotateSpeed * dt;
      active = true;
    }
    if (this.mixer && this.animationPlaying) {
      this.mixer.update(dt);
      active = true;
    }

    if (active || this.dirty || this.interacting) {
      this.renderOnce();
      this.dirty = false;
    }
    if (active) this.trackPerformance(dt);

    if (active || this.interacting) {
      requestAnimationFrame(this.loop);
    } else {
      this.running = false;
    }
  }

  /** Lower pixel ratio when sustained frame rate drops below ~30fps. */
  trackPerformance(dt) {
    if (this.adaptive === false) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (avg > 1 / 30) {
      const next = lowerTier(this.tier);
      if (!next) return;
      this.tier = next;
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PIXEL_RATIO[next]));
      this.emit('quality-change', { tier: next, fps: Math.round(1 / avg) });
    }
  }

  disposeObject(object) {
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of materials) {
        if (!m) continue;
        for (const value of Object.values(m)) if (value?.isTexture) value.dispose();
        m.dispose();
      }
    });
  }

  dispose() {
    this.running = false;
    this.visible = false;
    this.controls.dispose();
    if (this.model) this.disposeObject(this.model);
    this.envTexture?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}
