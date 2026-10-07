// ==UserScript==
// @name         YouTube → LLM Summary
// @namespace    yt-llm-summary
// @license      MIT
// @version      1.2.1
// @description  Buttons below videos and on thumbnail hover that send the video link to ChatGPT, Claude, Grok or DeepSeek (new chat, prompt is pre-filled). Configurable prompt and language.
// @homepageURL  https://github.com/Jake-double-one/YouTube-to-LLM
// @supportURL   https://github.com/Jake-double-one/YouTube-to-LLM/issues
// @updateURL    https://raw.githubusercontent.com/Jake-double-one/YouTube-to-LLM/main/youtube-llm-summary.user.js
// @downloadURL  https://raw.githubusercontent.com/Jake-double-one/YouTube-to-LLM/main/youtube-llm-summary.user.js
// @match        https://www.youtube.com/*
// @match        https://chatgpt.com/*
// @match        https://claude.ai/*
// @match        https://grok.com/*
// @match        https://chat.deepseek.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      www.google.com
// @connect      gstatic.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ================= Defaults =================
  // These are only defaults – everything here can be changed in the settings
  // panel (gear icon, bottom right on YouTube). Saved settings take precedence.
  const DEFAULTS = {
    lang: 'en',              // UI language and default prompt language (key of I18N)
    prompt: '',              // custom prompt; empty = use the default prompt of the selected language
    autoSend: false,         // true = submit the prompt automatically
    openInBackground: false, // true = open the LLM tab in the background
    watchPageBar: true,      // buttons below the title on the watch page
    thumbnailHover: true,    // hover buttons on thumbnails (home, search, recommendations …)
  };
  const MAX_AGE_MS = 60000;  // how long a "pending" prompt stays valid

  // ================= Languages =================
  // To add a language: copy the `en` block, change the key (e.g. `fr`),
  // translate `name`, `prompt` and `ui`. Missing `ui` strings fall back to English.
  // {title} and {url} in the prompt are replaced with the video title and link.
  const I18N = {
    en: {
      name: 'English',
      prompt:
        'Summarize this YouTube video in English. ' +
        'Give me the key points as bullet points and a short conclusion.\n\n' +
        'Title: {title}\nLink: {url}',
      ui: {
        summarizeWith: 'Summarize with',
        summarizeTooltip: 'Summarize video with {llm}',
        unknownTitle: '(unknown)',
        settings: 'YouTube → LLM settings',
        language: 'Language',
        prompt: 'Prompt',
        promptHint: 'Placeholders: {title} = video title, {url} = video link. Leave empty to use the default prompt.',
        resetPrompt: 'Reset to default',
        autoSend: 'Send prompt automatically',
        openInBackground: 'Open LLM tab in background',
        watchPageBar: 'Show buttons below the video title',
        thumbnailHover: 'Show buttons when hovering thumbnails',
        save: 'Save',
        cancel: 'Cancel',
        inputNotFound: 'Input field not found – the prompt is in your clipboard (Ctrl+V).',
      },
    },
    de: {
      name: 'Deutsch',
      prompt:
        'Fasse dieses YouTube-Video auf Deutsch zusammen. ' +
        'Gib mir die Kernaussagen als Stichpunkte und ein kurzes Fazit.\n\n' +
        'Titel: {title}\nLink: {url}',
      ui: {
        summarizeWith: 'Zusammenfassen mit',
        summarizeTooltip: 'Video bei {llm} zusammenfassen',
        unknownTitle: '(unbekannt)',
        settings: 'YouTube → LLM Einstellungen',
        language: 'Sprache',
        prompt: 'Prompt',
        promptHint: 'Platzhalter: {title} = Videotitel, {url} = Videolink. Leer lassen für den Standard-Prompt.',
        resetPrompt: 'Auf Standard zurücksetzen',
        autoSend: 'Prompt automatisch abschicken',
        openInBackground: 'LLM-Tab im Hintergrund öffnen',
        watchPageBar: 'Buttons unter dem Videotitel anzeigen',
        thumbnailHover: 'Buttons beim Hovern über Vorschaubilder anzeigen',
        save: 'Speichern',
        cancel: 'Abbrechen',
        inputNotFound: 'Eingabefeld nicht gefunden – der Prompt liegt in der Zwischenablage (Strg+V).',
      },
    },
  };

  // ================= LLMs =================
  // color = accent color on hover; icon = optional custom image URL instead of the favicon
  // send = selector of the send button; if it is null or not found, Enter is pressed instead
  // Selectors may break when the providers redesign their pages
  const LLMS = {
    chatgpt: {
      label: 'ChatGPT',
      color: '#10a37f',
      url: 'https://chatgpt.com/',
      input: '#prompt-textarea, div[contenteditable="true"]',
      send: 'button[data-testid="send-button"], #composer-submit-button',
    },
    claude: {
      label: 'Claude',
      color: '#d97757',
      url: 'https://claude.ai/new',
      input: 'div.ProseMirror[contenteditable="true"], div[contenteditable="true"]',
      send: 'button[aria-label="Send message"], button[aria-label*="Send"]',
    },
    grok: {
      label: 'Grok',
      color: '#4b5563',
      url: 'https://grok.com/',
      input: 'textarea, div[contenteditable="true"]',
      send: 'button[type="submit"], button[aria-label="Submit"]',
    },
    deepseek: {
      label: 'DeepSeek',
      color: '#4d6bfe',
      url: 'https://chat.deepseek.com/',
      input: 'textarea[name="search"], textarea[placeholder*="DeepSeek"], textarea#chat-input, textarea',
      // round primary button; disabled while the input is empty (then Enter is used instead)
      send: 'div[role="button"].ds-button--primary.ds-button--circle:not(.ds-button--disabled)',
    },
  };
  // ==================================================

  const KEY = 'ytLlmPending';
  const SETTINGS_KEY = 'ytLlmSettings';
  const host = location.hostname;

  // ---------- Settings & translation ----------
  function loadSettings() {
    const s = Object.assign({}, DEFAULTS, GM_getValue(SETTINGS_KEY) || {});
    if (!I18N[s.lang]) s.lang = DEFAULTS.lang;
    return s;
  }
  let settings = loadSettings();

  function saveSettings(next) {
    settings = Object.assign({}, settings, next);
    GM_setValue(SETTINGS_KEY, settings);
  }

  // t('key', { llm: 'Claude' }) → translated string with {placeholders} filled in
  function t(key, vars, lang = settings.lang) {
    const str = I18N[lang]?.ui?.[key] ?? I18N.en.ui[key] ?? key;
    return vars ? str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : str;
  }

  function defaultPrompt(lang = settings.lang) {
    return I18N[lang]?.prompt || I18N.en.prompt;
  }

  function activePrompt() {
    return settings.prompt.trim() ? settings.prompt : defaultPrompt();
  }

  // ================= YouTube =================
  function initYouTube() {
    injectStyles();
    initWatchBar();
    initThumbnailHover();
    initSettings();
  }

  function sendTo(key, url, title) {
    const text = activePrompt()
      .replace(/\{title\}/g, () => title || t('unknownTitle'))
      .replace(/\{url\}/g, () => url);
    GM_setClipboard(text); // fallback: the prompt is also in the clipboard
    GM_setValue(KEY, { target: key, text, ts: Date.now() });
    GM_openInTab(LLMS[key].url, { active: !settings.openInBackground });
  }

  function videoIdFromHref(href) {
    try {
      const u = new URL(href, location.origin);
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/shorts\/([\w-]{6,})/);
      return m ? m[1] : null;
    } catch { return null; }
  }

  // Called after settings change so buttons pick up the new language/options
  const uiRefreshers = [];
  function refreshUI() {
    for (const fn of uiRefreshers) fn();
  }

  // ---------- Icons (favicons, loaded once and cached) ----------
  const iconPromises = {};
  function loadIcon(key) {
    if (iconPromises[key]) return iconPromises[key];
    const cacheKey = 'icon_' + key;
    const cached = GM_getValue(cacheKey);
    if (cached) return (iconPromises[key] = Promise.resolve(cached));

    const src =
      LLMS[key].icon ||
      'https://www.google.com/s2/favicons?sz=64&domain=' + new URL(LLMS[key].url).hostname;

    return (iconPromises[key] = new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: src,
        responseType: 'blob',
        onload: (r) => {
          if (r.status !== 200 || !r.response) return resolve(null);
          const fr = new FileReader();
          fr.onload = () => { GM_setValue(cacheKey, fr.result); resolve(fr.result); };
          fr.onerror = () => resolve(null);
          fr.readAsDataURL(r.response);
        },
        onerror: () => resolve(null),
        ontimeout: () => resolve(null),
      });
    }));
  }

  // Button: icon + label (fallback: first letter if the icon doesn't load)
  function makeButton(key, cls, onClick) {
    const llm = LLMS[key];
    const b = document.createElement('button');
    b.className = cls;
    b.title = t('summarizeTooltip', { llm: llm.label });
    b.style.setProperty('--llm', llm.color);

    const ico = document.createElement('span');
    ico.className = 'yt-llm-ico';
    ico.textContent = llm.label[0];
    b.appendChild(ico);

    const lbl = document.createElement('span');
    lbl.className = 'yt-llm-lbl';
    lbl.textContent = llm.label;
    b.appendChild(lbl);

    loadIcon(key).then((data) => {
      if (!data) return;
      const img = document.createElement('img');
      img.src = data;
      img.alt = '';
      img.onerror = () => img.remove();
      ico.textContent = '';
      ico.appendChild(img);
    });

    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.classList.add('yt-llm-sent');
      setTimeout(() => b.classList.remove('yt-llm-sent'), 600);
      onClick();
    });
    return b;
  }

  // ---------- Buttons on the watch page ----------
  function initWatchBar() {
    const BAR_ID = 'yt-llm-bar';

    function ensureBar() {
      if (location.pathname !== '/watch' || !settings.watchPageBar) {
        document.getElementById(BAR_ID)?.remove();
        return;
      }
      if (document.getElementById(BAR_ID)) return;
      const anchor =
        document.querySelector('ytd-watch-metadata #title') ||
        document.querySelector('#above-the-fold #title');
      if (!anchor) return;

      const bar = document.createElement('div');
      bar.id = BAR_ID;
      const hint = document.createElement('span');
      hint.className = 'yt-llm-hint';
      hint.textContent = t('summarizeWith');
      bar.appendChild(hint);

      for (const key of Object.keys(LLMS)) {
        bar.appendChild(
          makeButton(key, 'yt-llm-chip', () => {
            const id = new URL(location.href).searchParams.get('v');
            if (!id) return;
            const title = (
              document.querySelector('ytd-watch-metadata #title h1')?.textContent ||
              document.title.replace(/ - YouTube$/, '')
            ).trim();
            sendTo(key, 'https://www.youtube.com/watch?v=' + id, title);
          })
        );
      }
      anchor.after(bar);
    }

    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; ensureBar(); });
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('yt-navigate-finish', ensureBar);
    uiRefreshers.push(() => { document.getElementById(BAR_ID)?.remove(); ensureBar(); });
    ensureBar();
  }

  // ---------- Hover buttons on thumbnails ----------
  function initThumbnailHover() {
    const overlay = document.createElement('div');
    overlay.id = 'yt-llm-hover';
    document.body.appendChild(overlay);

    let current = null; // currently hovered thumbnail link

    function buildButtons() {
      overlay.replaceChildren();
      for (const key of Object.keys(LLMS)) {
        overlay.appendChild(
          makeButton(key, 'yt-llm-mini', () => {
            if (!current) return;
            const id = videoIdFromHref(current.href);
            if (!id) return;
            sendTo(key, 'https://www.youtube.com/watch?v=' + id, titleFor(current));
          })
        );
      }
    }
    buildButtons();
    uiRefreshers.push(() => { hide(); buildButtons(); });

    // Thumbnail link = link to a video that contains an image and is large enough
    function findThumb(el) {
      if (!(el instanceof Element)) return null;
      const a = el.closest('a[href*="/watch?v="], a[href^="/shorts/"], a[href*="youtube.com/shorts/"]');
      if (!a) return null;
      if (!a.querySelector('img, yt-image, yt-thumbnail-view-model')) return null;
      const r = a.getBoundingClientRect();
      return r.width >= 100 && r.height >= 50 ? a : null;
    }

    function titleFor(a) {
      const card = a.closest(
        'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ' +
        'ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, ' +
        'ytd-reel-item-renderer, yt-lockup-view-model, ytm-shorts-lockup-view-model'
      );
      const el = card?.querySelector('#video-title, h3 a[title], h3 [title], h3, a[title]');
      return (el?.getAttribute('title') || el?.textContent || a.getAttribute('aria-label') || '').trim();
    }

    function place() {
      if (!current || !current.isConnected) return hide();
      const r = current.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) return hide();
      overlay.style.top = r.top + 8 + 'px';
      overlay.style.left = r.left + 8 + 'px';
      overlay.classList.add('yt-llm-show');
    }

    function hide() {
      current = null;
      overlay.classList.remove('yt-llm-show');
    }

    function inside(r, x, y) {
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    // Check by mouse position – keeps the buttons visible even when
    // YouTube overlays its inline preview on top of the thumbnail.
    let lastX = 0, lastY = 0, lastTarget = null, pending = false;
    function check() {
      pending = false;
      if (!settings.thumbnailHover) return hide();
      if (overlay.contains(lastTarget)) return;
      const a = findThumb(lastTarget);
      if (a) { current = a; return place(); }
      if (current && inside(current.getBoundingClientRect(), lastX, lastY)) return place();
      hide();
    }

    document.addEventListener('mousemove', (e) => {
      lastX = e.clientX; lastY = e.clientY; lastTarget = e.target;
      if (!pending) { pending = true; requestAnimationFrame(check); }
    }, { passive: true });

    window.addEventListener('scroll', () => current && place(), { passive: true, capture: true });
    window.addEventListener('yt-navigate-start', hide);
    document.addEventListener('mouseleave', hide);
  }

  // ---------- Settings (gear button bottom right + panel) ----------
  // Built with createElement only – YouTube enforces Trusted Types, so innerHTML would throw.
  function el(tag, props = {}, children = []) {
    const e = document.createElement(tag);
    Object.assign(e, props);
    for (const c of children) e.append(c);
    return e;
  }

  function initSettings() {
    const gear = el('button', { id: 'yt-llm-gear', textContent: '⚙' });
    gear.title = t('settings');
    gear.addEventListener('click', () => (backdrop.isConnected ? close() : open()));
    document.body.appendChild(gear);
    uiRefreshers.push(() => (gear.title = t('settings')));

    // Hide the gear while a video is fullscreen
    document.addEventListener('fullscreenchange', () =>
      gear.classList.toggle('yt-llm-hidden', !!document.fullscreenElement)
    );

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Settings / Einstellungen', open);
    }

    const backdrop = el('div', { id: 'yt-llm-backdrop' });
    const panel = el('div', { id: 'yt-llm-panel' });
    backdrop.appendChild(panel);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    // Keep YouTube's keyboard shortcuts away from the panel
    for (const type of ['keydown', 'keyup', 'keypress']) {
      panel.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Escape') close();
      });
    }

    let draftLang = settings.lang;

    function open() {
      if (backdrop.isConnected) return;
      draftLang = settings.lang;
      render(settings.prompt.trim() ? settings.prompt : defaultPrompt(draftLang));
      document.body.appendChild(backdrop);
      panel.querySelector('select')?.focus();
    }

    function close() {
      backdrop.remove();
    }

    // Re-render the whole panel in the draft language (live preview of the language switch)
    function render(promptText, toggles) {
      const L = (k) => t(k, null, draftLang);
      const cur = toggles || settings;

      const langSelect = el('select', { className: 'yt-llm-input' },
        Object.entries(I18N).map(([code, def]) =>
          el('option', { value: code, textContent: def.name })
        )
      );
      langSelect.value = draftLang;

      const promptArea = el('textarea', { className: 'yt-llm-input', rows: 7, value: promptText });

      const checks = {};
      const toggleRow = (key) => {
        checks[key] = el('input', { type: 'checkbox', checked: !!cur[key] });
        return el('label', { className: 'yt-llm-check' }, [checks[key], el('span', { textContent: L(key) })]);
      };

      const readToggles = () =>
        Object.fromEntries(Object.entries(checks).map(([k, c]) => [k, c.checked]));

      langSelect.addEventListener('change', () => {
        const prevDefault = defaultPrompt(draftLang);
        draftLang = langSelect.value;
        // Swap the prompt only if the user hasn't customized it
        const text = promptArea.value.trim();
        const keep = text && text !== prevDefault.trim();
        render(keep ? promptArea.value : defaultPrompt(draftLang), readToggles());
        panel.querySelector('select')?.focus();
      });

      const resetBtn = el('button', { className: 'yt-llm-btn yt-llm-btn-link', textContent: L('resetPrompt') });
      resetBtn.addEventListener('click', () => { promptArea.value = defaultPrompt(draftLang); });

      const cancelBtn = el('button', { className: 'yt-llm-btn', textContent: L('cancel') });
      cancelBtn.addEventListener('click', close);

      const saveBtn = el('button', { className: 'yt-llm-btn yt-llm-btn-primary', textContent: L('save') });
      saveBtn.addEventListener('click', () => {
        const text = promptArea.value;
        // Store '' when it matches the default, so later default-prompt updates still apply
        const custom = text.trim() && text.trim() !== defaultPrompt(draftLang).trim() ? text : '';
        saveSettings(Object.assign({ lang: draftLang, prompt: custom }, readToggles()));
        close();
        refreshUI();
      });

      panel.replaceChildren(
        el('h2', { textContent: L('settings') }),
        el('label', { className: 'yt-llm-field' }, [el('span', { textContent: L('language') }), langSelect]),
        el('label', { className: 'yt-llm-field' }, [el('span', { textContent: L('prompt') }), promptArea]),
        el('div', { className: 'yt-llm-row' }, [
          el('small', { className: 'yt-llm-small', textContent: L('promptHint') }),
          resetBtn,
        ]),
        el('div', { className: 'yt-llm-checks' },
          ['autoSend', 'openInBackground', 'watchPageBar', 'thumbnailHover'].map(toggleRow)
        ),
        el('div', { className: 'yt-llm-actions' }, [cancelBtn, saveBtn])
      );
    }
  }

  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      /* ---------- shared ---------- */
      .yt-llm-chip, .yt-llm-mini {
        display:inline-flex; align-items:center; cursor:pointer; border:none;
        font-family:Roboto,Arial,sans-serif; font-weight:500;
        transition:background-color .18s ease, color .18s ease, box-shadow .18s ease,
                   transform .12s ease, padding .2s ease;
      }
      .yt-llm-chip:active, .yt-llm-mini:active { transform:scale(0.94); }
      .yt-llm-ico {
        display:inline-flex; align-items:center; justify-content:center;
        width:20px; height:20px; border-radius:50%; flex:none; overflow:hidden;
        background:#fff; color:#111; font-size:11px; font-weight:700;
      }
      .yt-llm-ico img { width:16px; height:16px; display:block; }
      .yt-llm-sent { animation:yt-llm-pulse .6s ease; }
      @keyframes yt-llm-pulse {
        0%   { box-shadow:0 0 0 0 var(--llm); }
        100% { box-shadow:0 0 0 10px transparent; }
      }

      /* ---------- bar below the video title ---------- */
      #yt-llm-bar { display:flex; align-items:center; gap:8px; margin:10px 0 4px; flex-wrap:wrap; }
      .yt-llm-hint {
        font:400 13px Roboto,Arial,sans-serif;
        color:var(--yt-spec-text-secondary,#606060); margin-right:2px;
      }
      .yt-llm-chip {
        gap:8px; padding:6px 14px 6px 7px; border-radius:18px; font-size:14px;
        background:var(--yt-spec-badge-chip-background,#f2f2f2);
        color:var(--yt-spec-text-primary,#0f0f0f);
      }
      .yt-llm-chip:hover {
        background:var(--llm); color:#fff;
        box-shadow:0 2px 10px color-mix(in srgb, var(--llm) 45%, transparent);
        transform:translateY(-1px);
      }

      /* ---------- hover overlay on thumbnails ---------- */
      #yt-llm-hover {
        position:fixed; z-index:99999; display:flex; gap:6px; pointer-events:none;
        opacity:0; transform:translateY(-4px);
        transition:opacity .15s ease, transform .15s ease;
      }
      #yt-llm-hover.yt-llm-show { opacity:1; transform:none; pointer-events:auto; }
      .yt-llm-mini {
        gap:0; padding:4px; border-radius:16px; font-size:12px; color:#fff;
        background:rgba(15,15,15,0.72); backdrop-filter:blur(6px);
        box-shadow:0 1px 6px rgba(0,0,0,0.45);
        border:1px solid rgba(255,255,255,0.12);
      }
      .yt-llm-mini .yt-llm-lbl {
        max-width:0; overflow:hidden; white-space:nowrap; opacity:0;
        transition:max-width .22s ease, opacity .18s ease, margin .22s ease;
      }
      .yt-llm-mini:hover {
        padding:4px 10px 4px 4px; background:var(--llm);
        box-shadow:0 2px 12px color-mix(in srgb, var(--llm) 60%, transparent);
        border-color:rgba(255,255,255,0.3);
      }
      .yt-llm-mini:hover .yt-llm-lbl { max-width:80px; opacity:1; margin-left:6px; }

      /* ---------- settings gear ---------- */
      #yt-llm-gear {
        position:fixed; right:20px; bottom:20px; z-index:100000;
        width:40px; height:40px; border-radius:50%; cursor:pointer;
        display:flex; align-items:center; justify-content:center;
        font-size:20px; line-height:1; color:#fff;
        background:rgba(15,15,15,0.72); backdrop-filter:blur(6px);
        border:1px solid rgba(255,255,255,0.15);
        box-shadow:0 2px 8px rgba(0,0,0,0.35);
        opacity:.55; transition:opacity .18s ease, transform .3s ease;
      }
      #yt-llm-gear:hover { opacity:1; transform:rotate(60deg); }
      #yt-llm-gear.yt-llm-hidden { display:none; }

      /* ---------- settings panel ---------- */
      #yt-llm-backdrop {
        position:fixed; inset:0; z-index:100001; background:rgba(0,0,0,0.45);
        display:flex; align-items:flex-end; justify-content:flex-end; padding:20px 20px 72px;
      }
      /* Colors follow the system theme (prefers-color-scheme), not YouTube's theme */
      #yt-llm-panel {
        --bg:#ffffff; --fg:#0f0f0f; --muted:#606060; --field:#f2f2f2;
        --border:rgba(0,0,0,0.12); --btn:#f2f2f2; --btn-hover:#e5e5e5;
        --primary:#065fd4; --primary-hover:#0556bf; --link:#065fd4;
        --shadow:0 8px 32px rgba(0,0,0,0.25);
        color-scheme:light;
        width:min(440px, calc(100vw - 40px)); max-height:calc(100vh - 100px); overflow:auto;
        box-sizing:border-box; padding:20px; border-radius:12px;
        font:400 14px Roboto,Arial,sans-serif;
        background:var(--bg); color:var(--fg); box-shadow:var(--shadow);
        border:1px solid var(--border);
        display:flex; flex-direction:column; gap:14px;
      }
      @media (prefers-color-scheme: dark) {
        #yt-llm-panel {
          --bg:#212121; --fg:#f1f1f1; --muted:#aaaaaa; --field:#2f2f2f;
          --border:rgba(255,255,255,0.12); --btn:#3a3a3a; --btn-hover:#474747;
          --primary:#3ea6ff; --primary-hover:#65b8ff; --link:#3ea6ff;
          --shadow:0 8px 32px rgba(0,0,0,0.6);
          color-scheme:dark;
        }
        #yt-llm-panel .yt-llm-btn-primary { color:#0f0f0f; }
      }
      #yt-llm-panel h2 { margin:0; font-size:18px; font-weight:500; }
      .yt-llm-field { display:flex; flex-direction:column; gap:6px; font-weight:500; }
      .yt-llm-input {
        box-sizing:border-box; width:100%; padding:8px 10px; border-radius:8px;
        font:400 14px Roboto,Arial,sans-serif;
        color:var(--fg); background:var(--field); border:1px solid var(--border);
      }
      .yt-llm-input:focus { outline:2px solid var(--primary); outline-offset:-1px; }
      textarea.yt-llm-input { resize:vertical; min-height:100px; line-height:1.4; }
      .yt-llm-input option { color:var(--fg); background:var(--bg); }
      .yt-llm-row { display:flex; align-items:flex-start; gap:10px; margin-top:-6px; }
      .yt-llm-small { flex:1; font-size:12px; color:var(--muted); }
      .yt-llm-checks { display:flex; flex-direction:column; gap:8px; }
      .yt-llm-check { display:flex; align-items:center; gap:8px; cursor:pointer; }
      .yt-llm-check input { margin:0; width:16px; height:16px; accent-color:var(--primary); }
      .yt-llm-actions { display:flex; justify-content:flex-end; gap:8px; }
      .yt-llm-btn {
        cursor:pointer; border:none; border-radius:18px; padding:8px 16px;
        font:500 14px Roboto,Arial,sans-serif; color:var(--fg); background:var(--btn);
      }
      .yt-llm-btn:hover { background:var(--btn-hover); }
      .yt-llm-btn-primary { background:var(--primary); color:#fff; }
      .yt-llm-btn-primary:hover { background:var(--primary-hover); }
      .yt-llm-btn-link {
        background:none; padding:0; border-radius:0; white-space:nowrap;
        font-size:12px; color:var(--link);
      }
      .yt-llm-btn-link:hover { background:none; text-decoration:underline; }
    `;
    document.head.appendChild(s);
  }

  // ================= LLM page =================
  function initLLM() {
    const key = Object.keys(LLMS).find((k) => host === new URL(LLMS[k].url).hostname);
    const job = GM_getValue(KEY);
    if (!key || !job || job.target !== key) return;
    if (Date.now() - job.ts > MAX_AGE_MS) { GM_deleteValue(KEY); return; }
    GM_deleteValue(KEY);

    const llm = LLMS[key];
    waitFor(llm.input, 20000)
      .then((el) => {
        el.focus();
        if (el.tagName === 'TEXTAREA') {
          // set the value in a React-compatible way
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(el, job.text);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          // contenteditable (ProseMirror etc.)
          document.execCommand('insertText', false, job.text);
        }
        if (settings.autoSend) {
          setTimeout(() => {
            const btn = llm.send && document.querySelector(llm.send);
            if (btn) return btn.click();
            const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            el.dispatchEvent(new KeyboardEvent('keydown', opts));
            el.dispatchEvent(new KeyboardEvent('keyup', opts));
          }, 800);
        }
      })
      .catch(() => console.warn('[YT→LLM] ' + t('inputNotFound')));
  }

  function waitFor(selector, timeout) {
    return new Promise((resolve, reject) => {
      const found = () => {
        const el = document.querySelector(selector);
        return el && el.offsetParent !== null ? el : null;
      };
      const now = found();
      if (now) return resolve(now);
      const obs = new MutationObserver(() => {
        const el = found();
        if (el) { obs.disconnect(); clearTimeout(timer); setTimeout(() => resolve(el), 300); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      const timer = setTimeout(() => { obs.disconnect(); reject(); }, timeout);
    });
  }

  // ================= Start =================
  // Called last so all variables above are initialized
  try {
    if (host.endsWith('youtube.com')) initYouTube();
    else initLLM();
  } catch (e) {
    console.error('[YT→LLM] Startup error:', e);
  }
})();
