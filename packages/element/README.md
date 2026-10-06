# @mesh2web/element

`<web-model>`: a lightweight, framework-free Web Component for 3D models.
Part of [mesh2web](https://github.com/pinyi333/mesh2web).

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@mesh2web/element/dist/web-model.js"></script>

<web-model src="robot.glb" poster="robot.webp" alt="A robot mascot" lighting="studio-soft" autorotate></web-model>
```

or `npm i @mesh2web/element` and `import '@mesh2web/element'`.

- Poster first, lazy loading (`lazy` · `eager` · `interaction`), no layout shift
- 4 KB gzip shell; three.js loads lazily as a separate chunk
- Adaptive quality + LOD selection (`lod-src`), on-demand rendering, off-screen pause
- Lighting presets: `studio-soft`, `studio-hard`, `outdoor`, `neon`, `flat`
- Page-first touch gestures, keyboard control, `role="img"`, reduced-motion support
- Tweenable `camera`, `animation.progress` and `exposure` for GSAP ScrollTrigger

```js
import { scrollModel } from '@mesh2web/element/gsap';
```

Full attribute and API reference: see the [main README](https://github.com/pinyi333/mesh2web#web-model).

MIT
