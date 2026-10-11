import { db, firebaseReady } from "./firebase";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";

// Firestore の "kv" コレクションに 1キー=1ドキュメントで保存する。
// ・Firestore は1ドキュメント約1MiBが上限。超えると失敗するので、書き込む前に
//   サイズを測り、上限を超える場合は「書き込まずに」エラーにする（黙って失敗させない）。
// ・同じキーへの書き込みはキュー（Promise chain）で必ず順番に実行する。
// ・失敗は必ず throw する。呼び出し側は成功を確認してから「保存しました」を出す。
const COLLECTION = "kv";
export const MAX_DOC_BYTES = 1_000_000;
const queues = new Map();

function byteLength(str) {
  return new TextEncoder().encode(str).length;
}

function enqueue(key, job) {
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(job);
  queues.set(key, run);
  return run;
}

function requireDb() {
  if (!firebaseReady || !db) throw new Error("Firebaseが未設定です（src/firebase.js を設定してください）");
}

export const storage = {
  ready: firebaseReady,
  async get(key) {
    requireDb();
    const snap = await getDoc(doc(db, COLLECTION, key));
    if (!snap.exists()) return null;
    return { key, value: snap.data().value };
  },
  set(key, value) {
    return enqueue(key, async () => {
      requireDb();
      const size = byteLength(value);
      if (size > MAX_DOC_BYTES) {
        throw new Error(`保存データが大きすぎます（${key}: ${size.toLocaleString()} bytes）。保存していません。`);
      }
      await setDoc(doc(db, COLLECTION, key), { value, updatedAt: Date.now() });
      return { key, value, size };
    });
  },
  delete(key) {
    return enqueue(key, async () => {
      requireDb();
      await deleteDoc(doc(db, COLLECTION, key));
      return { key, deleted: true };
    });
  },
};
