// Общие элементы: всплывающие подсказки, нижние листы с действиями, диалоги.
import { icon } from './icons.js';

export function h(tag, attrs = {}, html = '') {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  if (html) node.innerHTML = html;
  return node;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
export function toast(text) {
  let t = document.querySelector('.toast');
  if (!t) { t = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// Нижний лист со списком действий. items: [{label, icon, onClick, danger, checked}]
export function sheet({ title, items, onClose }) {
  const back = h('div', { class: 'scrim' });
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Меню' });
  if (title) box.append(h('div', { class: 'sheet-title' }, esc(title)));
  const close = () => { back.classList.remove('open'); setTimeout(() => back.remove(), 220); onClose && onClose(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  for (const it of items) {
    if (it.separator) { box.append(h('div', { class: 'sheet-sep' })); continue; }
    const b = h('button', { class: 'sheet-item' + (it.danger ? ' danger' : ''), type: 'button' },
      `${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.checked != null ? `<span class="switch${it.checked ? ' on' : ''}"></span>` : ''}`);
    b.addEventListener('click', () => { close(); it.onClick && it.onClick(); });
    box.append(b);
  }
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add('open'));
  box.querySelector('button')?.focus({ preventScroll: true });
  return close;
}

// Диалог с произвольным содержимым. render(body, close) наполняет тело; кнопки — actions.
export function dialog({ title, render, actions }) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'scrim' });
    const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    box.append(h('h2', { class: 'dialog-title' }, esc(title)));
    const body = h('div', { class: 'dialog-body' });
    box.append(body);
    const foot = h('div', { class: 'dialog-actions' });
    const close = (value) => { back.classList.remove('open'); setTimeout(() => back.remove(), 220); document.removeEventListener('keydown', onKey); resolve(value); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const ctx = render ? render(body, close) : null;
    for (const a of actions) {
      const b = h('button', { class: 'btn ' + (a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-ghost'), type: 'button' }, esc(a.label));
      b.addEventListener('click', () => close(a.value === undefined ? (ctx && ctx.value ? ctx.value() : true) : a.value));
      foot.append(b);
    }
    box.append(foot);
    back.append(box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
    document.addEventListener('keydown', onKey);
    document.body.append(back);
    requestAnimationFrame(() => back.classList.add('open'));
    const first = box.querySelector('input, button');
    first && first.focus({ preventScroll: true });
  });
}

export function confirmDialog(title, text, okLabel = 'Удалить') {
  return dialog({
    title,
    render: (body) => { body.append(h('p', { class: 'dialog-text' }, esc(text))); },
    actions: [{ label: 'Отмена', value: false }, { label: okLabel, value: true, danger: true }],
  });
}

// Сохранить файл: на iPad — через «Поделиться» (можно сразу в Фото или Файлы), иначе скачать.
export async function saveFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
