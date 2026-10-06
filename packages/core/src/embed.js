/**
 * Build a copy-paste `<web-model>` snippet for an optimized model.
 * @param {Object} o
 * @param {string} o.src
 * @param {string} [o.poster]
 * @param {string} [o.alt]
 * @param {string[]} [o.lods]       Lower-detail variants, highest first.
 * @param {string} [o.lighting]
 * @param {string} [o.cdn]          Script URL for the element.
 */
export function createEmbedSnippet({
  src, poster, alt = '3D model', lods = [], lighting = 'studio-soft',
  cdn = 'https://cdn.jsdelivr.net/npm/@mesh2web/element/dist/web-model.js',
}) {
  const attr = (name, value) => (value ? `\n  ${name}="${String(value).replace(/"/g, '&quot;')}"` : '');
  return `<script type="module" src="${cdn}"></script>

<web-model${attr('src', src)}${attr('lod-src', lods.join(' '))}${attr('poster', poster)}${attr('alt', alt)}${attr('lighting', lighting)}
  controls="orbit"
  autorotate
  loading="lazy"
></web-model>
`;
}
