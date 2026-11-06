// Обложки блокнотов: только CSS, без картинок — работают офлайн и весят ноль.
export const COVERS = {
  gingham: {
    name: 'Пудровая клетка',
    css: 'background-color:#F6DCE2;background-image:linear-gradient(90deg,rgba(214,138,158,.35) 50%,transparent 50%),linear-gradient(rgba(214,138,158,.35) 50%,transparent 50%);background-size:26px 26px;',
    ink: '#7A3E52',
  },
  sage: {
    name: 'Шалфей в горошек',
    css: 'background-color:#C9D9C2;background-image:radial-gradient(circle,#FFF8EF 3px,transparent 3.6px);background-size:22px 22px;',
    ink: '#3F5A3C',
  },
  linen: {
    name: 'Кремовый лён',
    css: 'background-color:#F3E7D6;background-image:repeating-linear-gradient(0deg,rgba(150,120,90,.07) 0 2px,transparent 2px 5px),repeating-linear-gradient(90deg,rgba(150,120,90,.06) 0 2px,transparent 2px 6px);',
    ink: '#6B4F3F',
  },
  lavender: {
    name: 'Лавандовые полоски',
    css: 'background-color:#E3DAF1;background-image:repeating-linear-gradient(90deg,#CFC0E8 0 14px,transparent 14px 30px);',
    ink: '#4F3F73',
  },
  terracotta: {
    name: 'Терракота',
    css: 'background-color:#D99178;background-image:linear-gradient(135deg,rgba(255,255,255,.18),transparent 60%);',
    ink: '#FFF6EE',
  },
  sky: {
    name: 'Голубая клетка',
    css: 'background-color:#DCE8F1;background-image:linear-gradient(90deg,rgba(134,174,203,.35) 1.5px,transparent 1.5px),linear-gradient(rgba(134,174,203,.35) 1.5px,transparent 1.5px);background-size:18px 18px;',
    ink: '#3E5A75',
  },
  flowers: {
    name: 'Ваниль в цветочек',
    css: 'background-color:#F7EBCB;background-image:radial-gradient(circle at 50% 50%,#E9B4C0 0 3px,transparent 3.5px),radial-gradient(circle at 50% 30%,#F2CFD8 0 4px,transparent 4.5px),radial-gradient(circle at 50% 70%,#F2CFD8 0 4px,transparent 4.5px),radial-gradient(circle at 30% 50%,#F2CFD8 0 4px,transparent 4.5px),radial-gradient(circle at 70% 50%,#F2CFD8 0 4px,transparent 4.5px);background-size:34px 34px;',
    ink: '#7A5A2E',
  },
  cocoa: {
    name: 'Шоколад',
    css: 'background-color:#6E5244;background-image:linear-gradient(160deg,rgba(255,255,255,.10),transparent 55%);',
    ink: '#F8E9DC',
  },
};

export const COVER_KEYS = Object.keys(COVERS);
