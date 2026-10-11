// 定期バックテスト（指示書 §6-7）
// 使い方: node tools/backtest.mjs <エクスポートJSON> [ウォームアップ日数=20]
// エクスポートJSONの各ページについて、前日までのデータだけで学習 → 翌日の結果と照合（ウォークフォワード）し、
// グレード別の「翌日☆〇出現率」と「翌日勝率（差枚プラス率）」を出す。
import fs from "fs";
import path from "path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
await import(path.join(root, "test/build_test_bundle.mjs"));
const A = await import(path.join(root, "test/.out/app_test.mjs"));
const file = process.argv[2];
const warmup = parseInt(process.argv[3] || "20", 10);
if (!file) { console.log("使い方: node tools/backtest.mjs <export.json> [warmup]"); process.exit(1); }
const ex = JSON.parse(fs.readFileSync(file, "utf8"));
const resolve = A.makeResolver(ex.modelAliases || {});
const closed = new Set((ex.closedDays || []).map((c) => c.date));
const strong = new Set((ex.strongEvents || []).map((s) => s.name));
const semi = new Set((ex.semiEvents || []).map((s) => s.name));
const evOn = (d) => String((ex.dateEventMap || {})[d] || "").split("、").map((x) => x.trim()).filter(Boolean);
const gt = ex.modelGTypes || {};
const opts = {
  eventsOn: evOn,
  isStrong: (d) => evOn(d).some((n) => strong.has(n)),
  isSemi: (d) => !evOn(d).some((n) => strong.has(n)) && evOn(d).some((n) => semi.has(n)),
  gtypeOf: (mk) => A.gtypeOfEntry(gt[mk]),
  profileOf: (mk) => { for (const n of Object.keys(A.SETTING_PROFILES)) if (resolve(n) === mk) return A.SETTING_PROFILES[n]; return null; },
};
const raw = ex.rawFullTable || {};
const dates = Object.keys(raw).sort();
const rows = dates.map((d) => ({ date: d, rows: A.unpackDay(raw[d]).map((r) => ({ ...r, em: A.effectiveModelName(r, ex.noModelMap || {}) })) }));
const total = {};
for (const p of ex.pages || []) {
  const keys = new Set(String(p.officialName || "").split("、").filter(Boolean).map(resolve));
  if (!keys.size) continue;
  const pageDays = rows.map((d) => ({ date: d.date, machines: d.rows.filter((r) => keys.has(resolve(r.em))).map((r) => {
    const mk = resolve(r.em);
    return { key: `${r.no}|${mk}`, no: r.no, model: r.em, modelKey: mk, g: r.g, s: r.s, bb: r.bb, rb: r.rb, src: r.src };
  }) })).filter((d) => d.machines.length);
  if (pageDays.length <= warmup + 1) { console.log(`\n■ ${p.name || p.id}: データ${pageDays.length}日（${warmup + 2}日以上必要）`); continue; }
  const bt = A.walkForwardBacktest(pageDays, opts, closed, warmup);
  console.log(`\n■ ${p.name || p.id}（${pageDays.length}日、最初の${warmup}日は学習のみ）`);
  console.log("グレード\t件数\t翌日☆〇率\t翌日勝率");
  for (const g of ["S", "A", "B", "C", "D", "E"]) {
    const b = bt[g];
    if (!b) continue;
    console.log(`${g}\t${b.n}\t${(b.good / b.n * 100).toFixed(1)}%\t${(b.win / b.n * 100).toFixed(1)}%`);
    total[g] = total[g] || { n: 0, good: 0, win: 0 };
    total[g].n += b.n; total[g].good += b.good; total[g].win += b.win;
  }
}
console.log("\n■ 全ページ合計");
for (const g of ["S", "A", "B", "C", "D", "E"]) if (total[g]) console.log(`${g}\t${total[g].n}\t${(total[g].good / total[g].n * 100).toFixed(1)}%\t${(total[g].win / total[g].n * 100).toFixed(1)}%`);
