// A trace buffer that stamps each line with the moment it was recorded (`at`, ms since the epoch), so a flush after
// the fact keeps recording order and the true time of each step (Codex review 8). A line that already carries `at` keeps it.
export function stampedBuffer() {
  const a = [];
  a.push = (...xs) => Array.prototype.push.apply(a, xs.map((x) => (x && typeof x === "object" && x.at === undefined ? { ...x, at: Date.now() } : x)));
  return a;
}
