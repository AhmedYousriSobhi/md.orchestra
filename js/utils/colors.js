// A small fixed accent palette. Each top-level section is assigned one accent
// (cycling through this list) and every card nested under it inherits the
// same accent, so color ties directly to document structure instead of
// being random per card. Any "soft" tinted background derived from an accent
// (e.g. the current top-level nav item) is computed in CSS with color-mix()
// against the theme's own surface color, rather than stored here as a fixed
// hex — a fixed light pastel wouldn't adapt when the page switches to dark
// mode.
export const PALETTE = [
  { accent: '#6C5CE7' }, // violet
  { accent: '#0EA5A5' }, // teal
  { accent: '#E0793C' }, // copper
  { accent: '#3B82F6' }, // blue
  { accent: '#D6336C' }, // rose
  { accent: '#2F9E44' }, // green
  { accent: '#B8860B' }, // amber
  { accent: '#6D28D9' }, // indigo
];

export function paletteFor(index) {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
}
