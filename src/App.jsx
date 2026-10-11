// =============================================================================
// 玉屋本店 台データ推移トラッカー
// 形式（画面・Firebase・PWA）はプラザ2を手本に、エンジンは指示書 §4 の仕様で新規実装。
// このファイルの前半は「純粋なロジック」（パーサー・機種名照合・エンジン）で、
// テスト／バックテスト用に export している。後半が画面（React）。
// =============================================================================
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Trash2, Lock, X, ChevronDown, ChevronRight, Star, Flag, Plus } from "lucide-react";
import { storage } from "./storage";

// v0.1.0: 初版（プラザ2の形式＋指示書§4のエンジン＋本店用パーサー）
// v0.2.0: イベントの対象機種を登録できるように。
//   ①イベント名ごとの「いつもの対象機種」（slot-event-targets-v1）
//   ②日付×イベントごとの「その日の対象機種」（slot-date-event-targets-v1、3×3のように毎回違う機種用）
//   予想日の対象機種は🎯で表示し、エンジンに「イベント対象機種」「対象機種があるイベントで対象外」の
//   パターンを追加（効くかどうかは他のパターンと同じく実測で点数化、n<15は0pt）。
export const APP_VERSION = "0.2.0";
const UNLOCK_PIN = "5246";

// ---- 保存キー（指示書 §4-4）----
export const KEYS = {
  pages: "slot-pages-v1",
  eventNames: "slot-event-names-v1",
  strong: "slot-strong-events-v1",
  semi: "slot-semi-events-v1",
  closed: "slot-closed-days-v1",
  dateEvent: "slot-date-event-map-v1",
  undo: "slot-undo-history-v1",
  // 本店で追加：機種名の別名・台番号→機種の対応・機種ごとのG数の種類
  aliases: "slot-model-aliases-v1",
  noModel: "slot-no-model-map-v1",
  gtype: "slot-model-gtype-v1",
  eventTargets: "slot-event-targets-v1", // { イベント名: [機種名...] }（いつも同じ対象機種）
  dateEventTargets: "slot-date-event-targets-v1", // { 日付: { イベント名: [機種名...] } }（その日の対象機種）
};
export const RAW_PREFIX = "slot-raw-fulltable-v1:week:";
export const RAW_INDEX = "slot-raw-fulltable-index-v1";
export const OVR_PREFIX = "slot-overall-summary-v1:week:";
export const OVR_INDEX = "slot-overall-summary-index-v1";

// ---- 確率表（対象機種が決まったらここに追加）----
// type "A"  : ボーナス機。bb/rb の各設定の分母（1/X の X）。尤度は BB回数・RB回数のポアソン。
// type "AT" : AT機。hit = 設定別の初当たり分母、count = アナスロのどの列を初当たり回数とみなすか（"bb" | "rb" | "bbrb"）。
// キーは機種名（表記ゆれは自動で吸収）。登録が無い機種は「暫定読み取り（店内の合算確率の順位）」で動く。
export const SETTING_PROFILES = {
  // 例）"マイジャグラーV": { type: "A", settings: [1,2,3,4,5,6], big: [273.1,270.8,266.4,254.0,240.1,229.1], reg: [409.6,385.5,336.1,290.0,268.6,229.1] },
};

// =============================================================================
// 日付ユーティリティ（タイムゾーンの影響を受けないよう UTC で計算）
// =============================================================================
export function addDays(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
export function weekdayOf(d) {
  return new Date(`${d}T00:00:00Z`).getUTCDay();
}
export function weekStartOf(d) {
  const wd = weekdayOf(d);
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}
export function nextOpenDate(d, closedSet) {
  let x = addDays(d, 1);
  for (let i = 0; i < 60 && closedSet && closedSet.has(x); i++) x = addDays(x, 1);
  return x;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const WD = ["日", "月", "火", "水", "木", "金", "土"];
function md(d) {
  return `${parseInt(d.slice(5, 7), 10)}/${parseInt(d.slice(8, 10), 10)}`;
}

// =============================================================================
// 数値パース
// =============================================================================
function toAsciiMinus(s) {
  return String(s).replace(/[−－‐‑–—]/g, "-");
}
export function parseIntLoose(s) {
  if (s === null || s === undefined) return null;
  const t = toAsciiMinus(String(s).normalize("NFKC")).replace(/[,\s]/g, "");
  if (!/^[+-]?\d+$/.test(t)) return null;
  return parseInt(t, 10);
}
function parsePct(s) {
  if (s === null || s === undefined) return null;
  const t = toAsciiMinus(String(s).normalize("NFKC")).replace(/[%\s,]/g, "");
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  return parseFloat(t);
}

// =============================================================================
// 機種名の照合（指示書 §4-5 modelNamesMatch）
// NFKC → 空白除去 → （読みがな等の）括弧書き除去 → 記号統一 → 接頭辞除去（繰り返し）→ 小文字化
// 例: 「Lパチスロ革命機ヴァルヴレイヴ」=「革命機ヴァルヴレイヴ」、
//     「スマスロ 甲鉄城のカバネリ 海門決戦」=「甲鉄城のカバネリ 海門(うなと)決戦」
// =============================================================================
export function normalizeModelName(name) {
  let s = String(name || "").normalize("NFKC");
  s = s.replace(/\s+/g, "");
  s = s.replace(/[(（][^)）]*[)）]/g, "");
  s = s.replace(/[〜～~]/g, "~").replace(/[‐‑–—−―]/g, "-");
  for (let k = 0; k < 5; k++) {
    const before = s;
    s = s.replace(/^(スマスロ|パチスロ|スロット|L(?=[^a-z]))/, "");
    if (s === before) break;
  }
  return s.toLowerCase();
}
// aliases: { 正規化名: 正式名称（民レポ側の表記） }
export function makeResolver(aliases) {
  const a = aliases || {};
  return (name) => {
    const n = normalizeModelName(name);
    return a[n] ? normalizeModelName(a[n]) : n;
  };
}
export function modelNamesMatch(x, y, resolve) {
  if (!x || !y) return false;
  const r = resolve || normalizeModelName;
  return r(x) === r(y);
}
// 台番号→機種の上書き（アナスロが2機種を1つの名前でまとめて表示する場合用。例: 沖ドキGOLD/ゴージャス）。
// 覚えた時点のアナスロ表記（anasloName）と今の表記が同じ時だけ上書きする
// ＝新台入れ替えで別機種になったら自動で無効になる。
export function effectiveModelName(row, noModelMap) {
  const o = noModelMap && noModelMap[row.no];
  if (o && o.model && (!o.anasloName || normalizeModelName(o.anasloName) === normalizeModelName(row.m))) return o.model;
  return row.m;
}

// =============================================================================
// パーサー（指示書 §5：本店のサンプルで確認済みの形式）
// =============================================================================
// 民レポ：機種別（見出しが15行ごとに繰り返す）→「バラエティ（1台設置機種）」（機種/台番/差枚/G数/出率）→「末尾別データ」
// 末尾別の「-」は「マイナスで数値非表示」なので、差枚は null＋hiddenNegative、出率は null（不明）として持つ。
export function parseOverallSummary(text) {
  const lines = String(text || "").split(/\r?\n/);
  let mode = "model";
  let pending = "";
  const modelRows = [];
  const digitRows = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const cols = raw.split("\t").map((c) => c.trim());
    const nf = line.normalize("NFKC");
    if (nf.includes("バラエティ") && nf.includes("1台")) { mode = "variety"; pending = ""; continue; }
    if (nf === "末尾別データ") { mode = "digit"; pending = ""; continue; }
    if (cols[0] === "機種" && cols[1] === "台番") { mode = "variety"; continue; }
    if (cols[0] === "機種" && cols[1] === "平均差枚") { mode = "model"; continue; }
    if (cols[0] === "末尾" && cols[1] === "平均差枚") { mode = "digit"; continue; }
    if (cols.filter((c) => c !== "").length < 4) { pending += line; continue; } // 例: 「ゾロ目」の行が折り返し
    const name = (pending + cols[0]).trim();
    pending = "";
    if (!name) continue;
    if (mode === "variety") {
      const no = parseIntLoose(cols[1]);
      if (no === null) continue;
      modelRows.push({
        name, no, isVariety: true, total: 1, wins: null,
        avgSada: parseIntLoose(cols[2]), hiddenNegative: cols[2] === "-",
        avgGsu: parseIntLoose(cols[3]), shutsu: parsePct(cols[4]),
      });
      continue;
    }
    const win = cols[3] ? cols[3].normalize("NFKC").match(/(\d+)\s*\/\s*(\d+)/) : null;
    const row = {
      name, isVariety: false,
      avgSada: parseIntLoose(cols[1]), hiddenNegative: cols[1] === "-",
      avgGsu: parseIntLoose(cols[2]),
      wins: win ? parseInt(win[1], 10) : null,
      total: win ? parseInt(win[2], 10) : null,
      shutsu: parsePct(cols[4]),
    };
    if (row.avgGsu === null && row.total === null) continue;
    (mode === "digit" ? digitRows : modelRows).push(row);
  }
  return { modelRows, digitRows };
}

// アナスロ：機種名/台番号/G数/差枚/BB/RB/合成/BB確率/RB確率（後ろに空の列・空の行が大量にある）。
// 「平均」行は除外。G数は機種により「通常時」か「総回転数」か違う（同じ日の民レポと比べて自動判定）。
export function parseAnaslo(text) {
  const rows = [];
  const seen = new Set();
  const dupNos = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cols = raw.split("\t").map((c) => c.trim());
    if (cols.length < 6) continue;
    if (cols[0] === "機種名" || cols[1] === "平均") continue;
    const no = parseIntLoose(cols[1]);
    if (no === null || !cols[0]) continue;
    if (seen.has(no)) dupNos.push(no);
    seen.add(no);
    rows.push({ m: cols[0], no, g: parseIntLoose(cols[2]), s: parseIntLoose(cols[3]), bb: parseIntLoose(cols[4]), rb: parseIntLoose(cols[5]) });
  }
  return { rows, dupNos };
}

// 民レポ個別台：先頭の「<機種名> データ一覧」から機種名を自動判定。台番/差枚/G数/出率/BB/RB/…
export function parseMinRepoIndividual(text) {
  let model = null;
  const rows = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cols = raw.split("\t").map((c) => c.trim());
    if (cols.length < 6) {
      const m = line.match(/^(.*?)[\s　]*データ一覧$/);
      if (m && !model) model = m[1].trim();
      continue;
    }
    if (cols[0] === "台番" || cols[0] === "平均") continue;
    const no = parseIntLoose(cols[0]);
    if (no === null) continue;
    rows.push({ no, s: parseIntLoose(cols[1]), g: parseIntLoose(cols[2]), shutsu: parsePct(cols[3]), bb: parseIntLoose(cols[4]), rb: parseIntLoose(cols[5]) });
  }
  return { model, rows };
}

// アナスロ1日分を保存用に圧縮（機種名を重複させない）。1週間分で約0.1MB程度。
// row: { m: 機種名, no, g, s, bb, rb, src: "a"(アナスロ) | "m"(民レポ個別台の代用) }
export function packDay(rows) {
  const models = [];
  const idx = new Map();
  const packed = rows.map((r) => {
    if (!idx.has(r.m)) { idx.set(r.m, models.length); models.push(r.m); }
    return [idx.get(r.m), r.no, r.g, r.s, r.bb, r.rb, r.src === "m" ? 1 : 0];
  });
  return { models, rows: packed };
}
export function unpackDay(day) {
  if (!day || !Array.isArray(day.rows)) return [];
  return day.rows.map(([mi, no, g, s, bb, rb, src]) => ({ m: day.models[mi], no, g, s, bb, rb, src: src ? "m" : "a" }));
}
export function fingerprintRows(rows) {
  return [...rows].sort((a, b) => a.no - b.no).map((r) => `${r.no}:${r.s}:${r.g}:${r.bb}:${r.rb}`).join("|");
}

// 民レポ（機種別サマリー）のマーク：☆◎◯▲（バラエティは勝率が無いので出率だけで判定）
export function classifyMinRepoMark(row) {
  if (!row || row.shutsu === null || row.shutsu === undefined) return null;
  if (row.isVariety) {
    if (row.shutsu >= 110) return "▲";
    if (row.shutsu >= 105) return "◯";
    return null;
  }
  if (!row.total || row.total < 2) return null;
  if (row.avgGsu === null || row.avgGsu < 3000) return null;
  if (row.wins === null) return null;
  const wr = row.wins / row.total;
  if (row.shutsu >= 110 && wr >= 1) return "☆";
  if (row.shutsu >= 110 && wr >= 0.8) return "◎";
  if (row.shutsu >= 105 && wr >= 0.8) return "◯";
  if (row.shutsu >= 110) return "▲";
  return null;
}

// 差枚と出率から総G数を逆算（出率が100%付近は誤差が大きいので |denom|<0.003 は推定しない）
export function estimateGsuFromSadaAndShutsu(sada, shutsu) {
  if (sada === null || sada === undefined || shutsu === null || shutsu === undefined) return null;
  const denom = 3 * (shutsu / 100 - 1);
  if (Math.abs(denom) < 0.003) return null;
  const est = sada / denom;
  if (!Number.isFinite(est) || est <= 0 || est > 50000) return null;
  return Math.round(est);
}

