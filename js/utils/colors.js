// A small fixed accent palette. Each top-level section is assigned one accent
// (cycling through this list) and every card nested under it inherits the
// same accent, so color ties directly to document structure instead of
// being random per card.
export const PALETTE = [
  { accent: '#6C5CE7', soft: '#efe9ff' }, // violet
  { accent: '#0EA5A5', soft: '#e3fbf9' }, // teal
  { accent: '#E0793C', soft: '#fdece0' }, // copper
  { accent: '#3B82F6', soft: '#e7f0fe' }, // blue
  { accent: '#D6336C', soft: '#fce7ee' }, // rose
  { accent: '#2F9E44', soft: '#e7f7ea' }, // green
  { accent: '#B8860B', soft: '#faf1de' }, // amber
  { accent: '#6D28D9', soft: '#f0e9fc' }, // indigo
];

export function paletteFor(index) {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
}
