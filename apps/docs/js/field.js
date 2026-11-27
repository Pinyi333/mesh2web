/* ==========================================================================
   mesh2web docs — "MESH / WEB" field (hero)
   An isometric grid floor split by a draggable scan line. Left of the line a
   model is shown as its raw triangle mesh, right of it as the shipped web
   asset. Floor text is DOM (accessible, selectable) projected onto the floor.
   Bundled with three.js into vendor/field.js by `npm run build`.
   ========================================================================== */
import {
  WebGLRenderer, Scene, OrthographicCamera, Vector3, Plane, Color, Mesh, PlaneGeometry,
  ShaderMaterial, MeshStandardMaterial, MeshBasicMaterial, ShadowMaterial, HemisphereLight,
  DirectionalLight, Box3, Box3Helper, Group, ACESFilmicToneMapping, SRGBColorSpace,
  PCFShadowMap, AdditiveBlending, DoubleSide, LineBasicMaterial, LineSegments, BufferGeometry,
  Float32BufferAttribute,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const CONFIG = {
  colors: {
    void: '#0a0b09',
    meshFloor: '#0b0c0a',
    webFloor: '#161714',
    lime: '#d4ff3a',
    wire: '#d4ff3a',
  },
  camera: { dir: [1, 1.08, 1], viewDesktop: 5.6, widthMobile: 5.2 },
  split: { idle: 0.9, speed: 0.22 }, // idle sweep amplitude (world units), cycles per second / 2π
  parallax: 0.18,
};

const lime = new Color(CONFIG.colors.lime);

export function createField(root) {
  const canvas = root.querySelector('canvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(CONFIG.colors.void);

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, -50, 100);
  const camDir = new Vector3(...CONFIG.camera.dir).normalize();
  const camTarget = new Vector3();
  // Screen-right in world space; the split plane uses it as its normal so the
  // scan line is always vertical on screen and maps 1:1 to horizontal drags.
  const right = new Vector3(camDir.z, 0, -camDir.x).normalize();

  /* ------------------------------ split planes ------------------------------ */
  const state = { split: 0, target: 0, dragging: false, touched: false, t: 0, px: 0, py: 0 };
  const webPlane = new Plane(right.clone(), 0); // keeps dot(p, right) > split
  const meshPlane = new Plane(right.clone().negate(), 0);

  /* ------------------------------ lights ------------------------------ */
  scene.add(new HemisphereLight('#fff4e4', '#20221c', 1.1));
  const key = new DirectionalLight('#fff1dc', 2.6);
  key.position.set(-3, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 20 });
  key.shadow.bias = -0.0004;
  key.shadow.radius = 6;
  scene.add(key);
  const rim = new DirectionalLight('#d9e6ff', 1.2);
  rim.position.set(5, 3, -6);
  scene.add(rim);

  /* ------------------------------ floor ------------------------------ */
  const floorUniforms = {
    uSplit: { value: 0 },
    uRight: { value: right },
    uLime: { value: lime },
    uMesh: { value: new Color(CONFIG.colors.meshFloor) },
    uWeb: { value: new Color(CONFIG.colors.webFloor) },
    uVoid: { value: new Color(CONFIG.colors.void) },
  };
  const floor = new Mesh(new PlaneGeometry(80, 80), new ShaderMaterial({
    uniforms: floorUniforms,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uSplit; uniform vec3 uRight, uLime, uMesh, uWeb, uVoid;
      varying vec3 vWorld;
      float gridLine(float v, float width) {
        float d = abs(fract(v - 0.5) - 0.5) / fwidth(v);
        return 1.0 - clamp(d - width, 0.0, 1.0);
      }
      void main() {
        vec2 p = vWorld.xz;
        float side = dot(vWorld, uRight) - uSplit;
        float cell = 0.5;
        vec2 g = p / cell;
        // MESH side: triangulated grid, the raw topology.
        float tri = max(gridLine(g.x, 0.0), gridLine(g.y, 0.0)) + gridLine(g.x + g.y, 0.0) * 0.35;
        // WEB side: a calmer square grid with major lines every 4 cells.
        float sq = max(gridLine(g.x, 0.0), gridLine(g.y, 0.0)) * 0.55 + max(gridLine(g.x / 4.0, 0.3), gridLine(g.y / 4.0, 0.3)) * 0.45;
        vec3 meshCol = mix(uMesh, uLime, min(tri, 1.0) * 0.11);
        vec3 webCol = mix(uWeb, vec3(1.0), sq * 0.06);
        vec3 col = side < 0.0 ? meshCol : webCol;
        // Scan line.
        float line = 1.0 - clamp(abs(side) / fwidth(side) - 1.0, 0.0, 1.0);
        col = mix(col, uLime, line);
        col += uLime * 0.10 * exp(-abs(side) * 5.0);
        // Fade into the void far from the stage.
        float r = length(p) / 11.0;
        col = mix(col, uVoid, smoothstep(0.45, 1.0, r));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const shadow = new Mesh(new PlaneGeometry(14, 14), new ShadowMaterial({ opacity: 0.55, clippingPlanes: [webPlane] }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  shadow.receiveShadow = true;
  scene.add(shadow);

  /* ------------------------------ scan curtain ------------------------------ */
  const curtain = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({
    uniforms: { uLime: { value: lime } },
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uLime; varying vec2 vUv;
      void main(){ float a = pow(1.0 - vUv.y, 2.2) * 0.22 * smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
      gl_FragColor = vec4(uLime * a, a); }`,
  }));
  // The curtain lies in the split plane: spans the view direction, rises up.
  curtain.scale.set(9, 2.6, 1);
  curtain.lookAt(right); // plane normal → right
  curtain.position.y = 1.3;
  curtain.renderOrder = 5;
  scene.add(curtain);

  /* ------------------------------ model ------------------------------ */
  const stage = new Group();
  scene.add(stage);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let bboxLines = null;
  const anchors = { mesh: new Vector3(), web: new Vector3() };

  function load(url, onProgress) {
    return new Promise((resolve, reject) => {
      loader.load(url, (gltf) => {
        stage.clear();
        const model = gltf.scene;
        // Rest on the floor, centered.
        const box = new Box3().setFromObject(model);
        const c = box.getCenter(new Vector3());
        model.position.set(-c.x, -box.min.y, -c.z);
        const web = new Group();
        const raw = new Group();
        model.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
          const m = o.material;
          o.material = new MeshStandardMaterial({
            vertexColors: !!o.geometry.attributes.color, color: m.color, map: m.map,
            roughness: m.roughness ?? 0.9, metalness: m.metalness ?? 0, clippingPlanes: [webPlane],
          });
        });
        web.add(model);
        // Raw side: a dark solid to hide back faces, then the wireframe.
        const wire = model.clone(true);
        const wireMeshes = [];
        wire.traverse((o) => { if (o.isMesh) wireMeshes.push(o); });
        wireMeshes.forEach((o) => {
          o.castShadow = false;
          o.material = new MeshBasicMaterial({ color: CONFIG.colors.meshFloor, clippingPlanes: [meshPlane], polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
          const lines = new Mesh(o.geometry, new MeshBasicMaterial({ color: CONFIG.colors.wire, wireframe: true, transparent: true, opacity: 0.55, clippingPlanes: [meshPlane] }));
          o.add(lines);
        });
        raw.add(wire);
        stage.add(web, raw);

        // Bounding box with corner ticks, the "scanned object" annotation.
        const b = new Box3().setFromObject(stage).expandByScalar(0.08);
        bboxLines = new Box3Helper(b, lime);
        bboxLines.material.transparent = true;
        bboxLines.material.opacity = 0.55;
        stage.add(bboxLines);
        stage.add(cornerTicks(b));
        anchors.mesh.set(b.min.x, b.max.y, b.max.z);
        anchors.web.set(b.max.x, b.max.y, b.min.z);
        resolve(gltf);
      }, (e) => { if (e.total) onProgress?.(e.loaded / e.total); }, reject);
    });
  }

  /* ------------------------------ layout & projection ------------------------------ */
  let width = 1, height = 1;
  const tmp = new Vector3();
  function resize() {
    const r = root.getBoundingClientRect();
    width = Math.max(1, r.width); height = Math.max(1, r.height);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const portrait = aspect < 0.9;
    const viewH = portrait ? CONFIG.camera.widthMobile / aspect : CONFIG.camera.viewDesktop;
    camera.top = viewH / 2; camera.bottom = -viewH / 2;
    camera.left = (-viewH * aspect) / 2; camera.right = (viewH * aspect) / 2;
    // Push the stage slightly right and down on wide screens so the floor text breathes.
    camTarget.copy(portrait ? new Vector3(0, 0.25, 0) : right.clone().multiplyScalar(-1.1).add(new Vector3(0, 0.55, 0)));
    camera.updateProjectionMatrix();
  }

  /** World → panel pixels. */
  function project(v, out = { x: 0, y: 0 }) {
    tmp.copy(v).project(camera);
    out.x = (tmp.x * 0.5 + 0.5) * width;
    out.y = (-tmp.y * 0.5 + 0.5) * height;
    return out;
  }

  // Floor text: CSS x-axis runs along world -Z (up-right on screen), CSS y-axis
  // along world +X (down-right), so text lies flat on the grid like a decal.
  const floorItems = [...root.querySelectorAll('[data-floor]')].map((el) => {
    const [x, z, size] = el.dataset.floor.split(',').map(Number);
    return { el, x, z, size };
  });
  const flatQuery = matchMedia('(max-width: 720px)');
  function placeFloor() {
    const flat = flatQuery.matches;
    root.classList.toggle('is-flat', flat);
    const o = { x: 0, y: 0 }, a = { x: 0, y: 0 }, b = { x: 0, y: 0 };
    for (const it of floorItems) {
      if (flat) { it.el.style.transform = ''; continue; }
      const s = it.size / 100; // data-floor size = world units per 100 CSS px
      project(new Vector3(it.x, 0, it.z), o);
      project(new Vector3(it.x, 0, it.z - s), a);
      project(new Vector3(it.x + s, 0, it.z), b);
      it.el.style.transform = `matrix(${a.x - o.x}, ${a.y - o.y}, ${b.x - o.x}, ${b.y - o.y}, ${o.x}, ${o.y})`;
    }
  }

  const labels = {
    mesh: root.querySelector('[data-anchor="mesh"]'),
    web: root.querySelector('[data-anchor="web"]'),
    handle: root.querySelector('[data-handle]'),
  };
  function placeLabels() {
    const p = { x: 0, y: 0 };
    // Keep the labels inside the panel on narrow screens.
    if (labels.mesh) {
      project(anchors.mesh, p);
      labels.mesh.style.transform = `translate(${Math.max(p.x, labels.mesh.offsetWidth + 14)}px, ${p.y}px)`;
    }
    if (labels.web) {
      project(anchors.web, p);
      labels.web.style.transform = `translate(${Math.min(p.x, width - labels.web.offsetWidth - 14)}px, ${p.y}px)`;
    }
    if (labels.handle) {
      project(right.clone().multiplyScalar(state.split), p);
      labels.handle.style.transform = `translate(${p.x}px, 0)`;
    }
    root.style.setProperty('--split', `${(p.x / width) * 100}%`);
  }

  /* ------------------------------ interaction ------------------------------ */
  const ndc = new Vector3();
  function splitFromPointer(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1, 0).unproject(camera);
    return ndc.dot(right);
  }
  const limit = 3.4;
  const clampSplit = (v) => Math.max(-limit, Math.min(limit, v));
  const dragTarget = labels.handle ?? canvas;
  function onDown(e) {
    state.dragging = true; state.touched = true; state.dragged = true;
    root.classList.add('is-dragging');
    state.target = clampSplit(splitFromPointer(e));
    dragTarget.setPointerCapture?.(e.pointerId);
  }
  function onMove(e) {
    const r = root.getBoundingClientRect();
    state.px = ((e.clientX - r.left) / r.width - 0.5) * 2;
    state.py = ((e.clientY - r.top) / r.height - 0.5) * 2;
    if (state.dragging) state.target = clampSplit(splitFromPointer(e));
  }
  function onUp() { state.dragging = false; root.classList.remove('is-dragging'); }
  // The handle is always draggable; on fine pointers the whole canvas is too.
  labels.handle?.addEventListener('pointerdown', onDown);
  if (matchMedia('(pointer: fine)').matches) canvas.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  labels.handle?.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.6 : 0.2;
    if (e.key === 'ArrowLeft') state.target = clampSplit(state.target - step);
    else if (e.key === 'ArrowRight') state.target = clampSplit(state.target + step);
    else return;
    state.touched = true; state.dragged = true;
    e.preventDefault();
  });

  /* ------------------------------ loop ------------------------------ */
  let visible = true;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(root);
  addEventListener('resize', () => { resize(); placeFloor(); });
  resize();

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!visible) return;
    state.t += dt;
    if (!state.touched && !reduced) state.target = Math.sin(state.t * CONFIG.split.speed * Math.PI) * CONFIG.split.idle;
    state.split += (state.target - state.split) * (state.dragging ? 0.35 : 0.08);
    webPlane.constant = -state.split;
    meshPlane.constant = state.split;
    floorUniforms.uSplit.value = state.split;
    curtain.position.copy(right).multiplyScalar(state.split).setY(1.3);

    // Camera with a little pointer parallax.
    const par = reduced ? 0 : CONFIG.parallax;
    const off = right.clone().multiplyScalar(state.px * par).add(new Vector3(0, -state.py * par * 0.5, 0));
    camera.position.copy(camDir).multiplyScalar(20).add(camTarget).add(off);
    camera.lookAt(tmp.copy(camTarget).add(off));
    camera.updateMatrixWorld();
    placeFloor();
    placeLabels();
    renderer.render(scene, camera);
  }

  return {
    load,
    start() { requestAnimationFrame(frame); },
    /** Tweenable: setting it takes over from the idle sweep. */
    set split(v) { state.touched = true; state.target = clampSplit(v); },
    get split() { return state.target; },
    /** Hand control back to the idle sweep (unless the visitor has dragged). */
    idle() { if (!state.dragged) { state.touched = false; state.t = Math.asin(Math.max(-1, Math.min(1, state.target / CONFIG.split.idle))) / (CONFIG.split.speed * Math.PI); } },
  };
}

/** Short corner ticks drawn just outside the box, like a scanner's frame. */
function cornerTicks(box) {
  const pts = [];
  const len = 0.22;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const sx = x === box.min.x ? 1 : -1, sy = y === box.min.y ? 1 : -1, sz = z === box.min.z ? 1 : -1;
    pts.push(x, y, z, x + sx * len, y, z, x, y, z, x, y + sy * len, z, x, y, z, x, y, z + sz * len);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  return new LineSegments(g, new LineBasicMaterial({ color: lime, linewidth: 2 }));
}

/* ------------------------------ boot ------------------------------ */
const root = document.querySelector('[data-field]');
if (root) {
  const emit = (name, detail) => dispatchEvent(new CustomEvent(`field:${name}`, { detail }));
  try {
    const field = createField(root);
    window.mesh2webField = field;
    field.start();
    field.load(root.dataset.src || 'models/scan.glb', (p) => emit('progress', p))
      .then(() => { root.classList.add('is-live'); emit('ready'); })
      .catch((err) => { console.warn('[field]', err); emit('ready'); });
  } catch (err) {
    // No WebGL: the poster stays, the floor text falls back to flat layout.
    root.classList.add('is-flat', 'no-webgl');
    console.warn('[field]', err);
    emit('ready');
  }
}