// =============================================================================
// 同じ日の民レポ×アナスロ照合：機種名の自動照合候補・バラエティの台番号一致・G数の種類判定
// =============================================================================
export function reconcileSameDay(overall, anasloRows, resolve) {
  const res = { matched: [], suggestions: [], varietyAliases: [], countMismatch: [], minrepoOnly: [], anasloOnly: [], gtypes: [] };
  if (!overall || !anasloRows || anasloRows.length === 0) return res;
  const groups = new Map(); // key -> { names:Set, rows:[] }
  anasloRows.forEach((r) => {
    const k = resolve(r.em || r.m);
    if (!groups.has(k)) groups.set(k, { key: k, name: r.em || r.m, rows: [] });
    groups.get(k).rows.push(r);
  });
  const byNo = new Map(anasloRows.map((r) => [r.no, r]));
  const avg = (arr, f) => {
    const v = arr.map(f).filter((x) => x !== null && x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const usedGroups = new Set();
  const unmatchedMinrepo = [];
  overall.modelRows.forEach((row) => {
    if (row.isVariety) {
      const a = byNo.get(row.no);
      if (!a) { res.minrepoOnly.push(row); return; }
      const ak = resolve(a.em || a.m);
      usedGroups.add(ak);
      if (ak !== resolve(row.name)) res.varietyAliases.push({ anasloName: a.em || a.m, minrepoName: row.name, no: row.no });
      if (row.avgGsu && a.g) res.gtypes.push({ name: row.name, ratio: a.g / row.avgGsu, date: null });
      return;
    }
    const k = resolve(row.name);
    const g = groups.get(k);
    if (!g) { unmatchedMinrepo.push(row); return; }
    usedGroups.add(k);
    const aAvgS = avg(g.rows, (r) => r.s);
    const aAvgG = avg(g.rows, (r) => r.g);
    const item = { name: row.name, key: k, mCount: row.total, aCount: g.rows.length, mAvg: row.avgSada, aAvg: aAvgS, mGsu: row.avgGsu, aGsu: aAvgG };
    res.matched.push(item);
    if (row.total !== g.rows.length) res.countMismatch.push(item);
    else if (row.avgGsu && aAvgG) res.gtypes.push({ name: row.name, ratio: aAvgG / row.avgGsu });
  });
  const freeGroups = [...groups.values()].filter((g) => !usedGroups.has(g.key));
  unmatchedMinrepo.forEach((row) => {
    const cands = freeGroups.filter((g) => {
      if (g.rows.length !== row.total) return false;
      const aAvg = avg(g.rows, (r) => r.s);
      if (aAvg === null || row.avgSada === null) return false;
      return Math.abs(aAvg - row.avgSada) <= Math.max(50, Math.abs(row.avgSada) * 0.03);
    });
    if (cands.length === 1) {
      const g = cands[0];
      res.suggestions.push({ minrepoName: row.name, anasloName: g.name, count: row.total, mAvg: row.avgSada, aAvg: avg(g.rows, (r) => r.s) });
    } else res.minrepoOnly.push(row);
  });
  const suggested = new Set(res.suggestions.map((s) => resolve(s.anasloName)));
  res.anasloOnly = freeGroups.filter((g) => !suggested.has(g.key)).map((g) => ({ name: g.name, count: g.rows.length }));
  return res;
}
// 比率（アナスロG ÷ 民レポG）からG数の種類を判定。0.97以上＝総回転数、0.92以下＝通常時。
export function gtypeFromRatio(ratio) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return null;
  if (ratio >= 0.97) return "total";
  if (ratio <= 0.92) return "normal";
  return null;
}
// 判定の積み重ね。AT機でもATに入らなかった日は比率1.00になるので、
// 「一度でも通常時と判定された機種は通常時」とする（総回転数の判定は弱い証拠）。
// entry: { normal: 回数, total: 回数, lastRatio, lastDate }
export function gtypeOfEntry(entry) {
  if (!entry) return null;
  if (entry.normal > 0) return "normal";
  if (entry.total > 0) return "total";
  return null;
}

// その日の「イベント名 → 対象機種キーの集合」。いつもの対象機種＋その日の対象機種を合わせる。
export function eventTargetsOn(date, eventNames, eventTargets, dateEventTargets, resolve) {
  const out = new Map();
  eventNames.forEach((E) => {
    const names = [...((eventTargets || {})[E] || []), ...(((dateEventTargets || {})[date] || {})[E] || [])];
    if (names.length) out.set(E, new Set(names.map(resolve)));
  });
  return out;
}

// =============================================================================
// エンジン（指示書 §4）
// =============================================================================
const CAP_NORMAL = 3900; // 通常時G数の信頼度上限（§4-1）
const CAP_TOTAL = 8000; // 総回転数の信頼度上限
export const MIN_N = 15;
export const GRADE_BANDS = [
  { min: 60, grade: "S" }, { min: 30, grade: "A" }, { min: 10, grade: "B" },
  { min: -10, grade: "C" }, { min: -30, grade: "D" }, { min: -Infinity, grade: "E" },
];
export function symbolPointsToGrade(points) {
  return GRADE_BANDS.find((b) => points >= b.min).grade;
}
export const GOOD_SYMBOLS = new Set(["☆", "〇"]);
const isGood = (s) => GOOD_SYMBOLS.has(s);

function sortedInsertRank(sorted, x) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; }
  let lo2 = lo, hi2 = sorted.length;
  while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (sorted[mid] <= x) lo2 = mid + 1; else hi2 = mid; }
  return sorted.length ? (lo + lo2) / 2 / sorted.length : null; // 中央順位（同値は真ん中）
}
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function poissonLogPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 0 : -Infinity;
  let lf = 0;
  for (let i = 2; i <= k; i++) lf += Math.log(i);
  return -lambda + k * Math.log(lambda) - lf;
}
export function findProfile(modelKey, profiles) {
  const p = profiles || SETTING_PROFILES;
  for (const name of Object.keys(p)) if (normalizeModelName(name) === modelKey) return p[name];
  return null;
}
// 設定別の事後確率（一様事前）
export function evaluateSettingLikelihood(profile, rec) {
  if (!profile || !rec.g || rec.g <= 0) return null;
  const n = profile.settings.length;
  let logs;
  if (profile.type === "A") {
    if (rec.bb === null || rec.rb === null) return null;
    logs = profile.settings.map((_, i) => poissonLogPmf(rec.bb, rec.g / profile.big[i]) + poissonLogPmf(rec.rb, rec.g / profile.reg[i]));
  } else {
    const f = profile.count || "bb";
    const hits = f === "bbrb" ? (rec.bb ?? 0) + (rec.rb ?? 0) : rec[f];
    if (hits === null || hits === undefined) return null;
    logs = profile.settings.map((_, i) => poissonLogPmf(hits, rec.g / profile.hit[i]));
  }
  const mx = Math.max(...logs);
  const rel = logs.map((l) => Math.exp(l - mx));
  const sum = rel.reduce((a, b) => a + b, 0);
  return rel.map((v) => v / sum).slice(0, n);
}

// 生の読み取り（0〜1）：確率表あり→設定の期待位置（設定1=0, 最高設定=1）、
// 確率表なし→店内（このページの同じ機種）での合算確率の順位（暫定）。
export function rawHitReading(rec, modelCtx) {
  if (!rec.g || rec.g <= 0) return null;
  if (modelCtx.profile) {
    const post = evaluateSettingLikelihood(modelCtx.profile, rec);
    if (!post) return null;
    const n = post.length;
    return post.reduce((a, p, i) => a + p * (n > 1 ? i / (n - 1) : 0), 0);
  }
  const hits = (rec.bb ?? 0) + (rec.rb ?? 0);
  if (rec.bb === null && rec.rb === null) return null;
  return sortedInsertRank(modelCtx.rateSorted, hits / rec.g);
}

// 設定期待度（§4-1）
export function settingLikelihoodScore(rec, modelCtx, isStrongDay) {
  const raw = rawHitReading(rec, modelCtx);
  if (raw === null) return null;
  const cap = modelCtx.gtype === "total" ? CAP_TOTAL : CAP_NORMAL;
  const confidence = Math.min(1, (rec.g || 0) / cap);
  const normalized = raw * confidence; // 0側に寄せる（「50に寄せる」方式は不採用）
  const trendComp = rec.s === null ? 0.5 : sortedInsertRank(modelCtx.sadaSorted, rec.s);
  const probWeight = 0.2 + 0.6 * confidence;
  let score = normalized * probWeight + trendComp * (1 - probWeight);
  if (isStrongDay) score += 0.02;
  score = Math.max(0, Math.min(1, score));
  return { score, raw, confidence, lowGsuFlag: confidence < 0.5 && rec.s !== null && rec.s >= 1000 };
}

// pageDays: [{ date, machines: [{ key, no, model, modelKey, g, s, bb, rb, src }] }]（日付昇順）
// opts: { profiles, gtypeOf(modelKey), eventsOn(date)->[名前], isStrong(date), isSemi(date) }
export function buildSymbolContext(pageDays, opts) {
  const o = opts || {};
  const eventsOn = o.eventsOn || (() => []);
  const isStrong = o.isStrong || (() => false);
  const isSemi = o.isSemi || (() => false);
  const targetsOn = o.targetsOn || (() => new Map()); // date -> Map(イベント名 -> Set(機種キー))
  const dates = pageDays.map((d) => d.date);
  const modelCtx = new Map();
  const getModelCtx = (mk) => {
    if (!modelCtx.has(mk)) {
      const gtype = o.gtypeOf ? o.gtypeOf(mk) : null;
      const profile = o.profileOf ? o.profileOf(mk) : findProfile(mk, o.profiles);
      modelCtx.set(mk, { key: mk, gtype, profile, rateSorted: [], sadaSorted: [] });
    }
    return modelCtx.get(mk);
  };
  pageDays.forEach((day) => day.machines.forEach((m) => {
    const c = getModelCtx(m.modelKey);
    const cap = c.gtype === "total" ? CAP_TOTAL : CAP_NORMAL;
    if (m.g && m.g >= cap * 0.25 && (m.bb !== null || m.rb !== null)) c.rateSorted.push(((m.bb ?? 0) + (m.rb ?? 0)) / m.g);
    if (m.s !== null && m.s !== undefined) c.sadaSorted.push(m.s);
  }));
  modelCtx.forEach((c) => { c.rateSorted.sort((a, b) => a - b); c.sadaSorted.sort((a, b) => a - b); });

  // 台ごとの記録列
  const machines = new Map();
  const readingsForPct = [];
  pageDays.forEach((day, di) => {
    const strong = isStrong(day.date);
    day.machines.forEach((m) => {
      const c = getModelCtx(m.modelKey);
      const cap = c.gtype === "total" ? CAP_TOTAL : CAP_NORMAL;
      const exp = settingLikelihoodScore(m, c, strong);
      const rec = { di, date: day.date, g: m.g, s: m.s, bb: m.bb, rb: m.rb, src: m.src, reading: exp ? exp.raw : null, exp, enough: !!(m.g && m.g >= cap * 0.25) };
      if (rec.reading !== null && rec.enough) readingsForPct.push(rec.reading);
      if (!machines.has(m.key)) machines.set(m.key, { key: m.key, no: m.no, model: m.model, modelKey: m.modelKey, recs: [] });
      const mm = machines.get(m.key);
      mm.model = m.model;
      mm.recs.push(rec);
    });
  });
  readingsForPct.sort((a, b) => a - b);
  const p20 = quantile(readingsForPct, 0.2);
  const p50 = quantile(readingsForPct, 0.5);
  const p80 = quantile(readingsForPct, 0.8);
  // 記号（§4-2）：読み取りの階層（p20/p50/p80）× 差枚
  machines.forEach((m) => m.recs.forEach((r) => { r.sym = classifySymbol(r, { p20, p50, p80 }); }));
  return { dates, machines, p20, p50, p80, eventsOn, isStrong, isSemi, targetsOn, modelCtx, sampleCount: readingsForPct.length };
}
export function classifySymbol(r, p) {
  if (!r.enough || r.reading === null || p.p20 === null || r.s === null || r.s === undefined) return "－";
  if (r.reading <= p.p20) return "×";
  if (r.reading >= p.p80) return r.s > 0 ? "☆" : "▽";
  if (r.reading >= p.p50) return r.s > 0 ? "〇" : "▽";
  return "□";
}

// 指示書 §4-3 のパターン一覧。i = 台の記録の位置（その日 d まで）、target = 予想対象日。
export function patternKeysAt(ctx, m, i, target) {
  const r = m.recs;
  const out = [];
  const add = (key, label, kind = "pattern") => out.push({ key, label, kind });
  const sym = (k) => (k >= 0 && r[k] ? r[k].sym : null);
  const s0 = sym(i), s1 = sym(i - 1), s2 = sym(i - 2);
  const d = r[i].date;
  // 連続性は「ページの日付で連続している記録」に限る
  const contiguous = (k) => k >= 1 && r[k].di - r[k - 1].di === 1;
  const c1 = contiguous(i), c2 = c1 && contiguous(i - 1);

  // 前日結果
  add(`prev:${s0}`, `前日${s0}`);
  // 連続
  if (c1 && s0 === "×" && s1 === "×") add("x2", "×2連続");
  if (c2 && s0 === "×" && s1 === "×" && s2 === "×") add("x3", "×3連続");
  if (c1 && isGood(s0) && isGood(s1)) add("g2", "☆〇2連続");
  if (c2 && isGood(s0) && isGood(s1) && isGood(s2)) add("g3", "☆〇3連続");
  const mid = (x) => x === "▽" || x === "□";
  if (c1 && mid(s0) && mid(s1)) add("m2", "▽□2連続");
  // 2日シーケンス
  if (c1) add(`seq:${s1}${s0}`, `2日の並び ${s1}→${s0}`);
  // 末尾
  const tail = m.no % 10;
  const tdig = parseInt(target.slice(8, 10), 10) % 10;
  if (tail === tdig) add(`tailMatch:${s0}`, `台番末尾＝日付末尾 × 前日${s0}`);
  add(`tail${tail}:${s0}`, `台番末尾${tail} × 前日${s0}`);
  // 予想日のイベント
  const tEvents = ctx.eventsOn(target);
  if (s0 === "×") tEvents.forEach((E) => add(`xEv:${E}`, `前日× × 翌日「${E}」`));
  if (s0 === "×") for (let N = 4; N <= 7; N++) if (isGood(sym(i - N))) add(`xAgo${N}`, `前日× × ${N}日前☆〇`);
  // 差枚の足（記録ベース）
  const trail = (k, endOffset = 0) => {
    const end = i - endOffset;
    if (end - k + 1 < 0) return null;
    let t = 0;
    for (let j = end - k + 1; j <= end; j++) { if (r[j].s === null || r[j].s === undefined) return null; t += r[j].s; }
    return t;
  };
  const t7 = trail(7), t10 = trail(10), t14 = trail(14), t20 = trail(20), t30 = trail(30);
  const loseStreak1 = r[i].s !== null && r[i].s < 0 && i >= 1 && r[i - 1].s !== null && r[i - 1].s >= 0;
  if (t7 !== null && t7 >= 10000 && loseStreak1) add("big7lose1", "7日足+10000以上 × 1連敗のみ");
  if (t14 !== null && t14 >= 20000) add("big14", "14日足+20000以上（大勝ち）");
  if (t10 !== null && t10 >= 10000) add("t10up", "10日足+10000以上");
  if (t20 !== null && t20 >= 10000) add("t20up", "20日足+10000以上");
  if (t30 !== null && t30 >= 10000) add("t30up", "30日足+10000以上");
  if (t20 !== null && t20 <= -10000) add("t20down", "20日足-10000以下");
  if (t10 !== null && t10 <= -5000 && t10 >= -10000) add("t10dip", "10日足-5000〜-10000");
  // 凹み上げ：その前の10記録が-5000以下に凹んでいて、前日プラス
  const prev10 = trail(10, 1);
  if (prev10 !== null && prev10 <= -5000 && r[i].s !== null && r[i].s > 0) add("dipUp", "凹み上げ（10日-5000以下→前日プラス）");
  // イベント翌日
  if (ctx.isStrong(d)) add("afterStrong", "強いイベント翌日");
  if (ctx.isSemi(d)) add("afterSemi", "準イベント翌日");
  // 予想日の属性
  add(`dayDigit:${tdig}`, `日付末尾${tdig}`);
  if (tEvents.length) {
    add("eventDay", "イベント当日");
    tEvents.forEach((E) => {
      add(`ev:${E}`, `イベント「${E}」当日`);
      if (tail === tdig) add(`evTail:${E}`, `「${E}」× 台番末尾一致`);
    });
  } else add("noEvent", "通常日（イベント無し）");
  if (ctx.isStrong(target)) add("strongDay", "強いイベント当日");
  // イベント対象機種（v0.2.0）
  const tgMap = ctx.targetsOn ? ctx.targetsOn(target) : new Map();
  if (tgMap.size) {
    const hitEvents = [...tgMap.entries()].filter(([, set]) => set.has(m.modelKey)).map(([E]) => E);
    if (hitEvents.length) {
      add("evTarget", "イベント対象機種（予想日）");
      hitEvents.forEach((E) => add(`evTarget:${E}`, `「${E}」の対象機種`));
    } else add("evNotTarget", "対象機種があるイベントで対象外");
  }
  // 自己平均比ローテーション（好調）
  if (i >= 9) {
    const all = r.slice(0, i + 1).map((x) => x.s).filter((v) => v !== null && v !== undefined);
    const last3 = r.slice(i - 2, i + 1).map((x) => x.s).filter((v) => v !== null && v !== undefined);
    if (all.length >= 10 && last3.length === 3) {
      const avgAll = all.reduce((a, b) => a + b, 0) / all.length;
      const avg3 = last3.reduce((a, b) => a + b, 0) / 3;
      if (avg3 >= avgAll + 1000) add("rotHot", "自己平均比で好調（直近3日）");
    }
  }
  // 曜日
  add(`wd:${weekdayOf(target)}`, `${WD[weekdayOf(target)]}曜日`);
  // 月に☆〇 → 翌日（2通りの解釈を両方実装：今月の☆〇回数／月曜の☆〇）
  const ym = d.slice(0, 7);
  let cnt = 0;
  for (let j = i; j >= 0 && r[j].date.startsWith(ym); j--) if (isGood(r[j].sym)) cnt += 1;
  add(`month:${Math.min(cnt, 2)}`, `今月の☆〇 ${cnt >= 2 ? "2回以上" : `${cnt}回`}`);
  if (weekdayOf(d) === 1 && isGood(s0)) add("monGood", "月曜☆〇 → 翌日");
  // 台番号固定・台ごとの持続性
  add(`fixed:${m.key}`, `台番号固定（${m.no}番）`, "fixed");
  add(`persist:${m.key}:${isGood(s0) ? 1 : 0}`, `台の持続性（前日${isGood(s0) ? "☆〇" : "☆〇以外"}）⚠️低信頼`, "persist");
  return out;
}

