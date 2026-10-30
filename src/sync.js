// Merging two copies of the data (this browser and the copy in Telegram).
// Every document carries `u` (last change, ms); deletions are kept as tombstones
// so a record removed on one device does not come back from the other.
export const emptyState = () => ({ docs: {}, deleted: {} });

export function mergeStates(a, b) {
  a = a || emptyState(); b = b || emptyState();
  const docs = {}, deleted = {};
  const ids = new Set([...Object.keys(a.docs || {}), ...Object.keys(b.docs || {}), ...Object.keys(a.deleted || {}), ...Object.keys(b.deleted || {})]);
  for (const id of ids) {
    const da = a.docs?.[id], db = b.docs?.[id];
    const doc = !da ? db : !db ? da : (db.u || 0) > (da.u || 0) ? db : da;
    const del = Math.max(a.deleted?.[id] || 0, b.deleted?.[id] || 0);
    if (del && del >= (doc?.u || 0)) deleted[id] = del;
    else if (doc) docs[id] = doc;
  }
  return { docs, deleted };
}

// Cheap fingerprint to tell whether two states differ.
export function fingerprint(s) {
  const d = Object.entries(s.docs || {}).map(([id, v]) => `${id}:${v.u || 0}`).sort();
  const t = Object.entries(s.deleted || {}).map(([id, v]) => `${id}~${v}`).sort();
  return d.concat(t).join("|");
}
