// jsdom でアプリを実際に描画し、実サンプルを貼り付けて保存→画面を確認する
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
const window = dom.window;
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout });
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const errors = [];
const origErr = console.error;
console.error = (...a) => { const s = a.map(String).join(" "); if (!/width\(0\) and height\(0\)|not wrapped in act/.test(s)) errors.push(s); };
window.confirm = () => true;

// 事前データ（seed）があれば Firestore スタブに入れる
if (process.env.SEED) {
  const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8"));
  globalThis.__KV__ = new Map(Object.entries(seed));
}
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const App = (await import(path.join(root, "test/.out/app_test.mjs"))).default;
const container = document.getElementById("root");
const rootR = createRoot(container);
await act(async () => { rootR.render(React.createElement(App)); });
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)));
await wait(80);
const text = () => container.textContent;
const byText = (sel, t) => [...container.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(t));
const click = async (el) => { if (!el) throw new Error("element not found"); await act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); await wait(30); };
const setVal = async (el, v) => {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  await act(async () => { el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
  await wait(10);
};
const ok = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) process.exitCode = 1; };

const mode = process.env.MODE || "paste";
ok(text().includes("玉屋本店 台データ推移トラッカー"), "タイトル表示");
ok(text().includes("v0.1.0"), "バージョン表示");

if (mode === "paste") {
  ok(text().includes("まだデータがありません"), "初期状態（データ無し）の案内");
  await click(byText(".tab", "共通設定"));
  ok(text().includes("ロック中"), "ロック中表示");
  await setVal(container.querySelector('input[type="password"]'), "5246");
  await click(byText("button", "解除"));
  ok(text().includes("① 民レポ"), "PIN解除で入力欄表示");
  const S = path.join(root, "test/samples/");
  const dates = container.querySelectorAll('input[type="date"]');
  await setVal(dates[0], "2026-10-10");
  await setVal(container.querySelectorAll("textarea")[0], fs.readFileSync(S + "minrepo_dayB.txt", "utf8"));
  await click(byText("button", "この日の民レポを保存"));
  await wait(100);
  ok(text().includes("2026-10-10 の民レポを保存しました（機種44・バラエティ32・末尾11）"), "民レポ保存（成功確認後に表示）");
  await setVal(container.querySelectorAll('input[type="date"]')[1], "2026-10-10");
  await setVal(container.querySelectorAll("textarea")[1], fs.readFileSync(S + "anaslo_dayB.txt", "utf8"));
  await click(byText("button", "この日のアナスロを保存"));
  await wait(150);
  ok(text().includes("2026-10-10 のアナスロを保存しました（509台"), "アナスロ保存");
  ok(text().includes("バラエティ台の名前違い2件を台番号で自動照合"), "バラエティ別名の自動照合");
  ok(text().includes("名前が違う機種の候補が3件"), "名前違い候補3件");
  ok(text().includes("沖ドキ！ＧＯＬＤ（民レポ10/アナスロ17）"), "GOLDの台数不一致を検出");
  // 照合パネルで候補を確定
  for (let i = 0; i < 3; i++) await click(byText("button", "同じ機種として登録"));
  await wait(50);
  ok(!byText("button", "同じ機種として登録"), "候補3件を登録して候補が消えた");
  // 個別台（ゴージャス相当のテストとして SAO を貼る：アナスロ登録済みの日なので保存はされない）
  await setVal(container.querySelectorAll('input[type="date"]')[2], "2026-10-10");
  await setVal(container.querySelectorAll("textarea")[2], fs.readFileSync(S + "kobetsu_sao_dayB.txt", "utf8"));
  ok(text().includes("読み取った機種名：スロット ソードアート・オンラインⅡ"), "個別台の機種名を自動判定");
  await click(byText("button", "個別台データを保存"));
  await wait(50);
  ok(text().includes("アナスロ登録済みのため、代用データは保存していません"), "アナスロ登録済みの日は代用データを保存しない");
  // 個別台を別の日（アナスロ未登録）に保存 → 代用データ
  await setVal(container.querySelectorAll('input[type="date"]')[2], "2026-10-11");
  await setVal(container.querySelectorAll("textarea")[2], fs.readFileSync(S + "kobetsu_sao_dayB.txt", "utf8"));
  await click(byText("button", "個別台データを保存"));
  await wait(80);
  ok(text().includes("12台分を代用データとして保存"), "個別台の代用データ保存");
  // 保存内容（スタブ）を確認
  const kvm = globalThis.__KV__;
  const keys = [...kvm.keys()].sort();
  ok(keys.includes("slot-raw-fulltable-v1:week:2026-10-05") && keys.includes("slot-raw-fulltable-index-v1"), "アナスロは週キー＋索引で保存");
  ok(keys.includes("slot-overall-summary-v1:week:2026-10-05") && keys.includes("slot-overall-summary-index-v1"), "民レポも週キー＋索引で保存");
  ok(JSON.parse(kvm.get("slot-raw-fulltable-index-v1")).join() === "2026-10-10,2026-10-11", "索引に両日付");
  const al = JSON.parse(kvm.get("slot-model-aliases-v1"));
  ok(Object.keys(al).length === 5, `別名5件（バラエティ2＋候補3）: ${Object.values(al).join(" / ")}`);
  const gt = JSON.parse(kvm.get("slot-model-gtype-v1"));
  const emoji = (k) => { const e = gt[k]; return e ? (e.normal ? "normal" : "total") : "none"; };
  ok(emoji("東京喰種") === "normal" && emoji("マイジャグラーv") === "total", `G数の種類：喰種=${emoji("東京喰種")} マイジャグ=${emoji("マイジャグラーv")}`);
  // ページ追加 → マイジャグラーV
  await click(byText(".tab", "ページ追加"));
  await wait(30);
  ok(text().includes("ページの設定"), "ページ追加→編集画面");
  const nameIn = container.querySelector('input[placeholder="タブに出す名前（例：マイジャグ）"]');
  await setVal(nameIn, "マイジャグ");
  await act(async () => { nameIn.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })); });
  await wait(30);
  const off = container.querySelector('input[placeholder="機種名を入力して追加"]');
  await setVal(off, "マイジャグラーV");
  await click(byText("button", "追加"));
  await wait(100);
  ok(text().includes("のピックアップ（実測パターン方式）"), "ピックアップ見出し（M/D形式）");
  ok(text().includes("10/11のピックアップ"), "予想日＝最終データ日(10/10)の次の営業日");
  ok(text().includes("データ蓄積中"), "1日分なのでデータ蓄積中の表示");
  ok(text().includes("記号マトリクス") && text().includes("設定期待度マトリクス"), "マトリクス2種表示");
  ok((text().match(/前日/g) || []).length >= 45, "45台分のピックアップカード");
  // ロックすると編集欄が消える
  await click(byText(".tab", "共通設定"));
  await click(byText("button", "ロックする"));
  await click(byText(".tab", "マイジャグ"));
  ok(!text().includes("ページの設定"), "ロック中は正式名称などの編集情報を出さない");
  // 全体データ
  await click(byText(".tab", "全体データ"));
  ok(text().includes("店全体の推移") && text().includes("2026-10-10"), "全体データ表示");
  // 書き込み失敗時に「保存しました」を出さない
  globalThis.__FAIL_KEYS__ = new Set(["slot-overall-summary-v1:week:2026-10-05"]);
  await click(byText(".tab", "共通設定"));
  await setVal(container.querySelector('input[type="password"]'), "5246");
  await click(byText("button", "解除"));
  await setVal(container.querySelectorAll('input[type="date"]')[0], "2026-10-09");
  await setVal(container.querySelectorAll("textarea")[0], fs.readFileSync(S + "minrepo_dayA.txt", "utf8"));
  await click(byText("button", "この日の民レポを保存"));
  await wait(80);
  ok(text().includes("保存に失敗しました") && !text().includes("2026-10-09 の民レポを保存しました"), "書き込み失敗→失敗を表示（保存しましたは出さない）");
  ok(!JSON.parse(kvm.get("slot-overall-summary-index-v1")).includes("2026-10-09"), "失敗した日付は索引に入らない");
  globalThis.__FAIL_KEYS__ = null;
  fs.writeFileSync(path.join(root, "test/.out/kv_after_paste.json"), JSON.stringify(Object.fromEntries(kvm)));
}

