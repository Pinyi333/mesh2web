/* ==========================================================================
   mesh2web docs — motion
   GSAP + ScrollTrigger + SplitText + Lenis, driving real <web-model> elements.
   ========================================================================== */
const CONFIG = {
  ease: { out: 'power3.out', strong: 'power4.out', inOut: 'power4.inOut', expo: 'expo.out' },
  preloader: { min: 1.1, curtain: 0.9 },
  hero: { duration: 1.25, stagger: 0.09 },
  reveal: { y: 70, duration: 1.1, start: 'top 86%' },
  marquee: { speed: 38 }, // seconds per loop
  magnetic: { strength: 0.3 },
  story: { scrollPerStep: 0.9 }, // viewport heights of scroll per pipeline step
};

const html = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let lenis = null;

// If the animation libraries failed to load, show everything statically.
if (!window.gsap || !window.ScrollTrigger) {
  html.classList.remove('js');
} else {
  gsap.registerPlugin(ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(SplitText);
  // Fonts change line breaks; split text only after they settle (max 1.5s).
  Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(init);
}

function init() {
  initGrain();                // canvas film grain → CSS background
  initCopyButtons();          // copy CLI command
  initTabs();                 // accessible tabs
  initLightingLab();          // lighting preset switcher

  if (reducedMotion) {
    html.classList.add('reduced');
    document.querySelector('.preloader')?.remove();
    return; // content is fully visible, models still interactive
  }

  initSmoothScroll();         // Lenis ⇄ ScrollTrigger
  initPreloader();            // real model progress → curtain → hero reveal
  initMarquee();              // infinite benchmark marquee
  initStory();                // pinned pipeline story scrubbing the 3D camera
  initSplitTitles();          // section titles: line mask reveal
  initReveals();              // [data-reveal] generic entrances
  initHeroParallax();         // hero model drifts on scroll

  gsap.matchMedia().add('(hover: hover) and (pointer: fine)', () => {
    initMagnetic();           // magnetic buttons (desktop only)
  });

  addEventListener('load', () => ScrollTrigger.refresh());
}

/* --------------------------------------------------------------------------
   Film grain (canvas → data URL, generated once)
   -------------------------------------------------------------------------- */
function initGrain() {
  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.random() * 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  document.body.style.setProperty('--grain', `url(${canvas.toDataURL('image/png')})`);
}

/* --------------------------------------------------------------------------
   Smooth scroll (Lenis) — touch keeps native scrolling
   -------------------------------------------------------------------------- */
function initSmoothScroll() {
  if (!window.Lenis) return;
  lenis = new Lenis({ duration: 1.1, easing: (t) => Math.min(1, 1.001 - 2 ** (-10 * t)) });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const target = document.querySelector(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: 0 });
    });
  });
}

/* --------------------------------------------------------------------------
   Preloader: counter follows the hero model's real download progress
   -------------------------------------------------------------------------- */
function initPreloader() {
  const pre = document.querySelector('.preloader');
  if (!pre) { initHeroReveal(); return; }
  const countEl = pre.querySelector('[data-count]');
  const model = document.getElementById('hero-model');
  const state = { shown: 0, target: 0 };
  html.classList.add('is-loading');
  lenis?.stop();

  const setTarget = (v) => { state.target = Math.max(state.target, v); };
  model?.addEventListener('progress', (e) => setTarget(e.detail.progress * 92));
  // Never block on the model: poster is already a complete first paint.
  const modelDone = Promise.race([
    model?.ready ?? Promise.resolve(),
    new Promise((r) => setTimeout(r, 4000)),
  ]);
  const minTime = new Promise((r) => setTimeout(r, CONFIG.preloader.min * 1000));

  const tick = () => {
    state.shown += (state.target - state.shown) * 0.12;
    countEl.textContent = String(Math.round(state.shown)).padStart(2, '0');
  };
  gsap.ticker.add(tick);
  // Gentle fake progress until real bytes arrive (cached loads skip events).
  gsap.to(state, { target: 60, duration: CONFIG.preloader.min, ease: 'power1.out' });

  Promise.all([modelDone, minTime]).then(() => {
    setTarget(100);
    gsap.timeline({ onComplete: () => { gsap.ticker.remove(tick); pre.remove(); } })
      .to(state, { shown: 100, duration: 0.35, ease: 'power2.out', onUpdate: () => { countEl.textContent = '100'; } })
      .add(() => { html.classList.remove('is-loading'); lenis?.start(); })
      .to(pre, { yPercent: -100, duration: CONFIG.preloader.curtain, ease: CONFIG.ease.inOut })
      .add(initHeroReveal, '-=0.45');
  });
}

