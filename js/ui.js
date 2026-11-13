// Small UI toolkit: element builder, icons, slide-up panels and toasts.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

const PATHS = {
  today: '<path d="M4 6.5h16M7 3v3M17 3v3"/><rect x="4" y="5" width="16" height="15" rx="2.5"/><circle cx="12" cy="13.5" r="2.2"/>',
  week: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 10v10M15 10v10M7 3v3M17 3v3"/>',
  meals: '<path d="M7 3v8a2 2 0 0 0 2 2v8M7 3v5M10 3v5a3 3 0 0 1-3 3M16 21V3c2.2 1.3 3 4 3 7s-1 4-3 4"/>',
  lists: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  car: '<path d="M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2M19 16v2"/><circle cx="8" cy="13" r="1"/><circle cx="16" cy="13" r="1"/>',
  pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 9a4.5 4.5 0 0 1 .5 9z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  partly: '<circle cx="9" cy="8" r="3"/><path d="M9 2.5v1M3.5 8h1M5.1 4.1l.7.7M12.9 4.1l-.7.7"/><path d="M9 20a3.5 3.5 0 0 1-.4-7A4.8 4.8 0 0 1 17.6 12a3.9 3.9 0 0 1 .4 8z"/>',
  rain: '<path d="M7 15a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 6a4.5 4.5 0 0 1 .5 9z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  snow: '<path d="M7 14a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 5a4.5 4.5 0 0 1 .5 9z"/><path d="M8 18h.01M12 20h.01M16 18h.01M10 22h.01M14 22h.01"/>',
  storm: '<path d="M7 15a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 6a4.5 4.5 0 0 1 .5 9z"/><path d="M12 14l-2 4h4l-2 4"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v3h3M4 13a8 8 0 0 0 14.5 4.5M20 20v-3h-3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18c1.3 0 2-.8 2-1.8 0-1.4-1.2-1.6-1.2-2.8 0-.9.8-1.4 1.7-1.4H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.6c2.4.2 4 1.9 4.5 4.6"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  home: '<path d="M4 11l8-7 8 7M6 9.5V20h12V9.5"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  book: '<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  google: '<path d="M20.5 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.6-3.9 2.6-6.5z"/><path d="M12 21c2.4 0 4.5-.8 5.9-2.2L15 16.6c-.8.5-1.8.9-3 .9-2.3 0-4.3-1.6-5-3.7H4v2.3A9 9 0 0 0 12 21z"/><path d="M7 13.8a5.4 5.4 0 0 1 0-3.5V8H4a9 9 0 0 0 0 8.1z"/><path d="M12 6.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 4 8l3 2.3c.7-2.1 2.7-3.7 5-3.7z"/>',
  cart: '<path d="M3 4h2l2.4 11h10.2L20 8H6.2"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  quote: '<path d="M10 7H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1a3 3 0 0 1-3 3M20 7h-4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1a3 3 0 0 1-3 3"/>',
  layout: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="14" width="8" height="6" rx="1.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-5 4 4 2.5-2.5L20 17"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `ic ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
  return span;
}

/* ---------- Slide-up panel ---------- */
let openSheet = null;
export function sheet(title, body, { actions = null, onClose = null, wide = false } = {}) {
  closeSheet(true);
  const panel = h('div', { class: `sheet${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'grip' }),
    h('div', { class: 'sheet-head' },
      h('h2', null, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => closeSheet() }, icon('x'))),
    h('div', { class: 'sheet-body' }, body),
    actions ? h('div', { class: 'sheet-actions' }, actions) : null);
  const back = h('div', { class: 'backdrop', onclick: () => closeSheet() });
  const wrap = h('div', { class: 'sheet-wrap' }, back, panel);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey);
  // Swipe down on the grip or header to close.
  let y0 = null;
  const head = panel.querySelector('.sheet-head');
  [panel.querySelector('.grip'), head].forEach((el) => {
    el.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchmove', (e) => { if (y0 === null) return; const dy = Math.max(0, e.touches[0].clientY - y0); panel.style.transform = `translateY(${dy}px)`; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      const dy = y0 === null ? 0 : e.changedTouches[0].clientY - y0;
      y0 = null;
      panel.style.transform = '';
      if (dy > 90) closeSheet();
    });
  });
  openSheet = { wrap, onKey, onClose };
  const first = panel.querySelector('[autofocus]');
  if (first) setTimeout(() => first.focus(), 260);
  return panel;
}

export function closeSheet(instant = false) {
  if (!openSheet) return;
  const { wrap, onKey, onClose } = openSheet;
  openSheet = null;
  document.removeEventListener('keydown', onKey);
  if (onClose) onClose();
  if (instant) { wrap.remove(); return; }
  wrap.classList.remove('open');
  setTimeout(() => wrap.remove(), 260);
}

/* ---------- Toast ---------- */
let toastTimer = null;
export function toast(message, { action = null, onAction = null, ms = 3200 } = {}) {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(el); }
  el.replaceChildren(h('span', null, message), action ? h('button', { onclick: () => { el.classList.remove('show'); onAction(); } }, action) : null);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function segmented(options, value, onPick) {
  return h('div', { class: 'seg', role: 'tablist' }, options.map(([v, label]) => h('button', {
    role: 'tab', 'aria-selected': String(v === value), class: v === value ? 'on' : '', onclick: () => onPick(v),
  }, label)));
}

export function haptic() { try { if (navigator.vibrate) navigator.vibrate(8); } catch { /* fine */ } }
