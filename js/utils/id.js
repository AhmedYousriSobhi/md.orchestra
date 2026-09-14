// Tiny incrementing id generator. Deliberately never resets: it must stay
// unique for the whole page session, not just within one parsed document —
// a node id can outlive the document it came from (a pending debounced
// autosave closure still holds one after the user switches documents) and
// must never collide with an id from whatever's loaded next.
let counter = 0;

export function nextId(prefix = 'n') {
  counter += 1;
  return `${prefix}${counter.toString(36)}`;
}
