// Тонкие линейные иконки (24×24). Цвет берут из currentColor.
const P = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 010 10H12"/>',
  redo: '<path d="M15 7l4.5 4.5L15 16"/><path d="M19 11.5H9.5a5 5 0 000 10H12"/>',
  share: '<path d="M12 3.5v11"/><path d="M8 7.5l4-4 4 4"/><path d="M6 11.5H5a1.5 1.5 0 00-1.5 1.5v6A1.5 1.5 0 005 20.5h14a1.5 1.5 0 001.5-1.5v-6a1.5 1.5 0 00-1.5-1.5h-1"/>',
  pen: '<path d="M4 20l1.2-4.6L15.6 5a2.1 2.1 0 013 3L8.2 18.4z"/><path d="M13.8 6.8l3.4 3.4"/>',
  pencil: '<path d="M4 20l1-4 11-11 3 3-11 11z"/><path d="M5 16l3 3"/><path d="M14 7l3 3"/>',
  marker: '<path d="M9.5 14.5l-3 3H4v-2.5l3-3"/><path d="M7 12l7.5-7.5a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L12 17z"/><path d="M4 20.5h7"/>',
  eraser: '<path d="M8 20h12"/><path d="M5.2 15.8l9.4-9.4a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L12 19.1a3 3 0 01-4.2 0l-2.6-2.6a.5.5 0 010-.7z"/><path d="M10 11l5 5"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 12.5a1.5 1.5 0 001.5 1.4h6a1.5 1.5 0 001.5-1.4l1-12.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  book: '<path d="M5 4.5h11a2 2 0 012 2v13H7a2 2 0 01-2-2z"/><path d="M5 17.5a2 2 0 012-2h11"/>',
  page: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/>',
  hand: '<path d="M8 13V6.5a1.5 1.5 0 013 0V12"/><path d="M11 11V5a1.5 1.5 0 013 0v6"/><path d="M14 11V6.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-1a5 5 0 01-4-2l-2.5-3.3a1.4 1.4 0 012-2L8 15"/>',
  download: '<path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 19.5h14"/>',
  upload: '<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M5 19.5h14"/>',
  shield: '<path d="M12 3.5l7 3v5.5c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V6.5z"/><path d="M9 12l2 2 4-4"/>',
  fit: '<path d="M4 9V4.5h4.5M15.5 4.5H20V9M20 15v4.5h-4.5M8.5 19.5H4V15"/>',
  clear: '<path d="M5 5l14 14M19 5L5 19"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  brush: '<path d="M14.5 4.5l5 5-7.8 7.8a2.5 2.5 0 01-3.5 0l-1.5-1.5a2.5 2.5 0 010-3.5z"/><path d="M6.7 16.3c-1.2 1.2-1.4 2.7-3.2 3.7 2.6.6 5.3.1 6.6-1.9"/>',
  bulb: '<path d="M9 17.5h6"/><path d="M10 20.5h4"/><path d="M12 3.5a5.5 5.5 0 00-3.3 9.9c.6.5 1 1.3 1 2.1h4.6c0-.8.4-1.6 1-2.1A5.5 5.5 0 0012 3.5z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.8v.2"/>',
  sticker: '<path d="M14.5 20.5H7a3.5 3.5 0 01-3.5-3.5V7A3.5 3.5 0 017 3.5h10A3.5 3.5 0 0120.5 7v7.5z"/><path d="M14.5 20.5V17a2.5 2.5 0 012.5-2.5h3.5"/><path d="M9 10.5h.01M15 10.5h.01"/><path d="M9.5 14c1.5 1.2 3.5 1.2 5 0"/>',
  shape: '<circle cx="8" cy="8" r="4.5"/><path d="M13.5 20.5l4-7 4 7z"/><rect x="3.5" y="14.5" width="6" height="6" rx="1"/><path d="M14.5 4.5h6v6"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 100 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.3-1.6-1.3-2.8 0-1 .8-1.6 1.9-1.6h2.2a3.9 3.9 0 003.9-3.9c0-3.9-3.8-7-8.5-7z"/><circle cx="7.8" cy="11.5" r="1.1"/><circle cx="10.3" cy="7.7" r="1.1"/><circle cx="14.8" cy="7.9" r="1.1"/>',
};

export function icon(name, size = 22) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
