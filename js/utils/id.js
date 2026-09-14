// Tiny incrementing id generator, reset per parse so ids stay stable within a session.
let counter = 0;

export function nextId(prefix = 'n') {
  counter += 1;
  return `${prefix}${counter.toString(36)}`;
}

export function resetIdCounter() {
  counter = 0;
}