// 全履歴から「パターン該当台の翌日☆〇率 − 全体☆〇率」を測る（§4-3）
export function learnSymbolPatternWeights(ctx) {
  const agg = new Map();
  let total = 0, hits = 0;
  ctx.machines.forEach((m) => {
    const r = m.recs;
    for (let i = 0; i + 1 < r.length; i++) {
      if (r[i + 1].di !== r[i].di + 1) continue; // 翌日（ページの次の日付）に記録がある時だけ
      const nxt = r[i + 1].sym;
      if (nxt === "－") continue; // 判定不可は学習に使わない
      const good = isGood(nxt) ? 1 : 0;
      total += 1; hits += good;
      patternKeysAt(ctx, m, i, r[i + 1].date).forEach((p) => {
        if (!agg.has(p.key)) agg.set(p.key, { key: p.key, label: p.label, kind: p.kind, n: 0, hits: 0 });
        const a = agg.get(p.key);
        a.n += 1; a.hits += good;
      });
    }
  });
  const base = total ? hits / total : null;
  const weights = new Map();
  if (base !== null) {
    agg.forEach((a) => {
      const rate = a.hits / a.n;
      const raw = (rate - base) * 100 * (a.n >= 50 ? 3 : 2) * Math.min(1, Math.sqrt(a.n / 20));
      let points;
      if (a.kind === "fixed") { if (a.n < 50) return; points = raw / 10; }
      else if (a.kind === "persist") { if (a.n < 12) return; points = Math.max(-15, Math.min(15, raw)); }
      else { if (a.n < MIN_N) return; points = raw; }
      weights.set(a.key, { ...a, rate, points });
    });
  }
  return { base, total, weights, rawCount: agg.size };
}

// 予想対象日のピックアップ（最新日に記録のある台だけ）
export function scoreSymbolPickupToday(ctx, learned, closedSet) {
  const n = ctx.dates.length;
  if (!n) return { target: null, list: [] };
  const lastDi = n - 1;
  const target = nextOpenDate(ctx.dates[lastDi], closedSet);
  const list = [];
  ctx.machines.forEach((m) => {
    const i = m.recs.length - 1;
    if (i < 0 || m.recs[i].di !== lastDi) return;
    const items = [];
    patternKeysAt(ctx, m, i, target).forEach((p) => {
      const w = learned.weights.get(p.key);
      if (w) items.push({ ...w, label: p.label });
    });
    const points = items.reduce((a, it) => a + it.points, 0);
    items.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
    const tg = ctx.targetsOn ? [...ctx.targetsOn(target).entries()].filter(([, set]) => set.has(m.modelKey)).map(([E]) => E) : [];
    list.push({ key: m.key, no: m.no, model: m.model, targetEvents: tg, points, grade: symbolPointsToGrade(points), items, lastSym: m.recs[i].sym, lastExp: m.recs[i].exp });
  });
  list.sort((a, b) => b.points - a.points || a.no - b.no);
  return { target, lastDate: ctx.dates[lastDi], list };
}

// ウォークフォワード・バックテスト（前日までのデータだけで学習→翌日の結果と照合）
// 結果の記号は全期間で作った ctx の記号を正解として使う。
export function walkForwardBacktest(pageDays, opts, closedSet, warmup = 20) {
  const full = buildSymbolContext(pageDays, opts);
  const truth = new Map();
  full.machines.forEach((m) => m.recs.forEach((r) => truth.set(`${m.key}@${r.date}`, r)));
  const byGrade = {};
  for (let t = warmup; t + 1 < pageDays.length; t++) {
    const sub = pageDays.slice(0, t + 1);
    const ctx = buildSymbolContext(sub, opts);
    const learned = learnSymbolPatternWeights(ctx);
    const actualNext = pageDays[t + 1].date;
    ctx.machines.forEach((m) => {
      const i = m.recs.length - 1;
      if (i < 0 || m.recs[i].di !== t) return;
      let pts = 0;
      patternKeysAt(ctx, m, i, actualNext).forEach((p) => { const w = learned.weights.get(p.key); if (w) pts += w.points; });
      const tr = truth.get(`${m.key}@${actualNext}`);
      if (!tr || tr.sym === "－") return;
      const g = symbolPointsToGrade(pts);
      if (!byGrade[g]) byGrade[g] = { n: 0, good: 0, win: 0 };
      byGrade[g].n += 1;
      if (isGood(tr.sym)) byGrade[g].good += 1;
      if (tr.s > 0) byGrade[g].win += 1;
    });
  }
  return byGrade;
}

// =============================================================================
// ここから画面（React）
// =============================================================================
const EVENT_DELIMITER = "、";
export function splitNames(s) {
  return String(s || "").split(EVENT_DELIMITER).map((x) => x.trim()).filter(Boolean);
}
function joinNames(list) {
  return list.filter(Boolean).join(EVENT_DELIMITER);
}
const KV_DEFAULTS = {
  [KEYS.pages]: [], [KEYS.eventNames]: [], [KEYS.strong]: [], [KEYS.semi]: [], [KEYS.closed]: [],
  [KEYS.dateEvent]: {}, [KEYS.undo]: [], [KEYS.aliases]: {}, [KEYS.noModel]: {}, [KEYS.gtype]: {},
  [KEYS.eventTargets]: {}, [KEYS.dateEventTargets]: {},
};
const NO_EVENT_LABEL = "イベント無し";
const SYMBOL_COLORS = { "☆": "#e5484d", "〇": "#f2d24b", "▽": "#9ece6a", "□": "#7aa2f7", "×": "#5a6272", "－": "#2f3644" };
const GRADE_COLORS = { S: "#f2d24b", A: "#9ece6a", B: "#4fd1c5", C: "#7aa2f7", D: "#c7cbd4", E: "#e5697a" };
const PALETTE = ["#e8b34c", "#4fd1c5", "#e5697a", "#7aa2f7", "#9ece6a", "#bb9af7", "#f6a04d", "#5fd3bc", "#e0af68", "#7dcfff"];
function fiveBandColor(v) {
  if (v >= 75) return "#e5697a";
  if (v >= 60) return "#e8b34c";
  if (v >= 45) return "#9ece6a";
  if (v >= 30) return "#7aa2f7";
  return "#5a6272";
}
function markColor(mark) {
  if (mark === "☆" || mark === "◎") return "#e5484d";
  if (mark === "◯") return "#f2d24b";
  return "#9ece6a";
}
function fmt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "―";
  return Math.round(v).toLocaleString();
}
function fmtSigned(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "―";
  return `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString()}`;
}
function errMsg(e) {
  return e && e.message ? e.message : String(e || "不明なエラー");
}

export function serializeOverall(s) {
  if (!s) return "";
  const out = ["機種\t平均差枚\t平均G数\t勝率\t出率"];
  const val = (v, hidden) => (hidden ? "-" : v === null || v === undefined ? "" : v);
  s.modelRows.filter((r) => !r.isVariety).forEach((r) => out.push([r.name, val(r.avgSada, r.hiddenNegative), val(r.avgGsu), r.total ? `${r.wins}/${r.total}` : "", r.shutsu === null ? "-" : `${r.shutsu}%`].join("\t")));
  const v = s.modelRows.filter((r) => r.isVariety);
  if (v.length) {
    out.push("バラエティ（1台設置機種）", "機種\t台番\t差枚\tG数\t出率");
    v.forEach((r) => out.push([r.name, r.no, val(r.avgSada, r.hiddenNegative), val(r.avgGsu), r.shutsu === null ? "-" : `${r.shutsu}%`].join("\t")));
  }
  if (s.digitRows && s.digitRows.length) {
    out.push("末尾別データ", "末尾\t平均差枚\t平均G数\t勝率\t出率");
    s.digitRows.forEach((r) => out.push([r.name, val(r.avgSada, r.hiddenNegative), val(r.avgGsu), r.total ? `${r.wins}/${r.total}` : "", r.shutsu === null ? "-" : `${r.shutsu}%`].join("\t")));
  }
  return out.join("\n");
}
function serializeAnaslo(rows) {
  const a = rows.filter((r) => r.src !== "m");
  if (!a.length) return "";
  return ["機種名\t台番号\tG数\t差枚\tBB\tRB", ...a.map((r) => [r.m, r.no, r.g ?? "", r.s ?? "", r.bb ?? "", r.rb ?? ""].join("\t"))].join("\n");
}

const S = {
  card: { background: "#1b212b", border: "1px solid #2a323f", borderRadius: 10, padding: 16, marginBottom: 14, minWidth: 0, maxWidth: "100%", boxSizing: "border-box" },
  h: { fontSize: 13, fontWeight: 700, color: "#c7cbd4", marginBottom: 4 },
  note: { fontSize: 11, color: "#5a6272", marginBottom: 10, lineHeight: 1.6 },
  input: { background: "#12161d", border: "1px solid #2a323f", borderRadius: 6, padding: "7px 8px", color: "#e7e9ee", fontSize: 13, boxSizing: "border-box", maxWidth: "100%" },
  textarea: { width: "100%", background: "#0e1218", border: "1px solid #2a323f", borderRadius: 6, padding: 8, color: "#d7dae0", fontSize: 11.5, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box", marginBottom: 10, fontFamily: "'JetBrains Mono','Menlo',monospace" },
  btn: (bg, fg = "#12161d") => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "9px 12px", fontWeight: 700, fontSize: 13, cursor: "pointer" }),
  ghost: { background: "none", border: "1px solid #2a323f", borderRadius: 6, color: "#8b93a3", padding: "5px 10px", fontSize: 11, cursor: "pointer" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, background: "#12161d", border: "1px solid #232b37", borderRadius: 6, padding: "6px 8px" },
  th: { padding: "4px 6px", color: "#5a6272", fontWeight: 600, textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid #2a323f" },
  td: { padding: "4px 6px", borderBottom: "1px solid #1c2129", whiteSpace: "nowrap" },
};
function Status({ s }) {
  if (!s) return null;
  return <div style={{ marginTop: 8, fontSize: 11.5, color: s.type === "ok" ? "#9ece6a" : s.type === "warn" ? "#e8b34c" : "#e5697a", whiteSpace: "pre-wrap" }}>{s.msg}</div>;
}
function Collapse({ title, defaultOpen = false, children, right }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={S.card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button onClick={() => setOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#c7cbd4", fontWeight: 700, fontSize: 13, cursor: "pointer", padding: 0, textAlign: "left" }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{title}
        </button>
        {right}
      </div>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

// 機種名を1つずつ追加・削除するチップ入力（イベント対象機種用）
function ModelChips({ names, onAdd, onRemove, placeholder }) {
  const [v, setV] = useState("");
  const add = () => { const t = v.trim(); if (!t) return; onAdd(t); setV(""); };
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
        {names.map((n) => (
          <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, background: "rgba(232,179,76,0.10)", border: "1px solid #3a3320", borderRadius: 999, padding: "2px 6px 2px 8px" }}>
            🎯 {n}<button onClick={() => onRemove(n)} style={{ background: "none", border: "none", color: "#5a6272", cursor: "pointer", padding: 0, display: "flex" }}><X size={10} /></button>
          </span>
        ))}
        {!names.length && <span style={{ fontSize: 11, color: "#5a6272" }}>対象機種なし</span>}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input list="model-names" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={placeholder || "機種名を入力して追加"} style={{ ...S.input, flex: 1, fontSize: 12, padding: "5px 8px" }} />
        <button style={S.ghost} onClick={add}>追加</button>
      </div>
    </div>
  );
}

