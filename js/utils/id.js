// Tiny id generator. Deliberately never resets within a page session: a
// node id can outlive the document it came from (a pending debounced
// autosave closure still holds one after the user switches documents) and
// must never collide with an id from whatever's loaded next.
//
// A bare incrementing counter used to be enough for that — until it
// collided with a *saved* id instead of a live one: parseMarkdown() calls
// this once per heading, so even a small document can burn through the
// first several counter values before the user does anything at all, and
// ids are persisted straight into the file (`<!-- dashboard:note:ID:start
// -->`). A file saved by an earlier, longer session can easily contain a
// low id like "note7" — plain content its own counter reached ages ago —
// and a freshly reloaded page's counter starts back at 0 and will reach
// that exact same value after only a handful of calls, silently colliding
// with it. Two notes sharing one id isn't cosmetic: deleting either one
// filters by id and removes both. Prefixing with the current time (to the
// millisecond, base36) makes a collision with anything saved in a
// *different* session require hitting the exact same millisecond, not
// just the same small integer — while the counter still guarantees
// uniqueness for two ids generated in the same session, including two in
// the same millisecond.
let counter = 0;

export function nextId(prefix = 'n') {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}