if (mode === "seeded") {
  await click(byText(".tab", process.env.PAGE || "マイジャグ"));
  await wait(200);
  ok(text().includes("のピックアップ（実測パターン方式）"), "ピックアップ表示");
  if (process.env.EXPECT) ok(text().includes(process.env.EXPECT), `見出し「${process.env.EXPECT}」`);
  const m = text().match(/学習済みパターン(\d+)件/);
  ok(m && +m[1] > 0, `学習済みパターン ${m && m[1]}件`);
  const grades = [...container.querySelectorAll("span.mono")].map((e) => e.textContent).filter((t) => /^[SABCDE]$/.test(t));
  ok(grades.length > 0, `グレード分布 ${JSON.stringify(grades.reduce((a, g) => ((a[g] = (a[g] || 0) + 1), a), {}))}`);
  ok(/[☆〇▽□×]/.test(text()), "記号マトリクスに記号");
}

if (mode === "import") {
  // シードの中身をエクスポート形式に変換して、空のアプリにインポートする
  const seed = JSON.parse(fs.readFileSync(path.join(root, "test/.out/seed.json"), "utf8"));
  const rawFull = {};
  Object.keys(seed).filter((k) => k.startsWith("slot-raw-fulltable-v1:week:")).forEach((k) => Object.assign(rawFull, JSON.parse(seed[k])));
  const exp = { app: "tamaya-honten-tracker", pages: JSON.parse(seed["slot-pages-v1"]), dateEventMap: JSON.parse(seed["slot-date-event-map-v1"]), strongEvents: JSON.parse(seed["slot-strong-events-v1"]), closedDays: JSON.parse(seed["slot-closed-days-v1"]), rawFullTable: rawFull, rawFullTableFormat: "packed-v1", overallSummaries: [] };
  await click(byText(".tab", "共通設定"));
  await setVal(container.querySelector('input[type="password"]'), "5246");
  await click(byText("button", "解除"));
  const input = container.querySelector('input[type="file"]');
  const file = new window.File([JSON.stringify(exp)], "x.json", { type: "application/json" });
  if (!file.text) file.text = async () => JSON.stringify(exp);
  Object.defineProperty(input, "files", { value: [file] });
  await act(async () => { input.dispatchEvent(new window.Event("change", { bubbles: true })); });
  await wait(600);
  ok(text().includes("取り込みが完了しました"), "インポート完了");
  const idx = JSON.parse(globalThis.__KV__.get("slot-raw-fulltable-index-v1"));
  ok(idx.length === 90, `インポート後の索引 ${idx.length}日`);
  await click(byText(".tab", "マイジャグ"));
  await wait(200);
  ok(/学習済みパターン\d+件/.test(text()) && !text().includes("学習済みパターン0件"), "インポートしたデータでピックアップ");
}

ok(errors.length === 0, `Reactエラーなし${errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""}`);
await act(async () => rootR.unmount());
