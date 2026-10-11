// テスト用：Firestore の代わりのメモリ保存。本物と同じく1MB上限・キュー・失敗時throw。
export const MAX_DOC_BYTES = 1_000_000;
const mem = (globalThis.__KV__ = globalThis.__KV__ || new Map());
const queues = new Map();
const enqueue = (k, job) => { const p = (queues.get(k) || Promise.resolve()).catch(() => {}).then(job); queues.set(k, p); return p; };
export const storage = {
  ready: true,
  async get(key) { await new Promise((r) => setTimeout(r, 1)); return mem.has(key) ? { key, value: mem.get(key) } : null; },
  set(key, value) {
    return enqueue(key, async () => {
      await new Promise((r) => setTimeout(r, 2));
      const size = new TextEncoder().encode(value).length;
      if (size > MAX_DOC_BYTES) throw new Error(`保存データが大きすぎます（${key}: ${size} bytes）`);
      if (globalThis.__FAIL_KEYS__ && globalThis.__FAIL_KEYS__.has(key)) throw new Error("テスト用の書き込み失敗");
      mem.set(key, value);
      return { key, value, size };
    });
  },
  delete(key) { return enqueue(key, async () => { mem.delete(key); return { key, deleted: true }; }); },
};
