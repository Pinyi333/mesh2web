import type { WebModel } from './index.js';

export interface ScrollStep {
  camera?: { azimuth?: number; polar?: number; distance?: number; fov?: number };
  animation?: { progress?: number };
  exposure?: number;
  at?: number | string;
  duration?: number;
  ease?: string;
}

export function scrollModel(
  gsap: any,
  model: WebModel,
  options: { scrollTrigger: Record<string, any>; steps: ScrollStep[]; defaults?: Record<string, any> },
): Promise<any>;
