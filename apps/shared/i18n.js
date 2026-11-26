/* ==========================================================================
   mesh2web i18n — shared by apps/docs and apps/studio.
   `npm run build` copies this file to apps/<app>/vendor/i18n.js.

   English is the source language and lives in the HTML, so the page works
   without JavaScript and crawlers see English. Other languages come from a
   per-app dictionary that calls `mesh2webI18n.register()`.

   Language order: ?lang= → saved choice (localStorage) → browser languages
   → English. Switching saves the choice and reloads, because SplitText and
   pinned ScrollTriggers measure the text once at start-up.

   Markup:
     data-i18n="key"                  replaces innerHTML (trusted dictionary)
     data-i18n-attr="alt:key,…"       replaces attributes
     data-lang-switch                 button that toggles the language
   ========================================================================== */
(function () {
  const CONFIG = {
    storageKey: 'mesh2web-lang',
    fallback: 'en',
    // Every Chinese variant gets the Traditional Chinese text: it is far easier
    // to read for Simplified Chinese readers than an English page.
    match: [
      { lang: 'zh-TW', test: /^zh(\b|[-_])/i },
      { lang: 'en', test: /^en(\b|[-_])/i },
    ],
    switchTo: { en: 'zh-TW', 'zh-TW': 'en' },
  };

  const normalize = (tag) => {
    if (!tag) return null;
    const hit = CONFIG.match.find((m) => m.test.test(String(tag)));
    return hit ? hit.lang : null;
  };

  const storage = {
    get() { try { return localStorage.getItem(CONFIG.storageKey); } catch { return null; } },
    set(value) { try { localStorage.setItem(CONFIG.storageKey, value); } catch { /* private mode */ } },
  };

  function detect() {
    const fromUrl = normalize(new URLSearchParams(location.search).get('lang'));
    if (fromUrl) return { lang: fromUrl, source: 'url' };
    const saved = normalize(storage.get());
    if (saved) return { lang: saved, source: 'storage' };
    for (const tag of navigator.languages || [navigator.language]) {
      const lang = normalize(tag);
      if (lang) return { lang, source: 'browser' };
    }
    return { lang: CONFIG.fallback, source: 'default' };
  }

  const { lang, source } = detect();
  const html = document.documentElement;
  html.lang = lang;
  html.dataset.lang = lang;

  let dicts = {};

  /** Look up a string; `{name}` placeholders are filled from `vars`. */
  function t(key, vars) {
    const text = dicts[lang]?.[key] ?? dicts[CONFIG.fallback]?.[key] ?? key;
    return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text;
  }

  function applyDom(root) {
    const table = dicts[lang];
    if (lang === CONFIG.fallback || !table) return;
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const value = table[el.dataset.i18n];
      if (value !== undefined) el.innerHTML = value;
    });
    root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      for (const pair of el.dataset.i18nAttr.split(',')) {
        const [attr, key] = pair.split(':').map((s) => s.trim());
        if (table[key] !== undefined) el.setAttribute(attr, table[key]);
      }
    });
  }

  function setLang(next) {
    const target = normalize(next) || CONFIG.fallback;
    storage.set(target);
    const url = new URL(location.href);
    // A shared ?lang= link would override the saved choice, so keep it in step.
    if (url.searchParams.has('lang')) url.searchParams.set('lang', target);
    location.replace(url.href);
  }

  function bindSwitches(root) {
    root.querySelectorAll('[data-lang-switch]').forEach((button) => {
      const next = CONFIG.switchTo[lang];
      button.textContent = t('lang.switch.label');
      button.setAttribute('lang', next);
      button.setAttribute('aria-label', t('lang.switch.aria'));
      button.addEventListener('click', () => setLang(next));
    });
  }

  /** Keys used in the page that the current language has no text for. */
  function missing(root = document) {
    if (lang === CONFIG.fallback) return [];
    const table = dicts[lang] || {};
    const keys = new Set();
    root.querySelectorAll('[data-i18n]').forEach((el) => keys.add(el.dataset.i18n));
    root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.dataset.i18nAttr.split(',').forEach((pair) => keys.add(pair.split(':')[1].trim()));
    });
    Object.keys(dicts[CONFIG.fallback] || {}).forEach((k) => keys.add(k));
    return [...keys].filter((k) => table[k] === undefined);
  }

  function register(dictionaries, root = document) {
    dicts = dictionaries;
    applyDom(root);
    bindSwitches(root);
  }

  window.mesh2webI18n = { lang, source, t, register, setLang, missing };
})();
