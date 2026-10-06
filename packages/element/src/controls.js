/**
 * Minimal orbit controller with damping, written for `<web-model>`.
 *
 * Gesture model:
 * - `page-first` (default): one finger scrolls the page vertically and rotates
 *   the model horizontally; two fingers rotate freely and pinch to zoom.
 *   The mouse wheel only zooms while Ctrl/⌘ is held, so the page keeps scrolling.
 * - `model-first`: all touch and wheel input goes to the model.
 *
 * Angles are in degrees; distance is in model radii.
 */

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export class OrbitState {
  constructor() {
    this.azimuth = 0;
    this.polar = 75;
    this.distance = 3.7;
    this.minPolar = 5;
    this.maxPolar = 175;
    this.minDistance = 1.2;
    this.maxDistance = 10;
    // Velocity for inertia (deg/frame and radii/frame).
    this.vAzimuth = 0;
    this.vPolar = 0;
    this.vDistance = 0;
  }

  /** Apply velocity; returns true while still moving. */
  step(damping = 0.88) {
    if (Math.abs(this.vAzimuth) + Math.abs(this.vPolar) + Math.abs(this.vDistance) < 0.0005) {
      this.vAzimuth = this.vPolar = this.vDistance = 0;
      return false;
    }
    this.azimuth += this.vAzimuth;
    this.polar = clamp(this.polar + this.vPolar, this.minPolar, this.maxPolar);
    this.distance = clamp(this.distance + this.vDistance, this.minDistance, this.maxDistance);
    this.vAzimuth *= damping;
    this.vPolar *= damping;
    this.vDistance *= damping;
    return true;
  }
}

export class OrbitControls {
  /**
   * @param {HTMLElement} element  Surface receiving pointer input.
   * @param {OrbitState} state
   * @param {{ onChange: () => void, onStart?: () => void, onEnd?: () => void }} callbacks
   */
  constructor(element, state, { onChange, onStart = () => {}, onEnd = () => {} }) {
    this.element = element;
    this.state = state;
    this.onChange = onChange;
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.enabled = true;
    this.zoom = true;
    this.gesture = 'page-first';
    /** @type {Map<number, { x: number, y: number, type: string }>} */
    this.pointers = new Map();
    this.pinchDistance = 0;
    this.lock = null; // 'x' | 'y' for single-finger touch in page-first mode

    this.handlers = {
      pointerdown: this.onPointerDown.bind(this),
      pointermove: this.onPointerMove.bind(this),
      pointerup: this.onPointerUp.bind(this),
      pointercancel: this.onPointerUp.bind(this),
      wheel: this.onWheel.bind(this),
      keydown: this.onKeyDown.bind(this),
    };
    for (const [type, fn] of Object.entries(this.handlers)) {
      element.addEventListener(type, fn, { passive: type !== 'wheel' });
    }
    this.setGesture(this.gesture);
  }

  /** @param {'page-first' | 'model-first'} mode */
  setGesture(mode) {
    this.gesture = mode === 'model-first' ? 'model-first' : 'page-first';
    this.element.style.touchAction = this.gesture === 'model-first' ? 'none' : 'pan-y';
  }

  rotate(dx, dy) {
    const speed = 180 / Math.max(240, this.element.clientWidth);
    this.state.vAzimuth = -dx * speed * 0.9;
    this.state.vPolar = -dy * speed * 0.9;
    this.state.azimuth += this.state.vAzimuth;
    this.state.polar = clamp(this.state.polar + this.state.vPolar, this.state.minPolar, this.state.maxPolar);
    this.onChange();
  }

  dolly(factor) {
    if (!this.zoom) return;
    const s = this.state;
    s.distance = clamp(s.distance * factor, s.minDistance, s.maxDistance);
    s.vDistance = 0;
    this.onChange();
  }

  onPointerDown(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (this.pointers.size === 1) {
      this.lock = null;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.onStart();
    }
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinch();
    if (e.pointerType === 'mouse') this.element.setPointerCapture?.(e.pointerId);
  }

  onPointerMove(e) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev || !this.enabled) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;

    if (this.pointers.size >= 2) {
      // Average the two fingers for rotation and use their spread for zoom.
      this.rotate(dx / 2, dy / 2);
      const d = this.currentPinch();
      if (this.pinchDistance > 0 && d > 0) this.dolly(this.pinchDistance / d);
      this.pinchDistance = d;
      return;
    }

    const touchPageFirst = prev.type === 'touch' && this.gesture === 'page-first';
    if (touchPageFirst) {
      // Decide once per gesture whether the finger meant to scroll or rotate.
      if (!this.lock) {
        const tx = Math.abs(e.clientX - this.startX);
        const ty = Math.abs(e.clientY - this.startY);
        if (tx + ty < 6) return;
        this.lock = tx > ty ? 'x' : 'y';
      }
      if (this.lock === 'x') this.rotate(dx, 0);
      return;
    }
    this.rotate(dx, dy);
  }

  onPointerUp(e) {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (this.pointers.size === 0) this.onEnd();
  }

  onWheel(e) {
    if (!this.enabled || !this.zoom) return;
    if (this.gesture === 'page-first' && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.dolly(Math.exp(e.deltaY * 0.0015));
  }

  onKeyDown(e) {
    if (!this.enabled) return;
    const step = e.shiftKey ? 30 : 10;
    const s = this.state;
    switch (e.key) {
      case 'ArrowLeft': s.azimuth -= step; break;
      case 'ArrowRight': s.azimuth += step; break;
      case 'ArrowUp': s.polar = clamp(s.polar - step, s.minPolar, s.maxPolar); break;
      case 'ArrowDown': s.polar = clamp(s.polar + step, s.minPolar, s.maxPolar); break;
      case '+': case '=': this.dolly(0.9); break;
      case '-': case '_': this.dolly(1.1); break;
      default: return;
    }
    e.preventDefault();
    this.onStart();
    this.onChange();
    this.onEnd();
  }

  currentPinch() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  dispose() {
    for (const [type, fn] of Object.entries(this.handlers)) this.element.removeEventListener(type, fn);
    this.pointers.clear();
  }
}