export default function App() {
  // ---- 保存データ（ref が常に最新・state は画面表示用）----
  const kvRef = useRef({ ...KV_DEFAULTS });
  const [kv, setKv] = useState({ ...KV_DEFAULTS });
  const rawRef = useRef({}); // { date: packedDay }
  const [raw, setRaw] = useState({});
  const ovrRef = useRef({}); // { date: { modelRows, digitRows } }
  const [ovr, setOvr] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [loadErrors, setLoadErrors] = useState([]);
  const [notice, setNotice] = useState(null);

  // ---- 画面状態 ----
  const [viewMode, setViewMode] = useState("overall"); // "common" | "overall" | "page"
  const [activePageId, setActivePageId] = useState(null);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);

  // ---- 読み込み ----
  useEffect(() => {
    (async () => {
      const errors = [];
      if (!storage.ready) errors.push("Firebaseが未設定です。src/firebase.js に玉屋本店用プロジェクトの設定を貼ってください（今は保存・読み込みできません）。");
      const nextKv = { ...KV_DEFAULTS };
      if (storage.ready) {
        await Promise.all(Object.values(KEYS).map(async (key) => {
          try {
            const r = await storage.get(key);
            if (r && r.value) nextKv[key] = JSON.parse(r.value);
          } catch (e) { errors.push(`${key} の読み込みに失敗：${errMsg(e)}`); }
        }));
        const loadWeekly = async (prefix, indexKey, label) => {
          const out = {};
          let dates = [];
          try {
            const idx = await storage.get(indexKey);
            if (idx && idx.value) dates = JSON.parse(idx.value);
          } catch (e) { errors.push(`${label}の索引の読み込みに失敗：${errMsg(e)}`); }
          const weeks = Array.from(new Set(dates.map(weekStartOf)));
          await Promise.all(weeks.map(async (w) => {
            try {
              const r = await storage.get(prefix + w);
              if (r && r.value) Object.assign(out, JSON.parse(r.value));
            } catch (e) { errors.push(`${label}（${w}の週）の読み込みに失敗：${errMsg(e)}`); }
          }));
          return out;
        };
        const [rawData, ovrData] = await Promise.all([loadWeekly(RAW_PREFIX, RAW_INDEX, "アナスロ"), loadWeekly(OVR_PREFIX, OVR_INDEX, "民レポ")]);
        rawRef.current = rawData; setRaw(rawData);
        ovrRef.current = ovrData; setOvr(ovrData);
      }
      kvRef.current = nextKv; setKv(nextKv);
      if (nextKv[KEYS.pages].length) setActivePageId(nextKv[KEYS.pages][0].id);
      setLoadErrors(errors);
      setLoaded(true);
    })();
  }, []);

  // ---- 書き込み：ref を await の前に同期更新 → キュー経由で保存 → 成功後に画面へ反映 ----
  const commitKV = useCallback(async (key, updater) => {
    const prev = kvRef.current[key];
    const next = updater(prev);
    kvRef.current = { ...kvRef.current, [key]: next };
    try {
      await storage.set(key, JSON.stringify(next));
      setKv((s) => ({ ...s, [key]: next }));
      return { ok: true };
    } catch (e) {
      if (kvRef.current[key] === next) kvRef.current = { ...kvRef.current, [key]: prev };
      setNotice({ type: "error", msg: `保存に失敗しました（${key}）：${errMsg(e)}` });
      return { ok: false, error: errMsg(e) };
    }
  }, []);

  const writeWeekly = useCallback(async (kind, date, value) => {
    const ref = kind === "raw" ? rawRef : ovrRef;
    const prefix = kind === "raw" ? RAW_PREFIX : OVR_PREFIX;
    const indexKey = kind === "raw" ? RAW_INDEX : OVR_INDEX;
    const setter = kind === "raw" ? setRaw : setOvr;
    const prevVal = ref.current[date];
    const next = { ...ref.current };
    if (value === null || value === undefined) delete next[date]; else next[date] = value;
    ref.current = next;
    const ws = weekStartOf(date);
    const bucket = {};
    Object.keys(next).forEach((d) => { if (weekStartOf(d) === ws) bucket[d] = next[d]; });
    const index = Object.keys(next).sort();
    try {
      if (Object.keys(bucket).length) await storage.set(prefix + ws, JSON.stringify(bucket));
      else await storage.delete(prefix + ws);
      await storage.set(indexKey, JSON.stringify(index));
      setter(ref.current);
      return { ok: true };
    } catch (e) {
      if (ref.current[date] === value || (value == null && !(date in ref.current))) {
        const r = { ...ref.current };
        if (prevVal === undefined) delete r[date]; else r[date] = prevVal;
        ref.current = r;
      }
      return { ok: false, error: errMsg(e) };
    }
  }, []);

  const bulkWriteWeekly = useCallback(async (kind, data) => {
    const ref = kind === "raw" ? rawRef : ovrRef;
    const prefix = kind === "raw" ? RAW_PREFIX : OVR_PREFIX;
    const indexKey = kind === "raw" ? RAW_INDEX : OVR_INDEX;
    const next = { ...ref.current, ...data };
    ref.current = next;
    const weeks = Array.from(new Set(Object.keys(data).map(weekStartOf)));
    for (const w of weeks) {
      const bucket = {};
      Object.keys(next).forEach((d) => { if (weekStartOf(d) === w) bucket[d] = next[d]; });
      await storage.set(prefix + w, JSON.stringify(bucket));
    }
    await storage.set(indexKey, JSON.stringify(Object.keys(next).sort()));
    (kind === "raw" ? setRaw : setOvr)(next);
  }, []);

  const pushUndo = useCallback((entry) => {
    const e = { id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ts: Date.now(), ...entry };
    if (JSON.stringify(e).length > 250000) return; // 大きすぎる取り消し情報は保存しない
    commitKV(KEYS.undo, (prev) => [e, ...(prev || [])].slice(0, 8));
  }, [commitKV]);

  // ---- 派生データ ----
  const pages = kv[KEYS.pages];
  const aliases = kv[KEYS.aliases];
  const noModel = kv[KEYS.noModel];
  const gtypes = kv[KEYS.gtype];
  const dateEvent = kv[KEYS.dateEvent];
  const closedSet = useMemo(() => new Set(kv[KEYS.closed].map((c) => c.date)), [kv]);
  const strongNames = useMemo(() => new Set(kv[KEYS.strong].map((s) => s.name)), [kv]);
  const semiNames = useMemo(() => new Set(kv[KEYS.semi].map((s) => s.name)), [kv]);
  const resolve = useMemo(() => makeResolver(aliases), [aliases]);
  const eventsOn = useCallback((d) => splitNames(dateEvent[d]), [dateEvent]);
  const eventTargets = kv[KEYS.eventTargets];
  const dateEventTargets = kv[KEYS.dateEventTargets];
  const isStrong = useCallback((d) => eventsOn(d).some((n) => strongNames.has(n)), [eventsOn, strongNames]);
  const isSemi = useCallback((d) => !isStrong(d) && eventsOn(d).some((n) => semiNames.has(n)), [eventsOn, isStrong, semiNames]);
  const targetsOn = useCallback((d) => eventTargetsOn(d, eventsOn(d), eventTargets, dateEventTargets, resolve), [eventsOn, eventTargets, dateEventTargets, resolve]);
  const isTargetOn = useCallback((d, modelKey) => [...targetsOn(d).values()].some((set) => set.has(modelKey)), [targetsOn]);
  const rawDates = useMemo(() => Object.keys(raw).sort(), [raw]);
  const ovrDates = useMemo(() => Object.keys(ovr).sort(), [ovr]);
  const allDays = useMemo(() => rawDates.map((date) => ({
    date,
    rows: unpackDay(raw[date]).map((r) => ({ ...r, em: effectiveModelName(r, noModel) })),
  })), [rawDates, raw, noModel]);
  const gtypeOf = useCallback((mk) => gtypeOfEntry(gtypes[mk]), [gtypes]);
  const profileByKey = useMemo(() => {
    const m = {};
    Object.keys(SETTING_PROFILES).forEach((n) => { m[resolve(n)] = SETTING_PROFILES[n]; });
    return m;
  }, [resolve]);
  // 機種キー → 表示名（民レポの表記を優先）
  const displayNameOf = useMemo(() => {
    const m = {};
    allDays.forEach((d) => d.rows.forEach((r) => { const k = resolve(r.em); if (!m[k]) m[k] = r.em; }));
    ovrDates.forEach((d) => ovr[d].modelRows.forEach((r) => { m[resolve(r.name)] = r.name; }));
    return m;
  }, [allDays, ovrDates, ovr, resolve]);
  const knownModelNames = useMemo(() => {
    const set = new Set();
    allDays.forEach((d) => d.rows.forEach((r) => set.add(r.em)));
    ovrDates.forEach((d) => ovr[d].modelRows.forEach((r) => set.add(r.name)));
    return Array.from(set).sort();
  }, [allDays, ovrDates, ovr]);

  // ---- 民レポ×アナスロの照合（同じ日がある時）→ バラエティの別名・G数の種類を自動反映 ----
  const autoReconcile = useCallback(async (date) => {
    const o = ovrRef.current[date];
    const r = rawRef.current[date];
    if (!o || !r) return null;
    const res0 = makeResolver(kvRef.current[KEYS.aliases]);
    const rows = unpackDay(r).filter((x) => x.src !== "m").map((x) => ({ ...x, em: effectiveModelName(x, kvRef.current[KEYS.noModel]) }));
    const rec = reconcileSameDay(o, rows, res0);
    const newAliases = {};
    rec.varietyAliases.forEach((v) => { newAliases[normalizeModelName(v.anasloName)] = v.minrepoName; });
    if (Object.keys(newAliases).length) await commitKV(KEYS.aliases, (prev) => ({ ...prev, ...newAliases }));
    const res1 = makeResolver(kvRef.current[KEYS.aliases]);
    const rec2 = Object.keys(newAliases).length ? reconcileSameDay(o, rows, res1) : rec;
    const updates = {};
    rec2.gtypes.forEach((g) => {
      const t = gtypeFromRatio(g.ratio);
      if (!t) return;
      const k = res1(g.name);
      updates[k] = { t, ratio: g.ratio };
    });
    if (Object.keys(updates).length) {
      await commitKV(KEYS.gtype, (prev) => {
        const next = { ...prev };
        Object.entries(updates).forEach(([k, u]) => {
          const e = next[k] && next[k].dates ? { ...next[k] } : { normal: 0, total: 0, dates: [] };
          if (e.dates.includes(date)) return; // 同じ日を二重に数えない
          e[u.t] = (e[u.t] || 0) + 1;
          e.dates = [...e.dates, date].slice(-60);
          e.lastRatio = Math.round(u.ratio * 1000) / 1000;
          e.lastDate = date;
          next[k] = e;
        });
        return next;
      });
    }
    return { ...rec2, varietyAliases: rec.varietyAliases }; // 今回自動で照合したバラエティ台を報告する
  }, [commitKV]);

  // =========================================================================
  // 共通設定：入力フォーム
  // =========================================================================
  const [ovrDate, setOvrDate] = useState(todayStr());
  const [ovrText, setOvrText] = useState("");
  const [ovrStatus, setOvrStatus] = useState(null);
  const [anaDate, setAnaDate] = useState(todayStr());
  const [anaText, setAnaText] = useState("");
  const [anaStatus, setAnaStatus] = useState(null);
  const [anaDup, setAnaDup] = useState(null);
  const [kbDate, setKbDate] = useState(todayStr());
  const [kbText, setKbText] = useState("");
  const [kbModel, setKbModel] = useState("");
  const [kbStatus, setKbStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  function loadOvrDate(d) {
    setOvrDate(d);
    setOvrText(ovrRef.current[d] ? serializeOverall(ovrRef.current[d]) : "");
    setOvrStatus(ovrRef.current[d] ? { type: "ok", msg: `${d} は登録済みです。編集用に読み込みました（保存すると上書き）。` } : null);
  }
  function loadAnaDate(d) {
    setAnaDate(d);
    setAnaDup(null);
    const rows = rawRef.current[d] ? unpackDay(rawRef.current[d]) : [];
    setAnaText(serializeAnaslo(rows));
    const a = rows.filter((r) => r.src !== "m").length;
    const m = rows.length - a;
    setAnaStatus(rows.length ? { type: "ok", msg: `${d}：アナスロ${a}台${m ? `・個別台の代用${m}台` : ""}が登録済み。` } : null);
  }

  async function handleSaveOverall() {
    if (busy) return;
    const parsed = parseOverallSummary(ovrText);
    if (!parsed.modelRows.length && !parsed.digitRows.length) { setOvrStatus({ type: "error", msg: "データを読み取れませんでした。民レポの表をそのまま貼り付けてください。" }); return; }
    if (closedSet.has(ovrDate)) { setOvrStatus({ type: "error", msg: `${ovrDate} は店休日として登録されています。` }); return; }
    setBusy(true);
    const res = await writeWeekly("ovr", ovrDate, parsed);
    setBusy(false);
    if (!res.ok) { setOvrStatus({ type: "error", msg: `保存に失敗しました：${res.error}` }); return; }
    const v = parsed.modelRows.filter((r) => r.isVariety).length;
    let msg = `${ovrDate} の民レポを保存しました（機種${parsed.modelRows.length - v}・バラエティ${v}・末尾${parsed.digitRows.length}）。`;
    const rec = await autoReconcile(ovrDate);
    if (rec) msg += reconcileSummary(rec);
    setOvrStatus({ type: "ok", msg });
    setOvrText("");
  }

  async function handleSaveAnaslo(force) {
    if (busy) return;
    const { rows, dupNos } = parseAnaslo(anaText);
    if (!rows.length) { setAnaStatus({ type: "error", msg: "データを読み取れませんでした。アナスロの表をそのまま貼り付けてください。" }); return; }
    if (dupNos.length) { setAnaStatus({ type: "error", msg: `同じ台番号が2回出てきます：${dupNos.slice(0, 10).join(", ")}。貼り付け範囲を確認してください。` }); return; }
    if (closedSet.has(anaDate)) { setAnaStatus({ type: "error", msg: `${anaDate} は店休日として登録されています。` }); return; }
    if (!force) {
      const fp = fingerprintRows(rows);
      const hit = Object.keys(rawRef.current).find((d) => d !== anaDate && fingerprintRows(unpackDay(rawRef.current[d]).filter((r) => r.src !== "m")) === fp);
      if (hit) { setAnaDup(hit); return; }
    }
    setAnaDup(null);
    const existing = rawRef.current[anaDate] ? unpackDay(rawRef.current[anaDate]) : [];
    const anaNos = new Set(rows.map((r) => r.no));
    const keptManual = existing.filter((r) => r.src === "m" && !anaNos.has(r.no)); // アナスロに無い台の代用データだけ残す
    const replaced = existing.filter((r) => r.src === "m" && anaNos.has(r.no)).length;
    const all = [...rows.map((r) => ({ ...r, src: "a" })), ...keptManual];
    setBusy(true);
    const res = await writeWeekly("raw", anaDate, packDay(all));
    setBusy(false);
    if (!res.ok) { setAnaStatus({ type: "error", msg: `保存に失敗しました：${res.error}` }); return; }
    let msg = `${anaDate} のアナスロを保存しました（${rows.length}台${replaced ? `・個別台の代用${replaced}台を上書き` : ""}）。`;
    const rec = await autoReconcile(anaDate);
    if (rec) msg += reconcileSummary(rec);
    setAnaStatus({ type: "ok", msg });
    setAnaText("");
    setAnaDate(addDays(anaDate, -1));
  }

  async function handleSaveIndividual() {
    if (busy) return;
    const parsed = parseMinRepoIndividual(kbText);
    const model = (parsed.model || kbModel || "").trim();
    if (!model) { setKbStatus({ type: "error", msg: "機種名が分かりません。表の上の「○○ データ一覧」の行も一緒に貼るか、機種名を入力してください。" }); return; }
    if (!parsed.rows.length) { setKbStatus({ type: "error", msg: "台番号の行を読み取れませんでした。" }); return; }
    if (closedSet.has(kbDate)) { setKbStatus({ type: "error", msg: `${kbDate} は店休日として登録されています。` }); return; }
    const existing = rawRef.current[kbDate] ? unpackDay(rawRef.current[kbDate]) : [];
    const anaNos = new Set(existing.filter((r) => r.src !== "m").map((r) => r.no));
    const newNos = new Set(parsed.rows.map((r) => r.no));
    const toAdd = parsed.rows.filter((r) => !anaNos.has(r.no));
    const skipped = parsed.rows.length - toAdd.length;
    const kept = existing.filter((r) => !(r.src === "m" && newNos.has(r.no)));
    const all = [...kept, ...toAdd.map((r) => ({ m: model, no: r.no, g: r.g, s: r.s, bb: r.bb, rb: r.rb, src: "m" }))];
    setBusy(true);
    let res = { ok: true };
    if (toAdd.length) res = await writeWeekly("raw", kbDate, packDay(all));
    if (!res.ok) { setBusy(false); setKbStatus({ type: "error", msg: `保存に失敗しました：${res.error}` }); return; }
    // 台番号→機種の対応を覚える（アナスロが別の名前でまとめて出している台だけ）
    const res0 = makeResolver(kvRef.current[KEYS.aliases]);
    const learnedMap = {};
    parsed.rows.forEach((r) => {
      const ds = Object.keys(rawRef.current).sort();
      const near = [...ds.filter((d) => d <= kbDate).reverse(), ...ds.filter((d) => d > kbDate)];
      for (const d of near) {
        const a = unpackDay(rawRef.current[d]).find((x) => x.no === r.no && x.src !== "m");
        if (a) {
          if (res0(a.m) !== res0(model)) learnedMap[r.no] = { model, anasloName: a.m, since: kbDate };
          break;
        }
      }
    });
    if (Object.keys(learnedMap).length) await commitKV(KEYS.noModel, (prev) => ({ ...prev, ...learnedMap }));
    setBusy(false);
    let msg = toAdd.length ? `${kbDate}「${model}」${toAdd.length}台分を代用データとして保存しました（後でアナスロが入ると自動で上書き）。` : `${kbDate} はアナスロ登録済みのため、代用データは保存していません。`;
    if (skipped && toAdd.length) msg += `\n${skipped}台はアナスロ登録済みのため保存していません。`;
    if (Object.keys(learnedMap).length) msg += `\n台番号${Object.keys(learnedMap).join("・")}を「${model}」として覚えました（アナスロでは「${Object.values(learnedMap)[0].anasloName}」と表示されている台）。`;
    setKbStatus({ type: "ok", msg });
    setKbText("");
  }

  function reconcileSummary(rec) {
    const parts = [];
    if (rec.varietyAliases.length) parts.push(`バラエティ台の名前違い${rec.varietyAliases.length}件を台番号で自動照合しました。`);
    if (rec.suggestions.length) parts.push(`名前が違う機種の候補が${rec.suggestions.length}件あります →「機種名の照合」で確認してください。`);
    if (rec.countMismatch.length) parts.push(`台数が合わない機種：${rec.countMismatch.map((x) => `${x.name}（民レポ${x.mCount}/アナスロ${x.aCount}）`).join("、")}`);
    return parts.length ? `\n${parts.join("\n")}` : "\n民レポとアナスロの機種はすべて一致しました。";
  }

  // ---- 登録済み日付の削除（取り消し可）----
  async function deleteDate(kind, date) {
    const ref = kind === "raw" ? rawRef : ovrRef;
    const prev = ref.current[date];
    const res = await writeWeekly(kind, date, null);
    if (!res.ok) { setNotice({ type: "error", msg: `削除に失敗しました：${res.error}` }); return; }
    pushUndo({ label: `${kind === "raw" ? "アナスロ" : "民レポ"} ${date} を削除`, kind, date, prev });
    setNotice({ type: "ok", msg: `${kind === "raw" ? "アナスロ" : "民レポ"} ${date} を削除しました。` });
  }
  async function restoreUndo(e) {
    let ok;
    if (e.kind === "kv") ok = (await commitKV(e.key, () => e.prev)).ok;
    else ok = (await writeWeekly(e.kind, e.date, e.prev)).ok;
    if (ok) {
      await commitKV(KEYS.undo, (prev) => prev.filter((x) => x.id !== e.id));
      setNotice({ type: "ok", msg: `「${e.label}」を元に戻しました。` });
    }
  }

  // ---- イベント・店休日 ----
  const [evDate, setEvDate] = useState(addDays(todayStr(), 1));
  const [evName, setEvName] = useState("");
  const [evStatus, setEvStatus] = useState(null);
  const [tierName, setTierName] = useState("");
  const [closedDate, setClosedDate] = useState(todayStr());
  const [evTargets, setEvTargets] = useState([]); // 登録フォームで一緒に登録する「その日の対象機種」
  const [editTarget, setEditTarget] = useState(null); // { date, name } 一覧から対象機種を編集中
  const [fixedEvName, setFixedEvName] = useState("");
  const addUniqueName = (list, n) => (list.some((x) => resolve(x) === resolve(n)) ? list : [...list, n]);

  async function setDateTargets(date, E, updater) {
    return commitKV(KEYS.dateEventTargets, (prev) => {
      const day = { ...((prev || {})[date] || {}) };
      const list = updater(day[E] || []);
      if (list.length) day[E] = list; else delete day[E];
      const next = { ...(prev || {}) };
      if (Object.keys(day).length) next[date] = day; else delete next[date];
      return next;
    });
  }
  async function setFixedTargets(E, updater) {
    return commitKV(KEYS.eventTargets, (prev) => {
      const next = { ...(prev || {}) };
      const list = updater(next[E] || []);
      if (list.length) next[E] = list; else delete next[E];
      return next;
    });
  }

  async function addEvent() {
    const name = evName.trim();
    if (!evDate || !name) { setEvStatus({ type: "error", msg: "日付とイベント名を入力してください。" }); return; }
    const cur = splitNames(kvRef.current[KEYS.dateEvent][evDate]);
    const exists = cur.includes(name);
    if (exists && !evTargets.length) { setEvStatus({ type: "error", msg: "すでに登録されています（対象機種を足す時は、機種を入れてから登録を押してください）。" }); return; }
    if (!exists) {
      const r = await commitKV(KEYS.dateEvent, (prev) => ({ ...prev, [evDate]: joinNames([...cur, name]) }));
      if (!r.ok) { setEvStatus({ type: "error", msg: `保存に失敗しました：${r.error}` }); return; }
      if (!kvRef.current[KEYS.eventNames].includes(name)) await commitKV(KEYS.eventNames, (prev) => [...prev, name]);
    }
    if (evTargets.length) {
      const r2 = await setDateTargets(evDate, name, (list) => evTargets.reduce(addUniqueName, list));
      if (!r2.ok) { setEvStatus({ type: "error", msg: `対象機種の保存に失敗しました：${r2.error}` }); return; }
    }
    const fixed = (kvRef.current[KEYS.eventTargets][name] || []).length;
    setEvStatus({ type: "ok", msg: `${evDate} に「${name}」を${exists ? "更新" : "登録"}しました${evTargets.length ? `（その日の対象機種${evTargets.length}機種）` : ""}${fixed ? `。いつもの対象機種${fixed}機種も自動で対象になります` : ""}。` });
    setEvName("");
    setEvTargets([]);
    setEvDate(addDays(evDate, 1));
  }
  async function removeEvent(date, name) {
    const prevMap = kvRef.current[KEYS.dateEvent];
    const rest = splitNames(prevMap[date]).filter((n) => n !== name);
    const r = await commitKV(KEYS.dateEvent, (prev) => {
      const next = { ...prev };
      if (rest.length) next[date] = joinNames(rest); else delete next[date];
      return next;
    });
    if (r.ok) pushUndo({ label: `イベント ${date}「${name}」を削除`, kind: "kv", key: KEYS.dateEvent, prev: prevMap });
  }
  async function addTier(key) {
    const name = tierName.trim();
    if (!name) return;
    await commitKV(key, (prev) => [...prev.filter((s) => s.name !== name), { name }]);
    if (!kvRef.current[KEYS.eventNames].includes(name)) await commitKV(KEYS.eventNames, (prev) => [...prev, name]);
    setTierName("");
  }
  async function removeTier(key, name) {
    const prev = kvRef.current[key];
    const r = await commitKV(key, (p) => p.filter((s) => s.name !== name));
    if (r.ok) pushUndo({ label: `${key === KEYS.strong ? "強い" : "準"}イベント「${name}」を削除`, kind: "kv", key, prev });
  }
  async function addClosed() {
    if (!closedDate || closedSet.has(closedDate)) return;
    const r = await commitKV(KEYS.closed, (prev) => [...prev, { date: closedDate }]);
    if (r.ok) setClosedDate(addDays(closedDate, 1));
  }
  async function removeClosed(date) {
    const prev = kvRef.current[KEYS.closed];
    const r = await commitKV(KEYS.closed, (p) => p.filter((c) => c.date !== date));
    if (r.ok) pushUndo({ label: `店休日 ${date} を削除`, kind: "kv", key: KEYS.closed, prev });
  }

  // ---- ページ ----
  const [officialInput, setOfficialInput] = useState("");
  async function addPage() {
    const id = `page-${Date.now()}`;
    const r = await commitKV(KEYS.pages, (prev) => [...prev, { id, name: "", officialName: "" }]);
    if (r.ok) { setActivePageId(id); setViewMode("page"); }
  }
  async function updatePage(id, patch) {
    await commitKV(KEYS.pages, (prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  async function deletePage(id) {
    const prev = kvRef.current[KEYS.pages];
    const r = await commitKV(KEYS.pages, (p) => p.filter((x) => x.id !== id));
    if (r.ok) {
      pushUndo({ label: `ページ「${(prev.find((p) => p.id === id) || {}).name || "無題"}」を削除`, kind: "kv", key: KEYS.pages, prev });
      const rest = prev.filter((x) => x.id !== id);
      setActivePageId(rest.length ? rest[0].id : null);
      if (!rest.length) setViewMode("common");
    }
  }

  // ---- エクスポート / インポート（指示書 §6-8 のキー＋本店で追加したキー）----
  function buildPageHistories() {
    const out = {};
    pages.forEach((p) => {
      const keys = new Set(splitNames(p.officialName).map(resolve));
      out[p.id] = allDays.map((d) => ({
        date: d.date,
        event: dateEvent[d.date] || "",
        machines: d.rows.filter((r) => keys.has(resolve(r.em))).map((r) => ({ no: r.no, modelName: r.em, sada: r.s, gsu: r.g, bb: r.bb, rb: r.rb, source: r.src === "m" ? "minrepo" : "anaslo" })),
      })).filter((h) => h.machines.length);
    });
    return out;
  }
  function handleExport() {
    const obj = {
      exportedAt: new Date().toISOString(),
      app: "tamaya-honten-tracker",
      appVersion: APP_VERSION,
      pages,
      pageHistories: buildPageHistories(),
      pageRecommends: {},
      overallRecommends: {},
      dateEventMap: dateEvent,
      strongEvents: kv[KEYS.strong],
      semiEvents: kv[KEYS.semi],
      closedDays: kv[KEYS.closed],
      overallSummaries: ovrDates.map((d) => ({ date: d, event: dateEvent[d] || "", ...ovr[d] })),
      eventNames: kv[KEYS.eventNames],
      rawFullTable: raw,
      rawFullTableFormat: "packed-v1",
      modelAliases: aliases,
      noModelMap: noModel,
      modelGTypes: gtypes,
      eventTargets,
      dateEventTargets,
    };
    const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tamaya-honten-export-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  const [importStatus, setImportStatus] = useState(null);
  async function handleImport(file) {
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (obj.app !== "tamaya-honten-tracker") {
        if (!window.confirm("玉屋本店アプリのエクスポートではないようです。それでも取り込みますか？")) return;
      }
      if (!window.confirm("取り込むと、同じ日付・同じ設定は上書きされます。続けますか？")) return;
      setImportStatus({ type: "warn", msg: "取り込み中..." });
      const kvPairs = [
        [KEYS.pages, obj.pages], [KEYS.eventNames, obj.eventNames], [KEYS.strong, obj.strongEvents], [KEYS.semi, obj.semiEvents],
        [KEYS.closed, obj.closedDays], [KEYS.dateEvent, obj.dateEventMap], [KEYS.aliases, obj.modelAliases], [KEYS.noModel, obj.noModelMap], [KEYS.gtype, obj.modelGTypes],
        [KEYS.eventTargets, obj.eventTargets], [KEYS.dateEventTargets, obj.dateEventTargets],
      ];
      for (const [k, v] of kvPairs) if (v !== undefined) { const r = await commitKV(k, () => v); if (!r.ok) throw new Error(r.error); }
      if (obj.rawFullTable && obj.rawFullTableFormat === "packed-v1") await bulkWriteWeekly("raw", obj.rawFullTable);
      if (Array.isArray(obj.overallSummaries)) {
        const o = {};
        obj.overallSummaries.forEach((s) => { o[s.date] = { modelRows: s.modelRows || [], digitRows: s.digitRows || [] }; });
        await bulkWriteWeekly("ovr", o);
      }
      if (obj.pages && obj.pages.length) setActivePageId(obj.pages[0].id);
      setImportStatus({ type: "ok", msg: "取り込みが完了しました。" });
    } catch (e) {
      setImportStatus({ type: "error", msg: `取り込みに失敗しました：${errMsg(e)}` });
    }
  }

  // ---- 機種名の照合（画面表示用）----
  const bothDates = useMemo(() => ovrDates.filter((d) => raw[d]), [ovrDates, raw]);
  const [recDate, setRecDate] = useState("");
  const recDateEff = recDate && bothDates.includes(recDate) ? recDate : bothDates[bothDates.length - 1] || "";
  const recResult = useMemo(() => {
    if (!recDateEff || viewMode !== "common" || !unlocked) return null;
    const rows = unpackDay(raw[recDateEff]).filter((x) => x.src !== "m").map((x) => ({ ...x, em: effectiveModelName(x, noModel) }));
    return reconcileSameDay(ovr[recDateEff], rows, resolve);
  }, [recDateEff, viewMode, unlocked, raw, ovr, noModel, resolve]);
  async function acceptAlias(anasloName, minrepoName) {
    await commitKV(KEYS.aliases, (prev) => ({ ...prev, [normalizeModelName(anasloName)]: minrepoName }));
    if (recDateEff) await autoReconcile(recDateEff);
  }

  function handleUnlock() {
    if (pin.trim() === UNLOCK_PIN) { setUnlocked(true); setPin(""); setPinError(false); }
    else setPinError(true);
  }

  // =========================================================================
  // 機種ページ：エンジン（そのページを開いている時だけ計算）
  // =========================================================================
  const currentPage = pages.find((p) => p.id === activePageId) || null;
  const pageNameKeys = useMemo(() => new Set(splitNames(currentPage && currentPage.officialName).map(resolve)), [currentPage, resolve]);
  const pageDays = useMemo(() => {
    if (viewMode !== "page" || !currentPage || !pageNameKeys.size) return [];
    return allDays.map((d) => ({
      date: d.date,
      machines: d.rows.filter((r) => pageNameKeys.has(resolve(r.em))).map((r) => {
        const mk = resolve(r.em);
        return { key: `${r.no}|${mk}`, no: r.no, model: displayNameOf[mk] || r.em, modelKey: mk, g: r.g, s: r.s, bb: r.bb, rb: r.rb, src: r.src };
      }),
    })).filter((d) => d.machines.length);
  }, [viewMode, currentPage, pageNameKeys, allDays, resolve, displayNameOf]);
  const engine = useMemo(() => {
    if (!pageDays.length) return null;
    const ctx = buildSymbolContext(pageDays, { profileOf: (mk) => profileByKey[mk] || null, gtypeOf, eventsOn, isStrong, isSemi, targetsOn });
    const learned = learnSymbolPatternWeights(ctx);
    const pick = scoreSymbolPickupToday(ctx, learned, closedSet);
    return { ctx, learned, pick };
  }, [pageDays, profileByKey, gtypeOf, eventsOn, isStrong, isSemi, targetsOn, closedSet]);
  const isMultiModel = useMemo(() => new Set(pageDays.flatMap((d) => d.machines.map((m) => m.modelKey))).size > 1, [pageDays]);
  const machineLabel = (m) => (isMultiModel ? `${m.model} ${m.no}番` : `${m.no}番`);

  // ページ内の表示設定
  const [showPast, setShowPast] = useState(false);
  const [gridEvent, setGridEvent] = useState("");
  const [range, setRange] = useState(30);
  const [selected, setSelected] = useState([]);
  const [viewDate, setViewDate] = useState("");
  const [expandedPick, setExpandedPick] = useState({});
  useEffect(() => { setSelected([]); setViewDate(""); setExpandedPick({}); setShowPast(false); setGridEvent(""); }, [activePageId]);

  const lastPageDi = engine ? engine.ctx.dates.length - 1 : -1;
  const pageMachines = useMemo(() => {
    if (!engine) return [];
    const arr = [...engine.ctx.machines.values()].filter((m) => showPast || (m.recs.length && m.recs[m.recs.length - 1].di === lastPageDi));
    return arr.sort((a, b) => a.no - b.no || a.model.localeCompare(b.model));
  }, [engine, showPast, lastPageDi]);
  const activeKeys = useMemo(() => (engine ? [...engine.ctx.machines.values()].filter((m) => m.recs.length && m.recs[m.recs.length - 1].di === lastPageDi).map((m) => m.key) : []), [engine, lastPageDi]);
  useEffect(() => { if (!selected.length && activeKeys.length) setSelected(activeKeys.slice(0, 6)); }, [activeKeys, selected.length]);
  const gridDates = useMemo(() => {
    if (!engine) return [];
    let ds = engine.ctx.dates;
    if (gridEvent === NO_EVENT_LABEL) ds = ds.filter((d) => !eventsOn(d).length);
    else if (gridEvent) ds = ds.filter((d) => eventsOn(d).includes(gridEvent));
    else ds = ds.slice(-30);
    return [...ds].reverse();
  }, [engine, gridEvent, eventsOn]);
  const recAt = useCallback((m, date) => m.recs.find((r) => r.date === date) || null, []);
  const chartData = useMemo(() => {
    if (!engine) return [];
    const ds = range === "all" ? engine.ctx.dates : engine.ctx.dates.slice(-range);
    const cum = {};
    return ds.map((d) => {
      const row = { date: d.slice(5) };
      selected.forEach((k) => {
        const m = engine.ctx.machines.get(k);
        if (!m) return;
        const r = recAt(m, d);
        if (r && r.s !== null) cum[k] = (cum[k] || 0) + r.s;
        row[k] = cum[k] === undefined ? null : cum[k];
      });
      return row;
    });
  }, [engine, range, selected, recAt]);

  // =========================================================================
  // 全体データ（民レポ）
  // =========================================================================
  const [modelHist, setModelHist] = useState("");
  const dailyTotals = useMemo(() => [...ovrDates].reverse().map((d) => {
    const s = ovr[d];
    let tot = 0, g = 0, n = 0;
    s.modelRows.forEach((r) => {
      if (r.total && r.avgSada !== null && r.avgGsu !== null) { tot += r.avgSada * r.total; g += r.avgGsu * r.total; n += r.total; }
    });
    const marks = s.modelRows.map((r) => ({ name: r.name, mark: classifyMinRepoMark(r) })).filter((x) => x.mark);
    return { date: d, total: n ? tot : null, avg: n ? tot / n : null, avgG: n ? g / n : null, n, marks };
  }), [ovrDates, ovr]);
  const ovrGridDates = useMemo(() => [...ovrDates].slice(-30).reverse(), [ovrDates]);
  const ovrGridRows = useMemo(() => {
    const cnt = {};
    ovrDates.forEach((d) => ovr[d].modelRows.forEach((r) => { const k = resolve(r.name); cnt[k] = Math.max(cnt[k] || 0, r.total || 1); }));
    return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || a.localeCompare(b));
  }, [ovrDates, ovr, resolve]);
  const ovrMark = useMemo(() => {
    const m = {};
    ovrDates.forEach((d) => ovr[d].modelRows.forEach((r) => { const k = resolve(r.name); (m[k] = m[k] || {})[d] = { mark: classifyMinRepoMark(r), variety: r.isVariety }; }));
    return m;
  }, [ovrDates, ovr, resolve]);

  // =========================================================================
  // 描画
  // =========================================================================
  if (!loaded) return <div style={{ padding: 24, color: "#8b93a3", fontSize: 13, fontFamily: "sans-serif" }}>読み込み中...</div>;

  const pickTitle = engine && engine.pick.target ? (() => {
    const t = engine.pick.target;
    const skipped = [];
    for (let x = addDays(engine.pick.lastDate, 1); x < t; x = addDays(x, 1)) skipped.push(md(x));
    return `${md(t)}のピックアップ（実測パターン方式）${skipped.length ? `　※${skipped.join("・")}は店休日` : ""}`;
  })() : "ピックアップ（実測パターン方式）";

  const renderSymbolGrid = () => (
    <div className="scrollbar" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
        <thead><tr>
          <th style={{ ...S.th, position: "sticky", left: 0, background: "#1b212b", zIndex: 1 }} />
          {gridDates.map((d) => <th key={d} className="mono" style={{ ...S.th, fontSize: 9, textAlign: "center", color: isStrong(d) ? "#e5484d" : eventsOn(d).length ? "#f2d24b" : "#5a6272" }}>{d.slice(5)}</th>)}
        </tr></thead>
        <tbody>{pageMachines.map((m) => (
          <tr key={m.key}>
            <td title={machineLabel(m)} style={{ ...S.td, position: "sticky", left: 0, background: "#1b212b", color: "#c7cbd4", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{machineLabel(m)}</td>
            {gridDates.map((d) => { const r = recAt(m, d); return (
              <td key={d} className="mono" title={r ? `G${fmt(r.g)} 差枚${fmtSigned(r.s)} BB${r.bb ?? "-"} RB${r.rb ?? "-"}${r.src === "m" ? "（代用）" : ""}` : ""} style={{ ...S.td, textAlign: "center", color: r ? SYMBOL_COLORS[r.sym] : "#2a323f", fontWeight: 700, textDecoration: r && r.src === "m" ? "underline dotted" : undefined, background: isTargetOn(d, m.modelKey) ? "rgba(232,179,76,0.13)" : undefined }}>{r ? r.sym : "・"}</td>
            ); })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
  const renderExpGrid = (dates, list) => (
    <div className="scrollbar" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
        <thead><tr>
          <th style={{ ...S.th, position: "sticky", left: 0, background: "#1b212b", zIndex: 1 }} />
          {dates.map((d) => <th key={d} className="mono" style={{ ...S.th, fontSize: 9, textAlign: "center" }}>{d.slice(5)}</th>)}
        </tr></thead>
        <tbody>{list.map((m) => (
          <tr key={m.key}>
            <td style={{ ...S.td, position: "sticky", left: 0, background: "#1b212b", color: "#c7cbd4", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{machineLabel(m)}</td>
            {dates.map((d) => {
              const r = recAt(m, d);
              const e = r && r.exp;
              if (!e) return <td key={d} style={{ ...S.td, textAlign: "center", color: "#2a323f" }}>・</td>;
              const v = Math.round(e.score * 100);
              return (
                <td key={d} className="mono" title={`期待度${v}　生の読み取り${Math.round(e.raw * 100)}　信頼度${e.confidence.toFixed(2)}　G${fmt(r.g)}`} style={{ ...S.td, textAlign: "center", color: fiveBandColor(v) }}>
                  {e.lowGsuFlag && <span style={{ fontSize: 8 }}>▼</span>}{v}<sub style={{ fontSize: 8, color: "#5a6272" }}>{Math.round(e.raw * 100)}</sub>
                </td>
              );
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Inter','Hiragino Sans',sans-serif", background: "#12161d", color: "#e7e9ee", minHeight: "100%", padding: "20px 16px 80px", boxSizing: "border-box" }}>
      <style>{`
        .mono { font-family: 'JetBrains Mono','Menlo',monospace; font-variant-numeric: tabular-nums; }
        input[type="date"] { color-scheme: dark; }
        .scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .scrollbar::-webkit-scrollbar-thumb { background: #333c4a; border-radius: 3px; }
        .tab { cursor: pointer; border: 1px solid #2a323f; border-radius: 8px 8px 0 0; padding: 8px 12px; font-size: 12px; font-weight: 700; background: #1b212b; color: #8b93a3; }
        .tab.active { background: #12161d; color: #e8b34c; border-bottom: 1px solid #12161d; }
        .grid2 { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 14px; }
        @media (max-width: 860px) { .grid2 { grid-template-columns: minmax(0,1fr); } }
      `}</style>
      <datalist id="model-names">{knownModelNames.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="event-names">{kv[KEYS.eventNames].map((n) => <option key={n} value={n} />)}</datalist>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#e8b34c", fontWeight: 600 }}>TAMAYA HONTEN DATA TERMINAL</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "4px 0 2px", display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          玉屋本店 台データ推移トラッカー<span className="mono" style={{ fontSize: 12, color: "#5a6272" }}>v{APP_VERSION}</span>
        </h1>
      </div>

      {loadErrors.map((e, i) => <div key={i} style={{ ...S.card, borderColor: "#7a3038", color: "#e5697a", fontSize: 12 }}>⚠ {e}</div>)}
      {notice && (
        <div style={{ ...S.card, borderColor: notice.type === "ok" ? "#2f4a2a" : "#7a3038", display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: notice.type === "ok" ? "#9ece6a" : "#e5697a" }}>
          <span>{notice.msg}</span>
          <button onClick={() => setNotice(null)} style={{ background: "none", border: "none", color: "#5a6272", cursor: "pointer" }}><X size={14} /></button>
        </div>
      )}

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className={`tab${viewMode === "common" ? " active" : ""}`} onClick={() => setViewMode("common")}>🔧 共通設定</div>
        <div className={`tab${viewMode === "overall" ? " active" : ""}`} onClick={() => setViewMode("overall")}>📊 全体データ</div>
        {pages.map((p, i) => (
          <div key={p.id} className={`tab${viewMode === "page" && p.id === activePageId ? " active" : ""}`} onClick={() => { setActivePageId(p.id); setViewMode("page"); }}>
            {p.name && p.name.trim() ? p.name : `機種${i + 1}`}
          </div>
        ))}
        {unlocked && <div className="tab" style={{ color: "#4fd1c5" }} onClick={addPage}><Plus size={12} style={{ verticalAlign: -2 }} /> ページ追加</div>}
      </div>
      <div style={{ borderTop: "1px solid #2a323f", marginBottom: 14 }} />

      {/* =================================================================== 共通設定 */}
      {viewMode === "common" && (
        <div style={{ maxWidth: 820 }}>
          {!unlocked ? (
            <div style={S.card}>
              <div style={{ ...S.h, display: "flex", alignItems: "center", gap: 6 }}><Lock size={14} /> ロック中です</div>
              <div style={S.note}>暗証番号を入れると、民レポ・アナスロの入力、イベント・店休日の登録、ページの編集などができます（この画面だけの解除で、再読み込みすると戻ります）。</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="password" inputMode="numeric" value={pin} onChange={(e) => { setPin(e.target.value); setPinError(false); }} onKeyDown={(e) => e.key === "Enter" && handleUnlock()} placeholder="暗証番号" style={{ ...S.input, flex: 1, borderColor: pinError ? "#e5697a" : "#2a323f" }} />
                <button onClick={handleUnlock} style={S.btn("#e8b34c", "#1b1508")}>解除</button>
              </div>
              {pinError && <Status s={{ type: "error", msg: "暗証番号が違います。" }} />}
            </div>
          ) : (
            <>
              <div style={S.card}>
                <div style={S.h}>① 民レポ（機種別サマリー＋バラエティ＋末尾別データ）</div>
                <div style={S.note}>民レポの表を上から下までそのまま貼り付けてください。同じ日のアナスロがあれば、機種名と台数を自動で照合します。</div>
                <input type="date" value={ovrDate} onChange={(e) => loadOvrDate(e.target.value)} style={{ ...S.input, marginBottom: 8 }} />
                {eventsOn(ovrDate).length > 0 && <div style={{ fontSize: 12, color: "#e8b34c", marginBottom: 8 }}><Flag size={11} style={{ verticalAlign: -1 }} /> この日のイベント：{eventsOn(ovrDate).join("、")}</div>}
                <textarea className="scrollbar" rows={8} value={ovrText} onChange={(e) => setOvrText(e.target.value)} placeholder={"機種\t平均差枚\t平均G数\t勝率\t出率\n…"} style={S.textarea} />
                <button disabled={busy} onClick={handleSaveOverall} style={{ ...S.btn("#e8b34c", "#1b1508"), width: "100%", opacity: busy ? 0.6 : 1 }}>{busy ? "保存中..." : "この日の民レポを保存"}</button>
                <Status s={ovrStatus} />
              </div>

              <div style={S.card}>
                <div style={S.h}>② アナスロ（全台の一覧表）</div>
                <div style={S.note}>アナスロの表をそのまま貼り付けてください（後ろの空白列・空行・「平均」行は自動で無視します）。正式名称が一致するページに自動で反映されます。</div>
                <input type="date" value={anaDate} onChange={(e) => loadAnaDate(e.target.value)} style={{ ...S.input, marginBottom: 8 }} />
                <div style={{ fontSize: 11, color: raw[anaDate] ? "#9ece6a" : "#5a6272", marginBottom: 8 }}>{raw[anaDate] ? `この日は登録済み（${unpackDay(raw[anaDate]).length}台）` : "この日はまだ未登録です"}</div>
                <textarea className="scrollbar" rows={8} value={anaText} onChange={(e) => setAnaText(e.target.value)} placeholder={"機種名\t台番号\tG数\t差枚\tBB\tRB\t合成確率\tBB確率\tRB確率\n…"} style={S.textarea} />
                <button disabled={busy} onClick={() => handleSaveAnaslo(false)} style={{ ...S.btn("#4fd1c5", "#0b1f1c"), width: "100%", opacity: busy ? 0.6 : 1 }}>{busy ? "保存中..." : "この日のアナスロを保存"}</button>
                {anaDup && (
                  <div style={{ marginTop: 8, padding: 10, borderRadius: 6, background: "#2a1418", border: "1px solid #7a3038", color: "#e5697a", fontSize: 12 }}>
                    ⚠ この内容は {anaDup} と完全に同じです。日付を間違えていませんか？
                    <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                      <button style={S.ghost} onClick={() => handleSaveAnaslo(true)}>間違いない・保存する</button>
                      <button style={S.ghost} onClick={() => setAnaDup(null)}>取消</button>
                    </div>
                  </div>
                )}
                <Status s={anaStatus} />
              </div>

              <div style={S.card}>
                <div style={S.h}>③ 民レポ 個別台データ（アナスロが遅い日の代用）</div>
                <div style={S.note}>民レポの機種ページの表を「○○ データ一覧」の行ごと貼ると、機種名を自動で読み取ります。後でアナスロが入ると自動で上書きされます。アナスロで別の機種名にまとめて表示されている台（例：沖ドキGOLDとゴージャス）は、ここで一度貼ると台番号で正しく振り分けるようになります。</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <input type="date" value={kbDate} onChange={(e) => setKbDate(e.target.value)} style={S.input} />
                  <input list="model-names" value={kbModel} onChange={(e) => setKbModel(e.target.value)} placeholder="機種名（表の上の行が無い時だけ）" style={{ ...S.input, flex: "1 1 200px" }} />
                </div>
                {parseMinRepoIndividual(kbText).model && <div style={{ fontSize: 11, color: "#9ece6a", marginBottom: 8 }}>読み取った機種名：{parseMinRepoIndividual(kbText).model}</div>}
                <textarea className="scrollbar" rows={6} value={kbText} onChange={(e) => setKbText(e.target.value)} placeholder={"○○ データ一覧\n台番\t差枚\tG数\t出率\tBB\tRB\t合成\tBB率\tRB率\n…"} style={S.textarea} />
                <button disabled={busy} onClick={handleSaveIndividual} style={{ ...S.btn("#bb9af7"), width: "100%", opacity: busy ? 0.6 : 1 }}>{busy ? "保存中..." : "個別台データを保存"}</button>
                <Status s={kbStatus} />
              </div>

              <div style={S.card}>
                <div style={S.h}>④ 機種名の照合（民レポ × アナスロ）</div>
                <div style={S.note}>同じ日の民レポとアナスロを、台数と平均差枚（誤差3%以内）で突き合わせます。名前が違うだけの同じ機種は「同じ機種として登録」を押すと、以後は自動で合わせます。バラエティ台は台番号で自動照合済みです。</div>
                {!bothDates.length ? <div style={{ fontSize: 12, color: "#5a6272" }}>民レポとアナスロが両方そろった日がまだありません。</div> : (
                  <>
                    <select value={recDateEff} onChange={(e) => setRecDate(e.target.value)} style={{ ...S.input, marginBottom: 10 }}>
                      {[...bothDates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    {recResult && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                        <div style={{ color: "#9ece6a" }}>一致：{recResult.matched.length - recResult.countMismatch.length}機種</div>
                        {recResult.suggestions.map((s) => (
                          <div key={s.minrepoName} style={S.row}>
                            <span>民レポ「{s.minrepoName}」⇔ アナスロ「{s.anasloName}」<span style={{ color: "#5a6272" }}>（{s.count}台・平均{fmtSigned(s.mAvg)} / {fmtSigned(s.aAvg)}）</span></span>
                            <button style={{ ...S.ghost, color: "#9ece6a", borderColor: "#2f4a2a", flexShrink: 0 }} onClick={() => acceptAlias(s.anasloName, s.minrepoName)}>同じ機種として登録</button>
                          </div>
                        ))}
                        {recResult.countMismatch.map((x) => (
                          <div key={x.key} style={{ ...S.row, color: "#e8b34c" }}>台数が違う：「{x.name}」民レポ{x.mCount}台 / アナスロ{x.aCount}台 → 別機種が同じ名前でまとめて表示されている可能性があります。混ざっている機種の個別台データ（③）を一度貼ってください。</div>
                        ))}
                        {recResult.minrepoOnly.length > 0 && <div style={{ color: "#e5697a" }}>アナスロに見つからない：{recResult.minrepoOnly.map((r) => r.name + (r.no ? `(${r.no})` : "")).join("、")}</div>}
                        {recResult.anasloOnly.length > 0 && <div style={{ color: "#e5697a" }}>民レポに見つからない：{recResult.anasloOnly.map((g) => `${g.name}(${g.count}台)`).join("、")}</div>}
                      </div>
                    )}
                  </>
                )}
                <Collapse title={`登録済みの別名（${Object.keys(aliases).length}）・台番号の対応（${Object.keys(noModel).length}）・G数の種類（${Object.keys(gtypes).length}）`}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                    {Object.entries(aliases).map(([k, v]) => (
                      <div key={k} style={S.row}><span>別名：{k} → {v}</span><button style={S.ghost} onClick={async () => { const prev = kvRef.current[KEYS.aliases]; const r = await commitKV(KEYS.aliases, (p) => { const n = { ...p }; delete n[k]; return n; }); if (r.ok) pushUndo({ label: `別名「${k}」を削除`, kind: "kv", key: KEYS.aliases, prev }); }}><Trash2 size={11} /></button></div>
                    ))}
                    {Object.entries(noModel).map(([no, v]) => (
                      <div key={no} style={S.row}><span>台番号{no}：アナスロ「{v.anasloName}」→「{v.model}」（{v.since}〜）</span><button style={S.ghost} onClick={async () => { const prev = kvRef.current[KEYS.noModel]; const r = await commitKV(KEYS.noModel, (p) => { const n = { ...p }; delete n[no]; return n; }); if (r.ok) pushUndo({ label: `台番号${no}の対応を削除`, kind: "kv", key: KEYS.noModel, prev }); }}><Trash2 size={11} /></button></div>
                    ))}
                    {Object.entries(gtypes).map(([k, e]) => (
                      <div key={k} style={{ ...S.row, color: "#8b93a3" }}>{displayNameOf[k] || k}：{gtypeOfEntry(e) === "normal" ? "通常時G数（上限3900）" : gtypeOfEntry(e) === "total" ? "総回転数（上限8000）" : "未判定"}<span className="mono" style={{ color: "#5a6272" }}>通常時判定{e.normal}日・総回転判定{e.total}日・直近比{e.lastRatio}</span></div>
                    ))}
                  </div>
                </Collapse>
              </div>

              <Collapse title={`登録済みの日付（${new Set([...ovrDates, ...rawDates]).size}日）`} defaultOpen>
                <div className="scrollbar" style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                  {Array.from(new Set([...ovrDates, ...rawDates])).sort().reverse().map((d) => {
                    const rows = raw[d] ? unpackDay(raw[d]) : [];
                    const man = rows.filter((r) => r.src === "m").length;
                    return (
                      <div key={d} style={S.row}>
                        <span style={{ cursor: "pointer" }} onClick={() => { loadOvrDate(d); loadAnaDate(d); }} title="クリックで入力欄に読み込み">
                          <span className="mono">{d}</span>
                          {eventsOn(d).length > 0 && <span style={{ marginLeft: 6, color: isStrong(d) ? "#e5484d" : "#f2d24b" }}>{eventsOn(d).join("、")}</span>}
                          <span style={{ marginLeft: 6, color: ovr[d] ? "#9ece6a" : "#e5697a" }}>民レポ{ovr[d] ? "〇" : "未"}</span>
                          <span style={{ marginLeft: 6, color: rows.length - man ? "#9ece6a" : "#e5697a" }}>アナスロ{rows.length - man ? "〇" : "未"}</span>
                          {man > 0 && <span style={{ marginLeft: 6, color: "#bb9af7" }}>代用{man}台</span>}
                        </span>
                        <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          {ovr[d] && <button style={S.ghost} onClick={() => deleteDate("ovr", d)}>民レポ削除</button>}
                          {raw[d] && <button style={S.ghost} onClick={() => deleteDate("raw", d)}>アナスロ削除</button>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Collapse>

              <div className="grid2">
                <div style={S.card}>
                  <div style={S.h}>📅 イベント登録</div>
                  <div style={S.note}>過去・未来どの日付でも登録できます。同じ日に複数登録できます。イベントを登録していない日は自動で「イベント無し（通常日）」として扱います。</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                    <input type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)} style={S.input} />
                    <input list="event-names" value={evName} onChange={(e) => setEvName(e.target.value)} placeholder="イベント名" style={{ ...S.input, flex: "1 1 120px" }} />
                    <button onClick={addEvent} style={S.btn("#7aa2f7")}>登録</button>
                  </div>
                  <div style={{ fontSize: 11, color: "#8b93a3", margin: "2px 0 4px" }}>この日の対象機種（任意・3×3のように毎回違う機種の時）</div>
                  <ModelChips names={evTargets} onAdd={(n) => setEvTargets((l) => addUniqueName(l, n))} onRemove={(n) => setEvTargets((l) => l.filter((x) => x !== n))} />
                  {evName.trim() && (eventTargets[evName.trim()] || []).length > 0 && <div style={{ fontSize: 11, color: "#e8b34c", marginTop: 4 }}>「{evName.trim()}」のいつもの対象機種：{eventTargets[evName.trim()].join("、")}（自動で対象）</div>}
                  <Status s={evStatus} />
                  <div style={{ fontSize: 11, color: "#5a6272", margin: "10px 0 4px" }}>登録済み（イベント名を押すと、その日の対象機種を編集できます）</div>
                  <div className="scrollbar" style={{ maxHeight: 340, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                    {Object.keys(dateEvent).sort().reverse().map((d) => (
                      <div key={d} style={{ ...S.row, flexDirection: "column", alignItems: "stretch" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span className="mono" style={{ color: "#7aa2f7" }}>{d}</span>
                          <span style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
                            {splitNames(dateEvent[d]).map((n) => {
                              const dayT = ((dateEventTargets[d] || {})[n] || []).length;
                              const fixT = (eventTargets[n] || []).length;
                              const editing = editTarget && editTarget.date === d && editTarget.name === n;
                              return (
                                <span key={n} style={{ background: editing ? "#2a2416" : "#1b212b", borderRadius: 4, padding: "1px 6px", display: "inline-flex", gap: 4, alignItems: "center" }}>
                                  <span style={{ cursor: "pointer" }} onClick={() => setEditTarget(editing ? null : { date: d, name: n })}>{n}{dayT + fixT > 0 && <span style={{ color: "#e8b34c" }}> 🎯{dayT + fixT}</span>}</span>
                                  <button onClick={() => removeEvent(d, n)} style={{ background: "none", border: "none", color: "#5a6272", cursor: "pointer", padding: 0 }}><X size={10} /></button>
                                </span>
                              );
                            })}
                          </span>
                        </div>
                        {editTarget && editTarget.date === d && splitNames(dateEvent[d]).includes(editTarget.name) && (
                          <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed #2a323f" }}>
                            <div style={{ fontSize: 11, color: "#8b93a3", marginBottom: 4 }}>{d}「{editTarget.name}」のその日の対象機種</div>
                            <ModelChips names={(dateEventTargets[d] || {})[editTarget.name] || []} onAdd={(n) => setDateTargets(d, editTarget.name, (l) => addUniqueName(l, n))} onRemove={(n) => setDateTargets(d, editTarget.name, (l) => l.filter((x) => x !== n))} />
                            {(eventTargets[editTarget.name] || []).length > 0 && <div style={{ fontSize: 11, color: "#e8b34c", marginTop: 4 }}>＋いつもの対象機種：{eventTargets[editTarget.name].join("、")}</div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={S.card}>
                  <div style={S.h}>⭐ 強いイベント／準イベント</div>
                  <div style={S.note}>イベント名で登録します（日付ごとの登録は不要）。分類はデータが貯まって実測してから決めるのがおすすめです。</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                    <input list="event-names" value={tierName} onChange={(e) => setTierName(e.target.value)} placeholder="イベント名" style={{ ...S.input, flex: "1 1 120px" }} />
                    <button onClick={() => addTier(KEYS.strong)} style={S.btn("#e5484d")}>強い</button>
                    <button onClick={() => addTier(KEYS.semi)} style={S.btn("#9ece6a")}>準</button>
                  </div>
                  {kv[KEYS.strong].map((s) => <div key={`s-${s.name}`} style={{ ...S.row, marginBottom: 4 }}><span><Star size={10} color="#e5484d" fill="#e5484d" /> {s.name}</span><button style={S.ghost} onClick={() => removeTier(KEYS.strong, s.name)}><Trash2 size={11} /></button></div>)}
                  {kv[KEYS.semi].map((s) => <div key={`m-${s.name}`} style={{ ...S.row, marginBottom: 4 }}><span><Flag size={10} color="#9ece6a" /> {s.name}</span><button style={S.ghost} onClick={() => removeTier(KEYS.semi, s.name)}><Trash2 size={11} /></button></div>)}
                  <div style={{ ...S.h, marginTop: 14 }}>🚫 店休日</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <input type="date" value={closedDate} onChange={(e) => setClosedDate(e.target.value)} style={{ ...S.input, flex: 1 }} />
                    <button onClick={addClosed} style={S.btn("#3a4150", "#e7e9ee")}>登録</button>
                  </div>
                  {[...kv[KEYS.closed]].sort((a, b) => b.date.localeCompare(a.date)).map((c) => <div key={c.date} style={{ ...S.row, marginBottom: 4 }}><span className="mono">{c.date}　休</span><button style={S.ghost} onClick={() => removeClosed(c.date)}><Trash2 size={11} /></button></div>)}
                </div>
              </div>

              <div style={S.card}>
                <div style={S.h}>🎯 いつも同じ対象機種のイベント</div>
                <div style={S.note}>「このイベントはこの機種」と決まっているイベントは、ここでイベント名に対象機種を1回登録すれば、そのイベントの日は毎回自動で対象になります。毎回違う機種のイベント（3×3など）は、📅イベント登録の方で日付ごとに入れてください。</div>
                <input list="event-names" value={fixedEvName} onChange={(e) => setFixedEvName(e.target.value)} placeholder="イベント名を入力（または選択）" style={{ ...S.input, width: "100%", marginBottom: 8 }} />
                {fixedEvName.trim() && (
                  <div style={{ marginBottom: 10 }}>
                    <ModelChips names={eventTargets[fixedEvName.trim()] || []} onAdd={(n) => setFixedTargets(fixedEvName.trim(), (l) => addUniqueName(l, n))} onRemove={(n) => setFixedTargets(fixedEvName.trim(), (l) => l.filter((x) => x !== n))} placeholder={`「${fixedEvName.trim()}」の対象機種を追加`} />
                  </div>
                )}
                {Object.keys(eventTargets).sort().map((E) => (
                  <div key={E} style={{ ...S.row, marginBottom: 4, cursor: "pointer" }} onClick={() => setFixedEvName(E)}>
                    <span><b>{E}</b>　<span style={{ color: "#e8b34c" }}>🎯 {eventTargets[E].join("、")}</span></span>
                  </div>
                ))}
              </div>

              <div style={S.card}>
                <div style={S.h}>📤 エクスポート／インポート</div>
                <div style={S.note}>全データを1つのJSONファイルに書き出します（バックテスト用にもこのファイルを使います）。インポートは別端末への移行・復元用です。</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={handleExport} style={S.btn("#7aa2f7")}>エクスポート（ダウンロード）</button>
                  <label style={{ ...S.btn("#3a4150", "#e7e9ee"), display: "inline-block" }}>
                    インポート<input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e) => { handleImport(e.target.files && e.target.files[0]); e.target.value = ""; }} />
                  </label>
                </div>
                <Status s={importStatus} />
              </div>

              <button onClick={() => { setUnlocked(false); setPin(""); }} style={{ ...S.ghost, width: "100%", padding: 9, display: "flex", justifyContent: "center", gap: 6, alignItems: "center" }}><Lock size={12} /> ロックする</button>
            </>
          )}
        </div>
      )}

      {/* =================================================================== 全体データ */}
      {viewMode === "overall" && (
        <div style={{ maxWidth: 900 }}>
          {!ovrDates.length && !rawDates.length && (
            <div style={S.card}>
              <div style={S.h}>まだデータがありません</div>
              <div style={S.note}>「🔧 共通設定」で暗証番号を解除し、民レポとアナスロを貼り付けてください。機種ごとのページは「ページ追加」で作り、正式名称（機種名）を登録すると自動でデータが入ります。</div>
            </div>
          )}
          {dailyTotals.length > 0 && (
            <div style={S.card}>
              <div style={S.h}>📈 店全体の推移（民レポ）</div>
              <div style={S.note}>機種別の平均差枚×台数を全機種分（バラエティ含む）足し合わせています。</div>
              <div className="scrollbar" style={{ maxHeight: 360, overflow: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                  <thead><tr><th style={S.th}>日付</th><th style={{ ...S.th, textAlign: "right" }}>総差枚</th><th style={{ ...S.th, textAlign: "right" }}>平均差枚</th><th style={{ ...S.th, textAlign: "right" }}>平均G数</th><th style={{ ...S.th, textAlign: "right" }}>台数</th><th style={S.th}>マーク</th></tr></thead>
                  <tbody>{dailyTotals.map((d) => (
                    <tr key={d.date}>
                      <td className="mono" style={S.td}>{d.date} <span style={{ color: "#5a6272" }}>{WD[weekdayOf(d.date)]}</span>{eventsOn(d.date).length > 0 && <span style={{ marginLeft: 4, fontSize: 10, color: isStrong(d.date) ? "#e5484d" : "#f2d24b" }}>{eventsOn(d.date).join("、")}</span>}</td>
                      <td className="mono" style={{ ...S.td, textAlign: "right", color: d.total >= 0 ? "#9ece6a" : "#e5697a" }}>{fmtSigned(d.total)}</td>
                      <td className="mono" style={{ ...S.td, textAlign: "right", color: d.avg >= 0 ? "#9ece6a" : "#e5697a" }}>{fmtSigned(d.avg)}</td>
                      <td className="mono" style={{ ...S.td, textAlign: "right" }}>{fmt(d.avgG)}</td>
                      <td className="mono" style={{ ...S.td, textAlign: "right", color: "#5a6272" }}>{d.n}</td>
                      <td style={{ ...S.td, whiteSpace: "normal", fontSize: 11 }}>{d.marks.slice(0, 6).map((m, i) => <span key={i} style={{ color: markColor(m.mark), marginRight: 6 }}>{m.mark}{m.name}</span>)}{d.marks.length > 6 && <span style={{ color: "#5a6272" }}>他{d.marks.length - 6}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
          {ovrGridDates.length > 0 && (
            <Collapse title="📋 機種×日付マトリクス（☆◎◯▲、直近30日）" defaultOpen>
              <div style={S.note}>台数の多い順。青い枠はその日バラエティ（1台設置）だったセル、黄色い背景はイベント対象機種🎯です。</div>
              <div className="scrollbar" style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
                  <thead><tr><th style={{ ...S.th, position: "sticky", left: 0, background: "#1b212b" }} />{ovrGridDates.map((d) => <th key={d} className="mono" style={{ ...S.th, fontSize: 9 }}>{d.slice(5)}</th>)}</tr></thead>
                  <tbody>{ovrGridRows.map((k) => (
                    <tr key={k}>
                      <td title={displayNameOf[k] || k} style={{ ...S.td, position: "sticky", left: 0, background: "#1b212b", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", color: "#c7cbd4" }}>{displayNameOf[k] || k}</td>
                      {ovrGridDates.map((d) => { const c = ovrMark[k] && ovrMark[k][d]; return <td key={d} className="mono" style={{ ...S.td, textAlign: "center", color: c && c.mark ? markColor(c.mark) : "#2a323f", boxShadow: c && c.variety ? "inset 0 0 0 1px rgba(122,162,247,0.5)" : undefined, background: isTargetOn(d, k) ? "rgba(232,179,76,0.13)" : undefined }}>{c && c.mark ? c.mark : "・"}</td>; })}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Collapse>
          )}
          {ovrDates.length > 0 && (
            <Collapse title="🎰 機種を選んで過去一覧を見る">
              <select value={modelHist} onChange={(e) => setModelHist(e.target.value)} style={{ ...S.input, width: "100%", marginBottom: 10 }}>
                <option value="">機種を選択...</option>
                {ovrGridRows.map((k) => <option key={k} value={k}>{displayNameOf[k] || k}</option>)}
              </select>
              {modelHist && (
                <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                  <thead><tr><th style={S.th}>日付</th><th style={{ ...S.th, textAlign: "right" }}>平均差枚</th><th style={{ ...S.th, textAlign: "right" }}>G数</th><th style={{ ...S.th, textAlign: "right" }}>出率</th><th style={{ ...S.th, textAlign: "right" }}>勝率</th></tr></thead>
                  <tbody>{[...ovrDates].reverse().map((d) => {
                    const r = ovr[d].modelRows.find((x) => resolve(x.name) === modelHist);
                    if (!r) return null;
                    const mk = classifyMinRepoMark(r);
                    return (
                      <tr key={d}>
                        <td className="mono" style={S.td}>{mk && <span style={{ color: markColor(mk), marginRight: 4 }}>{mk}</span>}{d}{r.isVariety && <span style={{ color: "#7aa2f7", fontSize: 10 }}> 1台({r.no})</span>}</td>
                        <td className="mono" style={{ ...S.td, textAlign: "right", color: (r.avgSada ?? -1) >= 0 ? "#9ece6a" : "#e5697a" }}>{r.hiddenNegative ? "マイナス" : fmtSigned(r.avgSada)}</td>
                        <td className="mono" style={{ ...S.td, textAlign: "right" }}>{fmt(r.avgGsu)}</td>
                        <td className="mono" style={{ ...S.td, textAlign: "right" }}>{r.shutsu === null ? "―" : `${r.shutsu}%`}</td>
                        <td className="mono" style={{ ...S.td, textAlign: "right" }}>{r.total && !r.isVariety ? `${r.wins}/${r.total}` : "―"}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
            </Collapse>
          )}
          {ovrDates.length > 0 && (
            <Collapse title="🔢 末尾別（直近の日）">
              {(() => {
                const d = ovrDates[ovrDates.length - 1];
                return (
                  <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr><th style={S.th}>{d}</th><th style={{ ...S.th, textAlign: "right" }}>平均差枚</th><th style={{ ...S.th, textAlign: "right" }}>平均G数</th><th style={{ ...S.th, textAlign: "right" }}>勝率</th><th style={{ ...S.th, textAlign: "right" }}>出率</th></tr></thead>
                    <tbody>{ovr[d].digitRows.map((r) => (
                      <tr key={r.name}>
                        <td style={S.td}>{r.name}</td>
                        <td className="mono" style={{ ...S.td, textAlign: "right", color: r.hiddenNegative || (r.avgSada ?? 0) < 0 ? "#e5697a" : "#9ece6a" }}>{r.hiddenNegative ? "マイナス" : fmtSigned(r.avgSada)}</td>
                        <td className="mono" style={{ ...S.td, textAlign: "right" }}>{fmt(r.avgGsu)}</td>
                        <td className="mono" style={{ ...S.td, textAlign: "right" }}>{r.total ? `${r.wins}/${r.total}` : "―"}</td>
                        <td className="mono" style={{ ...S.td, textAlign: "right" }}>{r.shutsu === null ? "―" : `${r.shutsu}%`}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                );
              })()}
            </Collapse>
          )}
        </div>
      )}

      {/* =================================================================== 機種ページ */}
      {viewMode === "page" && currentPage && (
        <div style={{ maxWidth: 1100 }}>
          {unlocked && (
            <div style={S.card}>
              <div style={S.h}>ページの設定（編集画面）</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <input defaultValue={currentPage.name} key={`n-${currentPage.id}`} onBlur={(e) => e.target.value !== currentPage.name && updatePage(currentPage.id, { name: e.target.value })} placeholder="タブに出す名前（例：マイジャグ）" style={{ ...S.input, flex: "1 1 200px" }} />
                <button style={{ ...S.ghost, color: "#e5697a" }} onClick={() => window.confirm("このページを削除しますか？（データ自体は消えません）") && deletePage(currentPage.id)}><Trash2 size={11} /> ページ削除</button>
              </div>
              <div style={{ fontSize: 11, color: "#5a6272", marginBottom: 6 }}>正式名称（アナスロ・民レポの機種名。複数機種をまとめる時は1つずつ追加）</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {splitNames(currentPage.officialName).map((n) => (
                  <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, background: "rgba(122,162,247,0.12)", border: "1px solid #2a323f", borderRadius: 999, padding: "3px 6px 3px 10px" }}>
                    {n}<button onClick={() => updatePage(currentPage.id, { officialName: joinNames(splitNames(currentPage.officialName).filter((x) => x !== n)) })} style={{ background: "none", border: "none", color: "#5a6272", cursor: "pointer", padding: 0 }}><X size={12} /></button>
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input list="model-names" value={officialInput} onChange={(e) => setOfficialInput(e.target.value)} placeholder="機種名を入力して追加" style={{ ...S.input, flex: 1 }}
                  onKeyDown={(e) => { if (e.key === "Enter" && officialInput.trim()) { updatePage(currentPage.id, { officialName: joinNames([...splitNames(currentPage.officialName).filter((x) => !modelNamesMatch(x, officialInput, resolve)), officialInput.trim()]) }); setOfficialInput(""); } }} />
                <button style={S.ghost} onClick={() => { if (!officialInput.trim()) return; updatePage(currentPage.id, { officialName: joinNames([...splitNames(currentPage.officialName).filter((x) => !modelNamesMatch(x, officialInput, resolve)), officialInput.trim()]) }); setOfficialInput(""); }}>追加</button>
              </div>
            </div>
          )}

          {!pageNameKeys.size ? (
            <div style={S.card}><div style={S.note}>このページにはまだ機種が登録されていません。{unlocked ? "上の欄から正式名称を追加してください。" : "「🔧 共通設定」で暗証番号を解除すると設定できます。"}</div></div>
          ) : !engine ? (
            <div style={S.card}><div style={S.note}>この機種のアナスロデータがまだありません。</div></div>
          ) : (
            <>
              <div style={S.card}>
                <div style={{ ...S.h, fontSize: 14 }}>{pickTitle}</div>
                <div style={S.note}>
                  {engine.pick.lastDate}までのデータで予想。過去の「パターンに当てはまった台の翌日☆〇率 − 全体の☆〇率（基準{engine.learned.base !== null ? `${(engine.learned.base * 100).toFixed(1)}%` : "―"}）」を点数にして合計しています。学習済みパターン{engine.learned.weights.size}件（データ{engine.ctx.dates.length}日・サンプル数15未満のパターンは使いません）。
                  グレード：S≥60 / A≥30 / B≥10 / C≥-10 / D≥-30 / E。
                </div>
                {engine.learned.weights.size === 0 && <div style={{ fontSize: 12, color: "#e8b34c", marginBottom: 10 }}>データ蓄積中です。サンプル数がそろったパターンから順に点数が付きます（それまでは全台0pt）。</div>}
                <div className="scrollbar" style={{ maxHeight: 560, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                  {engine.pick.list.map((p) => {
                    const m = engine.ctx.machines.get(p.key);
                    const open = expandedPick[p.key];
                    const items = open ? p.items : p.items.slice(0, 5);
                    return (
                      <div key={p.key} style={{ background: "#12161d", border: "1px solid #2a323f", borderRadius: 8, padding: "9px 11px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span className="mono" style={{ width: 22, height: 22, lineHeight: "22px", textAlign: "center", borderRadius: "50%", fontWeight: 800, color: "#12161d", background: GRADE_COLORS[p.grade] }}>{p.grade}</span>
                          <span className="mono" style={{ fontWeight: 700, color: "#e8b34c" }}>{machineLabel(m)}</span>
                          {p.targetEvents && p.targetEvents.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#12161d", background: "#e8b34c", borderRadius: 999, padding: "1px 8px" }}>🎯 {p.targetEvents.join("、")}の対象</span>}
                          <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: p.points >= 0 ? "#9ece6a" : "#e5697a" }}>{p.points >= 0 ? "+" : ""}{p.points.toFixed(1)}pt</span>
                          <span style={{ fontSize: 11, color: "#5a6272" }}>前日 <span style={{ color: SYMBOL_COLORS[p.lastSym], fontWeight: 700 }}>{p.lastSym}</span>{p.lastExp && <> ・期待度 <span style={{ color: fiveBandColor(Math.round(p.lastExp.score * 100)) }}>{Math.round(p.lastExp.score * 100)}</span></>}</span>
                        </div>
                        {items.length > 0 && (
                          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 1 }}>
                            {items.map((it) => (
                              <div key={it.key} className="mono" style={{ fontSize: 11, display: "flex", justifyContent: "space-between", gap: 8, color: "#8b93a3" }}>
                                <span>{it.label}<span style={{ color: "#5a6272" }}>：翌日☆〇 {(it.rate * 100).toFixed(1)}%（n={it.n}）</span></span>
                                <span style={{ color: it.points >= 0 ? "#9ece6a" : "#e5697a", fontWeight: 700, whiteSpace: "nowrap" }}>{it.points >= 0 ? "+" : ""}{it.points.toFixed(1)}</span>
                              </div>
                            ))}
                            {p.items.length > 5 && <button style={{ ...S.ghost, alignSelf: "flex-start", marginTop: 4, padding: "2px 8px" }} onClick={() => setExpandedPick((s) => ({ ...s, [p.key]: !open }))}>{open ? "閉じる" : `残り${p.items.length - 5}件を見る`}</button>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <div style={S.h}>📋 記号マトリクス（台番号×日付）</div>
                  <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select value={gridEvent} onChange={(e) => setGridEvent(e.target.value)} style={{ ...S.input, fontSize: 11, padding: "4px 6px" }}>
                      <option value="">直近30日</option>
                      <option value={NO_EVENT_LABEL}>{NO_EVENT_LABEL}の日</option>
                      {kv[KEYS.eventNames].map((n) => <option key={n} value={n}>{n}の日</option>)}
                    </select>
                    <label style={{ fontSize: 11, color: "#8b93a3" }}><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> 過去の台も表示</label>
                  </span>
                </div>
                <div style={S.note}>
                  <span style={{ color: SYMBOL_COLORS["☆"] }}>☆</span>＝読み取り上位20%＋プラス　<span style={{ color: SYMBOL_COLORS["〇"] }}>〇</span>＝上位50%＋プラス　<span style={{ color: SYMBOL_COLORS["▽"] }}>▽</span>＝上位50%だがマイナス　<span style={{ color: SYMBOL_COLORS["□"] }}>□</span>＝中間　<span style={{ color: "#8b93a3" }}>×</span>＝推定低設定（下位20%）　－＝判定不可（回転数不足）。点線の下線は個別台の代用データ。黄色い背景＝その日のイベント対象機種🎯。
                </div>
                {renderSymbolGrid()}
              </div>

              <div style={S.card}>
                <div style={S.h}>🎰 設定期待度マトリクス</div>
                <div style={S.note}>
                  大きい数字＝期待度（0〜100、回転数が少ないほど0側に寄せる）、小さい数字＝生の読み取り。▼＝回転数が少ないのに出ている台（設定ではなく展開の可能性）。色：赤75以上／黄60／緑45／青30／灰。
                  {[...engine.ctx.modelCtx.values()].map((c) => (
                    <div key={c.key}>・{displayNameOf[c.key] || c.key}：{c.profile ? "確率表あり（設定判別）" : "確率表なし（店内の合算確率の順位で暫定判定）"}・G数は{c.gtype === "normal" ? "通常時（上限3900）" : c.gtype === "total" ? "総回転数（上限8000）" : "未判定（上限3900で計算）"}</div>
                  ))}
                </div>
                {renderExpGrid(gridDates, pageMachines)}
              </div>

              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={S.h}>📈 差枚推移</div>
                  <span style={{ display: "flex", gap: 4 }}>{[10, 30, 60, "all"].map((r) => <button key={r} onClick={() => setRange(r)} style={{ ...S.ghost, color: range === r ? "#4fd1c5" : "#8b93a3", borderColor: range === r ? "#4fd1c5" : "#2a323f" }}>{r === "all" ? "全期間" : `${r}日`}</button>)}</span>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData} margin={{ top: 8, right: 10, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#232b37" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#8b93a3" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#8b93a3" }} width={54} />
                    <Tooltip contentStyle={{ background: "#1b212b", border: "1px solid #2a323f", fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0} stroke="#3a4353" />
                    {selected.map((k, i) => { const m = engine.ctx.machines.get(k); return m ? <Line key={k} type="monotone" dataKey={k} name={machineLabel(m)} stroke={PALETTE[i % PALETTE.length]} dot={{ r: 1.5 }} strokeWidth={2} connectNulls /> : null; })}
                  </LineChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                  {pageMachines.map((m) => { const on = selected.includes(m.key); return (
                    <button key={m.key} className="mono" onClick={() => setSelected((s) => (on ? s.filter((x) => x !== m.key) : [...s, m.key]))} style={{ ...S.ghost, color: on ? "#e8b34c" : "#5a6272", borderColor: on ? "#e8b34c" : "#2a323f" }}>{machineLabel(m)}</button>
                  ); })}
                </div>
              </div>

              <div style={S.card}>
                <div style={S.h}>📅 日別データ</div>
                <select value={viewDate || engine.ctx.dates[engine.ctx.dates.length - 1]} onChange={(e) => setViewDate(e.target.value)} style={{ ...S.input, marginBottom: 8 }}>
                  {[...engine.ctx.dates].reverse().map((d) => <option key={d} value={d}>{d}（{WD[weekdayOf(d)]}）{eventsOn(d).length ? ` ${eventsOn(d).join("、")}` : ""}</option>)}
                </select>
                {(() => {
                  const d = viewDate || engine.ctx.dates[engine.ctx.dates.length - 1];
                  const list = [...engine.ctx.machines.values()].map((m) => ({ m, r: recAt(m, d) })).filter((x) => x.r).sort((a, b) => a.m.no - b.m.no);
                  return (
                    <div className="scrollbar" style={{ overflowX: "auto" }}>
                      <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                        <thead><tr><th style={S.th}>台</th><th style={{ ...S.th, textAlign: "right" }}>差枚</th><th style={{ ...S.th, textAlign: "right" }}>G数</th><th style={{ ...S.th, textAlign: "right" }}>BB</th><th style={{ ...S.th, textAlign: "right" }}>RB</th><th style={{ ...S.th, textAlign: "center" }}>記号</th><th style={{ ...S.th, textAlign: "right" }}>期待度</th></tr></thead>
                        <tbody>{list.map(({ m, r }) => (
                          <tr key={m.key}>
                            <td className="mono" style={S.td}>{machineLabel(m)}{r.src === "m" && <span style={{ color: "#bb9af7", fontSize: 10 }}> 代用</span>}</td>
                            <td className="mono" style={{ ...S.td, textAlign: "right", color: (r.s ?? 0) >= 0 ? "#9ece6a" : "#e5697a" }}>{fmtSigned(r.s)}</td>
                            <td className="mono" style={{ ...S.td, textAlign: "right" }}>{fmt(r.g)}</td>
                            <td className="mono" style={{ ...S.td, textAlign: "right" }}>{r.bb ?? "―"}</td>
                            <td className="mono" style={{ ...S.td, textAlign: "right" }}>{r.rb ?? "―"}</td>
                            <td className="mono" style={{ ...S.td, textAlign: "center", color: SYMBOL_COLORS[r.sym], fontWeight: 700 }}>{r.sym}</td>
                            <td className="mono" style={{ ...S.td, textAlign: "right", color: r.exp ? fiveBandColor(Math.round(r.exp.score * 100)) : "#5a6272" }}>{r.exp ? Math.round(r.exp.score * 100) : "―"}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>

              <Collapse title={`🧪 学習済みパターン一覧（${engine.learned.weights.size}件）`}>
                <div style={S.note}>点数の大きい順。n＝過去に当てはまった回数。⚠️は信頼度の低い項目です。</div>
                <div className="scrollbar" style={{ maxHeight: 360, overflowY: "auto" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
                    <thead><tr><th style={S.th}>パターン</th><th style={{ ...S.th, textAlign: "right" }}>n</th><th style={{ ...S.th, textAlign: "right" }}>翌日☆〇</th><th style={{ ...S.th, textAlign: "right" }}>点数</th></tr></thead>
                    <tbody>{[...engine.learned.weights.values()].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).map((w) => (
                      <tr key={w.key}>
                        <td style={{ ...S.td, whiteSpace: "normal" }}>{w.label}</td>
                        <td className="mono" style={{ ...S.td, textAlign: "right" }}>{w.n}</td>
                        <td className="mono" style={{ ...S.td, textAlign: "right" }}>{(w.rate * 100).toFixed(1)}%</td>
                        <td className="mono" style={{ ...S.td, textAlign: "right", color: w.points >= 0 ? "#9ece6a" : "#e5697a" }}>{w.points >= 0 ? "+" : ""}{w.points.toFixed(1)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </Collapse>
            </>
          )}
        </div>
      )}

      {/* 取り消し（操作履歴） */}
      {unlocked && kv[KEYS.undo].length > 0 && (
        <UndoPanel entries={kv[KEYS.undo]} onRestore={restoreUndo} onDismiss={(id) => commitKV(KEYS.undo, (p) => p.filter((x) => x.id !== id))} />
      )}
    </div>
  );
}

function UndoPanel({ entries, onRestore, onDismiss }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "fixed", right: 14, bottom: 14, zIndex: 50 }}>
      {open && (
        <div style={{ ...S.card, width: 300, maxHeight: 380, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
          <div style={S.h}>🕐 操作履歴（元に戻す）</div>
          {entries.map((e) => (
            <div key={e.id} style={{ background: "#12161d", border: "1px solid #2a323f", borderRadius: 8, padding: "7px 9px", marginTop: 6 }}>
              <div style={{ fontSize: 12 }}>{e.label}</div>
              <div style={{ fontSize: 10, color: "#5a6272", marginBottom: 5 }}>{new Date(e.ts).toLocaleString("ja-JP")}</div>
              <button onClick={() => onRestore(e)} style={{ ...S.btn("#9ece6a"), padding: "3px 10px", fontSize: 11 }}>元に戻す</button>
              <button onClick={() => onDismiss(e.id)} style={{ ...S.ghost, marginLeft: 6, padding: "3px 8px" }}>閉じる</button>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => setOpen((v) => !v)} style={{ float: "right", background: "#1b212b", color: "#c7cbd4", border: "1px solid #2a323f", borderRadius: 999, padding: "9px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🕐 操作履歴（{entries.length}）</button>
    </div>
  );
}