/* --------------------------------------------------------------------------
   Hero: masked line reveal + fades + model rise
   -------------------------------------------------------------------------- */
function initHeroReveal() {
  const title = document.querySelector('.hero__title');
  const tl = gsap.timeline();
  if (title && window.SplitText) {
    const split = new SplitText(title, { type: 'lines', linesClass: 'line', mask: 'lines' });
    gsap.set(title, { visibility: 'visible' });
    tl.from(split.lines, { yPercent: 115, duration: CONFIG.hero.duration, ease: CONFIG.ease.strong, stagger: CONFIG.hero.stagger });
  } else if (title) {
    gsap.set(title, { visibility: 'visible' });
  }
  tl.fromTo('[data-hero-fade]', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: CONFIG.ease.out, stagger: 0.08 }, 0.35)
    .from('[data-hero-model]', { y: 80, opacity: 0, duration: 1.6, ease: CONFIG.ease.expo }, 0.1);

  const model = document.getElementById('hero-model');
  // Swing the camera into place once the model is ready: a quiet "hello".
  model?.ready.then(() => {
    gsap.from(model.camera, { azimuth: -110, distance: 4.6, duration: 2.4, ease: CONFIG.ease.expo });
  });
}

function initHeroParallax() {
  // Desktop only: on mobile the model sits above the copy and must not drift onto it.
  gsap.matchMedia().add('(min-width: 901px)', () => {
    gsap.to('[data-hero-model]', {
      yPercent: 14, ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
    });
  });
}

/* --------------------------------------------------------------------------
   Marquee: infinite loop, speeds up with scroll velocity
   -------------------------------------------------------------------------- */
function initMarquee() {
  const track = document.querySelector('[data-marquee]');
  if (!track) return;
  // Duplicate content once so -50% loops seamlessly.
  track.append(...[...track.children].map((n) => { const c = n.cloneNode(true); c.setAttribute('aria-hidden', 'true'); return c; }));
  const loop = gsap.to(track, { xPercent: -50, duration: CONFIG.marquee.speed, ease: 'none', repeat: -1 });
  ScrollTrigger.create({
    trigger: track,
    onUpdate: (self) => {
      const boost = 1 + Math.min(4, Math.abs(self.getVelocity()) / 400);
      gsap.to(loop, { timeScale: boost * (self.direction || 1), duration: 0.2, overwrite: true });
      gsap.to(loop, { timeScale: self.direction || 1, duration: 1.2, delay: 0.2, ease: 'power2.out' });
    },
  });
}

/* --------------------------------------------------------------------------
   Pipeline story: pin + scrub. Camera, exposure, steps and size meter
   share one timeline — the same API users get in their own pages.
   -------------------------------------------------------------------------- */
function initStory() {
  const section = document.querySelector('.story');
  const pin = section?.querySelector('.story__pin');
  const model = document.getElementById('story-model');
  const steps = gsap.utils.toArray('.step');
  if (!pin || !model || !steps.length) return;

  const meter = section.querySelector('[data-meter]');
  const bar = section.querySelector('[data-meter-bar]');
  gsap.set(steps, { autoAlpha: 0, y: 40 });
  gsap.set(steps[0], { autoAlpha: 1, y: 0 });
  gsap.set(bar, { scaleX: 1 });
  // The story model should start loading slightly before it pins.
  ScrollTrigger.create({ trigger: section, start: 'top 150%', once: true, onEnter: () => model.load() });

  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: () => `+=${innerHeight * CONFIG.story.scrollPerStep * steps.length}`,
      pin,
      scrub: 0.8,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  });

  // One full turn of the camera across the whole story.
  tl.to(model.camera, { azimuth: 360, duration: steps.length }, 0)
    .to(model.camera, { polar: 62, distance: 3.1, duration: steps.length / 2, ease: 'sine.inOut' }, 0)
    .to(model.camera, { polar: 78, distance: 3.7, duration: steps.length / 2, ease: 'sine.inOut' }, steps.length / 2)
    .to(model, { exposure: 1.25, duration: steps.length, ease: 'sine.inOut' }, 0);

  steps.forEach((step, i) => {
    const at = i;
    const ratio = parseFloat(step.dataset.ratio);
    tl.add(() => { meter.textContent = step.dataset.size; }, at + 0.5);
    tl.to(bar, { scaleX: Math.max(ratio, 0.02), duration: 0.6, ease: 'power2.inOut' }, at);
    if (i === 0) return;
    tl.to(steps[i - 1], { autoAlpha: 0, y: -40, duration: 0.25, ease: 'power2.in' }, at - 0.3)
      .to(step, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power3.out' }, at);
  });
}

