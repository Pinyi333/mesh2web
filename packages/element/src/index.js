/**
 * @mesh2web/element — `<web-model>` Web Component.
 *
 * Importing this module registers `<web-model>`. three.js is loaded lazily
 * (as a separate chunk) only when a model is about to be displayed.
 */
import { WebModel, define } from './web-model.js';

define();

export { WebModel, define };
export { detectTier } from './quality.js';
