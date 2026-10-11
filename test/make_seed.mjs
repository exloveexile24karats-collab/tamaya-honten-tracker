// 実サンプルの台構成で90日分の擬似データを作り、Firestore と同じキー構成で書き出す
import fs from "fs";
import path from "path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const A = await import(path.join(root, "test/.out/app_test.mjs"));
const base = A.parseAnaslo(fs.readFileSync(path.join(root, "test/samples/anaslo_dayB.txt"), "utf8")).rows;
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pois = (l) => { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
const kv = {};
const raw = {};
let d = "2026-07-01";
const closed = ["2026-08-15"];
for (let i = 0; i < 91; i++, d = A.addDays(d, 1)) {
  if (closed.includes(d)) continue;
  const rows = base.map((r) => {
    const hot = (r.no % 10 === 7 ? 0.35 : 0.15) + (d.endsWith("7") ? 0.25 : 0);
    const st = rnd() < hot ? 1.12 : 0.97 + rnd() * 0.06; // 設定の強さ（倍率）
    const g = Math.max(300, Math.round((r.g || 5000) * (0.6 + rnd() * 0.8)));
    const bb = pois(((r.bb || 1) / (r.g || 5000)) * g * st), rb = pois(((r.rb || 1) / (r.g || 5000)) * g * st);
    const s = Math.round((st - 1.0) * g * 3 * 3 + (rnd() - 0.5) * 4000);
    return { m: r.m, no: r.no, g, s, bb, rb, src: "a" };
  });
  raw[d] = A.packDay(rows);
}
const weeks = {};
Object.keys(raw).forEach((dd) => { const w = A.weekStartOf(dd); (weeks[w] = weeks[w] || {})[dd] = raw[dd]; });
let maxBytes = 0;
Object.entries(weeks).forEach(([w, b]) => { const s = JSON.stringify(b); maxBytes = Math.max(maxBytes, Buffer.byteLength(s)); kv[A.RAW_PREFIX + w] = s; });
kv[A.RAW_INDEX] = JSON.stringify(Object.keys(raw).sort());
kv[A.KEYS.pages] = JSON.stringify([
  { id: "p1", name: "マイジャグ", officialName: "マイジャグラーV" },
  { id: "p2", name: "喰種", officialName: "L東京喰種" },
  { id: "p3", name: "ジャグ混合", officialName: "ネオアイムジャグラーEX、ゴーゴージャグラー３" },
]);
const ev = {}; Object.keys(raw).forEach((dd) => { if (dd.endsWith("7")) ev[dd] = "7のつく日"; });
ev["2026-10-07"] = "7のつく日";
kv[A.KEYS.dateEvent] = JSON.stringify(ev);
kv[A.KEYS.strong] = JSON.stringify([{ name: "7のつく日" }]);
kv[A.KEYS.closed] = JSON.stringify(closed.map((x) => ({ date: x })).concat([{ date: "2026-09-30" }]));
kv[A.KEYS.gtype] = JSON.stringify({ [A.normalizeModelName("マイジャグラーV")]: { normal: 0, total: 3, dates: [] }, [A.normalizeModelName("L東京喰種")]: { normal: 3, total: 0, dates: [] } });
fs.writeFileSync(path.join(root, "test/.out/seed.json"), JSON.stringify(kv));
console.log("days", Object.keys(raw).length, "weeks", Object.keys(weeks).length, "max week bytes", maxBytes, "(limit 1,000,000)");