/* --------------------------------------------------------------------------
   Section titles: masked line reveal on scroll
   -------------------------------------------------------------------------- */
function initSplitTitles() {
  if (!window.SplitText) return;
  gsap.utils.toArray('[data-split]').forEach((el) => {
    const split = new SplitText(el, { type: 'lines', linesClass: 'line', mask: 'lines' });
    gsap.from(split.lines, {
      yPercent: 110, duration: 1.15, ease: CONFIG.ease.strong, stagger: 0.08,
      scrollTrigger: { trigger: el, start: CONFIG.reveal.start, once: true },
    });
  });
}

/* --------------------------------------------------------------------------
   [data-reveal]: y + opacity, batched for grids
   -------------------------------------------------------------------------- */
function initReveals() {
  ScrollTrigger.batch('[data-reveal]', {
    start: CONFIG.reveal.start,
    once: true,
    onEnter: (batch) => gsap.fromTo(batch,
      { y: CONFIG.reveal.y, opacity: 0 },
      { y: 0, opacity: 1, duration: CONFIG.reveal.duration, ease: CONFIG.ease.out, stagger: 0.08, overwrite: true }),
  });
}

/* --------------------------------------------------------------------------
   Magnetic buttons (desktop only, via gsap.matchMedia)
   -------------------------------------------------------------------------- */
function initMagnetic() {
  const cleanups = [];
  document.querySelectorAll('[data-magnetic]').forEach((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3.out' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' });
    const move = (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * CONFIG.magnetic.strength);
      yTo((e.clientY - (r.top + r.height / 2)) * CONFIG.magnetic.strength);
    };
    const leave = () => { gsap.to(el, { x: 0, y: 0, duration: 0.8, ease: 'elastic.out(1, 0.4)' }); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    cleanups.push(() => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); gsap.set(el, { x: 0, y: 0 }); });
  });
  return () => cleanups.forEach((fn) => fn());
}

/* --------------------------------------------------------------------------
   Copy-to-clipboard command
   -------------------------------------------------------------------------- */
function initCopyButtons() {
  document.querySelectorAll('[data-copy]').forEach((button) => {
    const label = button.querySelector('[data-copy-label]');
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        label.textContent = 'Copied';
      } catch {
        label.textContent = 'Select';
      }
      setTimeout(() => { label.textContent = 'Copy'; }, 1600);
    });
  });
}

/* --------------------------------------------------------------------------
   Tabs (WAI-ARIA pattern with arrow-key navigation)
   -------------------------------------------------------------------------- */
function initTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') select(tabs[(i + 1) % tabs.length]);
      if (e.key === 'ArrowLeft') select(tabs[(i - 1 + tabs.length) % tabs.length]);
    });
  });
}

/* --------------------------------------------------------------------------
   Lighting lab: radio buttons drive the `lighting` attribute
   -------------------------------------------------------------------------- */
function initLightingLab() {
  const model = document.getElementById('lab-model');
  const label = document.querySelector('[data-lighting-label]');
  const buttons = [...document.querySelectorAll('[data-lighting]')];
  if (!model) return;
  const choose = (button) => {
    buttons.forEach((b) => b.setAttribute('aria-checked', String(b === button)));
    model.lighting = button.dataset.lighting;
    label.textContent = button.dataset.lighting;
    if (window.gsap && !reducedMotion) {
      gsap.fromTo(model.camera, { distance: model.camera.distance + 0.25 }, { distance: 3.8, duration: 1.2, ease: 'expo.out' });
    }
  };
  buttons.forEach((button, i) => {
    button.addEventListener('click', () => choose(button));
    button.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const next = buttons[(i + dir + buttons.length) % buttons.length];
      next.focus();
      choose(next);
    });
  });
}
