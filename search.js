/**
 * AdvocateDadCO site search — Pagefind UI
 * Header dialog + optional always-visible search page.
 * Safe alongside navigation.js (does not touch menu-toggle handlers).
 */
const DEBOUNCE_MS = 180;
const MAX_RESULTS = 12;
const PAGEFIND_URL = new URL('/pagefind/pagefind.js', window.location.origin).href;

let pagefindApi = null;
let pagefindLoading = null;
let debounceTimer = null;

function loadPagefind() {
  if (pagefindApi) return Promise.resolve(pagefindApi);
  if (pagefindLoading) return pagefindLoading;
  pagefindLoading = import(PAGEFIND_URL)
    .then((mod) => {
      pagefindApi = mod;
      return mod;
    })
    .catch((err) => {
      pagefindLoading = null;
      throw err;
    });
  return pagefindLoading;
}

function debounce(fn, ms) {
  return (...args) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Allow Pagefind excerpt markup that only includes <mark> tags. */
function sanitizeExcerpt(html) {
  return String(html || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;mark&gt;/gi, '<mark>')
    .replace(/&lt;\/mark&gt;/gi, '</mark>');
}

function resultUrl(data) {
  let url = data.url || data.meta?.url || '#';
  try {
    if (url.startsWith('http')) {
      const u = new URL(url);
      url = u.pathname + u.search + u.hash;
    }
  } catch (_) {
    /* keep as-is */
  }
  return url;
}

function renderResults(listEl, statusEl, results, query) {
  listEl.innerHTML = '';
  const q = (query || '').trim();

  if (!q) {
    statusEl.textContent = 'Type to search the site.';
    return;
  }

  if (!results.length) {
    statusEl.textContent = `No results for “${q}”. Try different words.`;
    return;
  }

  statusEl.textContent = `${results.length} result${results.length === 1 ? '' : 's'} for “${q}”.`;

  const frag = document.createDocumentFragment();
  results.forEach((data) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = resultUrl(data);
    const title = data.meta?.title || data.title || 'Untitled page';
    const excerpt = data.excerpt || '';
    const url = resultUrl(data);
    a.innerHTML =
      `<span class="search-result-title">${escapeHtml(title)}</span>` +
      (excerpt ? `<span class="search-result-excerpt">${sanitizeExcerpt(excerpt)}</span>` : '') +
      `<span class="search-result-url">${escapeHtml(url)}</span>`;
    li.appendChild(a);
    frag.appendChild(li);
  });
  listEl.appendChild(frag);
}

async function runSearch(query, listEl, statusEl) {
  const q = (query || '').trim();
  if (!q) {
    renderResults(listEl, statusEl, [], '');
    return;
  }

  statusEl.textContent = 'Searching…';
  try {
    const pf = await loadPagefind();
    const search = await pf.search(q);
    const slice = (search.results || []).slice(0, MAX_RESULTS);
    const data = await Promise.all(slice.map((r) => r.data()));
    renderResults(listEl, statusEl, data, q);
  } catch (err) {
    console.error('Pagefind search failed:', err);
    statusEl.textContent = 'Search is temporarily unavailable. Please try again later.';
    listEl.innerHTML = '';
  }
}

function wireForm(form, listEl, statusEl) {
  const input = form.querySelector('input[type="search"], input[name="q"], .search-input');
  if (!input) return null;

  const doSearch = debounce(() => runSearch(input.value, listEl, statusEl), DEBOUNCE_MS);

  input.addEventListener('input', doSearch);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(debounceTimer);
    runSearch(input.value, listEl, statusEl);
  });

  return input;
}

function buildDialog() {
  const backdrop = document.createElement('div');
  backdrop.className = 'search-dialog-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('data-search-backdrop', '');
  backdrop.innerHTML = `
      <div class="search-dialog" role="dialog" aria-modal="true" aria-labelledby="site-search-title" tabindex="-1">
        <div class="search-dialog-header">
          <h2 id="site-search-title">Search</h2>
          <button type="button" class="search-dialog-close" data-search-close>Close</button>
        </div>
        <div class="search-dialog-body">
          <form class="search-form" data-search-form role="search">
            <label class="search-sr-only" for="site-search-input">Search AdvocateDadCO</label>
            <div class="search-input-wrap">
              <input class="search-input" id="site-search-input" name="q" type="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Search pages…" enterkeyhint="search">
              <button class="search-submit" type="submit">Search</button>
            </div>
            <p class="search-hint">Tip: press <kbd>Esc</kbd> to close. Open anytime with <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> or <kbd>/</kbd>.</p>
          </form>
          <p class="search-status" data-search-status role="status" aria-live="polite">Type to search the site.</p>
          <ul class="search-results" data-search-results></ul>
        </div>
      </div>
    `;
  document.body.appendChild(backdrop);
  return backdrop;
}

function injectHeaderButton() {
  const header = document.querySelector('.site-header');
  if (!header || header.querySelector('[data-search-open]')) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'search-open-btn';
  btn.setAttribute('data-search-open', '');
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-label', 'Open site search');
  btn.innerHTML =
    `<svg class="search-open-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M16 16l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>` +
    `<span class="search-open-label">Search</span>`;

    const tools = header.querySelector('.header-tools');
  const menuToggle = header.querySelector('.menu-toggle');
  if (tools && menuToggle) {
    tools.insertBefore(btn, menuToggle);
  } else if (tools) {
    tools.appendChild(btn);
  } else if (menuToggle) {
    header.insertBefore(btn, menuToggle);
  } else {
    header.appendChild(btn);
  }
  return btn;
}

function initDialog() {
  const openBtn = injectHeaderButton();
  const backdrop = buildDialog();
  const form = backdrop.querySelector('[data-search-form]');
  const listEl = backdrop.querySelector('[data-search-results]');
  const statusEl = backdrop.querySelector('[data-search-status]');
  const closeBtn = backdrop.querySelector('[data-search-close]');
  const input = wireForm(form, listEl, statusEl);

  let lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    loadPagefind().catch(() => {});
    requestAnimationFrame(() => {
      input?.focus();
      input?.select();
    });
  }

  function close() {
    backdrop.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus();
    } else if (openBtn) {
      openBtn.focus();
    }
  }

  openBtn?.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !backdrop.hidden) {
      e.preventDefault();
      close();
      return;
    }

    const tag = (e.target && e.target.tagName) || '';
    const inField =
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      (e.target && e.target.isContentEditable);

    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (backdrop.hidden) open();
      else input?.focus();
      return;
    }

    if (e.key === '/' && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      open();
    }
  });
}

function initSearchPage() {
  const pageRoot = document.getElementById('search-page');
  if (!pageRoot) return;

  const form = pageRoot.querySelector('[data-search-form]');
  const listEl = pageRoot.querySelector('[data-search-results]');
  const statusEl = pageRoot.querySelector('[data-search-status]');
  if (!form || !listEl || !statusEl) return;

  const input = wireForm(form, listEl, statusEl);
  loadPagefind().catch(() => {});

  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  if (q && input) {
    input.value = q;
    runSearch(q, listEl, statusEl);
  }
}

function onReady() {
  initDialog();
  initSearchPage();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', onReady);
} else {
  onReady();
}
