// =============================================================================
// 玉屋本店 台データ推移トラッカー
// 形式（画面・Firebase・PWA）はプラザ2を手本に、エンジンは指示書 §4 の仕様で新規実装。
// このファイルの前半は「純粋なロジック」（パーサー・機種名照合・エンジン）で、
// テスト／バックテスト用に export している。後半が画面（React）。
// =============================================================================
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";
import { Trash2, Lock, X, ChevronDown, ChevronRight, Star, Flag, Plus, Pencil, ListChecks, RotateCcw } from "lucide-react";
import { storage } from "./storage";

// v0.1.0: 初版（プラザ2の形式＋指示書§4のエンジン＋本店用パーサー）
// v0.2.0: イベントの対象機種を登録できるように。
//   ①イベント名ごとの「いつもの対象機種」（slot-event-targets-v1）
//   ②日付×イベントごとの「その日の対象機種」（slot-date-event-targets-v1、3×3のように毎回違う機種用）
//   予想日の対象機種は🎯で表示し、エンジンに「イベント対象機種」「対象機種があるイベントで対象外」の
//   パターンを追加（効くかどうかは他のパターンと同じく実測で点数化、n<15は0pt）。
// v0.2.1: 機種の選び方をプルダウンに変更（台数の多い順・台数表示・表記ゆれは1つにまとめる）。
//   イベント対象機種・ページの正式名称の両方で使用。新台用に手入力欄も残す。
// v0.2.2: 全体データに「イベントを選んで過去を見る」を追加（プラザ2にあった機能の入れ忘れ）。
//   日別の総差枚・マーク機種・🎯対象機種の結果、機種別／末尾別のイベント日成績。「イベント無し」も選べる。
// v0.3.0: 機種ページをプラザ2と同じ構成に作り直し（v0.1.0で画面を独自に作ってしまい、
//   プラザ2の機能が抜けていたため）。左列：このページのデータ／台番号×日付マトリクス表（イベント複数選択）／
//   設定期待度マトリクス表。右列：差枚グラフ（10/20/30/60日足・全期間・期間指定、イベント・2/7のつく日・
//   店休日の目印）／表示する台番（全選択・全解除・過去の台番）／日別データ＋この日までの差枚推移
//   （7/10/20/30日間）＋この日までの期待度表／台別チャート／〇のつく日／ピックアップ／台同士の相関／
//   総差枚しきい値分析。スマホ表示も全体で見直し（全体データの推移表が潰れていた不具合を修正）。
// v0.3.1: マトリクス表の日付の下に「その日の☆〇の数／判定できた台数」を表示（出る日・出ない日の目安）。
// v0.3.2: 民レポとアナスロのずれチェックを追加。同じ日の両方を、機種ごと（バラエティは台番号ごと）の
//   平均差枚で突き合わせ、1台あたりのずれが大きい日に警告。前後7日の民レポとも比べて、
//   「このアナスロは○日の民レポとぴったり合う＝日付を間違えて貼った可能性」まで出す。
//   実サンプルで確認：同じ日なら1台あたり約9枚のずれ、違う日だと約1,200枚。
// v0.3.3: 「台数が合わない」がいつからいつまでか分かるように、④に全期間の履歴を追加
//   （機種ごとに、合わない期間・台数・アナスロ側の台番号の増減・原因のヒント）。あわせて照合を改善：
//   民レポのバラエティ欄に載っている台番号は機種別の台数から外す（自動で台番号の対応も登録）、
//   稼働なしの台（G数0・差枚0）を民レポが数えていない場合は一致とみなす、
//   「民レポにだけある機種と合わせると台数が合う」組み合わせをヒント表示（例：GOLD＋ゴージャス）。
// v0.3.4: 【不具合修正】バラエティ台の台番号照合で、間違った別名が自動登録されていた
//   （例：615番が民レポではクレア・アナスロでは鉄拳6だった日に「鉄拳6＝クレア」と登録され、
//   鉄拳6の6台がクレアに混ざって8台になった）。本店はバラエティ台の台移動が多く、民レポとアナスロで
//   移動の反映日がずれる・日付を取り違えると、同じ台番号でも別の機種になるため。
//   修正：自動登録は「その日の民レポとアナスロが一致（ずれチェックOK）」「その台の差枚がほぼ同じ」
//   「機種名が似ている」の3つがそろった時だけ。そろわない時は④に「名前が違う台」として表示するだけにする。
//   あわせて、登録済みの別名・台番号の対応のうち名前が似ていない怪しいものを検出して一括削除できるようにした。
// v0.3.5: 「データなしの日」（営業していたがデータが取れない日。例：10/6〜10/8のサイト障害）を登録できるように。
//   店休日とは別扱い：データなしの日をまたぐ「前日→翌日」の組み合わせは学習に使わず、連続（×2連続など）も
//   つなげない。予想日はデータなしの日も飛ばす。グラフには灰色の帯「なし」。キー slot-no-data-days-v1。
// v0.3.6: 「前日→翌日」としてつなげるのは、間の日がすべて店休日の時だけにした（データなし・民レポだけの日・
//   入れ忘れの日をまたがない）。予想日は店休日・データなし・すでに民レポがある日を飛ばす。
//   データなしの印は民レポだけある日にも付けられ、アナスロ（または個別台）を保存した時だけ自動で外れる。
// v0.3.7: 保存したあと、入力欄の日付を「次の日（店休日は飛ばす）」に進めるように（古い順に入力しやすく）。
//   民レポ・アナスロ・個別台すべて。民レポの日付の下にも登録済みかどうかを表示。
//   店休日を選んだ時は、貼り付け欄と保存ボタンをグレーにして入力できないように。
// v0.3.8: 全体データの「機種×日付マトリクス」にもイベントの複数選択を追加（選んだイベントの日だけを並べる。
//   未選択なら直近30日）。日付の文字色でイベントの種類（赤＝強い・緑＝準・黄＝イベント）も表示。
// v0.3.9: アナスロで「G数・差枚・BB・RBが全部0」の台を「データ欠け」として扱う（数字なし＝null）。
//   障害のあとのアナスロでは、民レポには数字がある台が全部0で出ていた（実データで108台。欠けとして扱うと
//   民レポとのずれは1台あたり約6枚＝一致）。0のまま学習すると「差枚0・G数0」と誤学習するため。
//   保存済みの過去データも読み込み時に同じ扱いにする。欠けた台は③個別台データで埋められる。
// v0.3.10: 機種の手入力欄に予測変換（候補）が出なくなっていたのを修正（v0.2.1でプルダウンにした時に候補リストの指定を外していた）。
// v0.3.11: 欠けたアナスロの台を個別台（民レポ）で埋めた日に、④の照合・ずれチェックで「台数が違う」と出ていた
//   不具合を修正。照合ではアナスロの行だけを見ていたので、埋めた台がアナスロ側から消えて見えていた
//   （例：ヴァルヴレイヴ 民レポ20台／アナスロ17台、625・1065・1072が埋めた台）。照合・ずれチェックでは
//   埋めた台（代用）も数える。ただしG数の種類の判定には代用の台を使わない（民レポのG数は総回転数のため）。
//   アナスロが1台も無い日（代用だけの日）は照合しない。
// v0.3.12: アナスロで全部0の台を、民レポを見て「稼働なし（0として数える）」と「データ欠け（数字なし）」に分けるように。
//   v0.3.9では全部0の台を一律に欠け扱いしていたが、終日動かなかった台も全部0になるため、ほとんどの日に
//   「欠け」が出ていた。機種ごとに、0を含めた平均と0を除いた平均のどちらが民レポの平均差枚に近いかで判定
//   （台がすべて0の機種は、民レポで差枚・G数があれば欠け）。民レポが無い日は稼働なしとして扱う。
//   保存はアナスロの数字のまま（0のまま）。判定は表示・照合・エンジンの直前に毎回行う。
// v0.4.0: 10/16の全データ分析（5/1〜10/15）の結果を反映。
//   ①全体データの一番上に「🔮 今日の見通し」：日付を選ぶと、その日のイベント・日付末尾・曜日・🎯対象機種から
//     機種ごとの見通し（過去の勝率を日数に応じて控えめに足したもの）、そのイベントの過去の主役機種
//     （7台以上・8割以上勝ち・平均+1000枚以上）、店の直近3日の出方（上位25%のあとは締め・下位25%のあとは返し）、
//     新台の導入日の成績、機種ごとの直近30日の金合わせ（その機種で相関-0.25以下の時だけ）を表示。
//     数字はすべて民レポから毎回計算（固定値なし）。
//   ②ピックアップの学習パターンを追加（台ピックアップはそのまま。効くかは他と同じく実測で点数化）：
//     前日 同じ機種の中で上位10%／下位10%、前日±3000枚以上、前日のG数の±2000G増減、店の直近3日（上位/下位25%）、
//     機種の直近30日（上位/下位1/3）。バックテスト（ウォークフォワード・全ページ）では
//     S 51.8%→51.2%・E 32.5%→32.3%（☆〇率）でほぼ変わらず＝台選びへの効き目は小さいという分析結果と一致。
// v0.4.1: 10/25のデータ（5/1〜10/24）で見直し。
//   ①グレードの境目を S≥100 / A≥60 / B≥-10 / C≥-60 / D≥-100 / E に変更（旧 S≥60/A≥30/B≥10/C≥-10/D≥-30）。
//     バックテストの翌日勝率（全ページ）：旧 S54.8/A42.7/B42.7/C41.4/D38.8/E36.5 → 新 S57.8/A48.5/B42.3/C39.0/D37.6/E33.1。
//     マイジャグ 新 S61.4〜E29.4、その他ジャグラー 新 S56.1〜E35.0、カバネリ 新 S49.1。
//   ②喰種・SAO2のピックアップに「参考表示」（点数で勝率の差がほぼ出ていないため。PICKUP_RELIABILITY）。
//   ③台ごとに「設定っぽさ」（0〜100）と🔥入ってそう・💤見切り。初当たり（機種平均に向けて縮める）・その台のいつもより
//     粘られたか・差枚の機種内の位置の平均。回転数そのものは「よく座られる台」が毎回同じ（前半→後半の相関0.9）で
//     設定と関係がないため、その台のいつもの回転数と比べた値を使う。マイジャグで下位1/5はRB 1/418・上位1/5は1/278。
//     ※この点数でも「どの台に入るか」は予想できなかった（AUC 0.50）。日・機種の見方の材料として表示。
//   ④今日の見通しに「機種の勢い」（直近30日×0.4・直近3日×0.2）を追加。毎日1位の機種の勝率 55.5%→56.6%、
//     上位3機種 50.0%→52.1%（ウォークフォワード）。
// v0.4.2: 【不具合修正】アナスロのエラーで「差枚はあるがG数が空」の台（10/23は72台）を、③個別台で埋められなかった
//   （アナスロ登録済みとみなして保存を飛ばしていた）。G数が空の台は全部0の台と同じく個別台で置き換える。
//   アナスロ保存時にG数が空の台があれば、機種ごとの台数と「③個別台で埋めて」という警告を出す。
// v0.4.3: ③個別台で、1台だけの機種（バラエティ）のページの形（「617番台」＋機種・差枚・G数・出率＋BB・RB）も読めるように。
//   何台分続けて貼ってもよく、台ごとに機種名を持つ。
// v0.4.4: 店が1週間ごと（月曜切り替え）にオススメ機種を変えている形をデータで確認したので反映。
//   「週の回され方」＝その週の月曜から前日までの、機種の平均G÷店全体の平均G（機種のいつもと日の全体を差し引く）。
//   同じ機種・同じ週の中の似かたは月曜始まりが最大（回され方0.40・平均差枚0.08、ばらばらなら0.02）。
//   月火で上位20%の機種は水〜日の勝率がいつもより+3.5%（下位20%は-2.4%、前半後半とも同じ。区切りを土曜にすると差は消える）。
//   ①今日の見通しに🔄（今週よく回されている）を表示し、見通しに+3.5%（下位は-2.4%）。
//   ②ピックアップの学習パターン「今週いつもより回されている／いない」を追加（バックテストAUC 0.580→0.581とわずか。
//     オススメの週は機種の台がまとめて上がる形で、台の順位はつかないため）。
// v0.4.5: 店のオススメ機種（1週間ごと・月曜〜日曜）を共通設定で登録できるように（キー slot-week-recommends-v1）。
//   見通しに⭐（登録週の実績で上乗せ、実績が少ないうちは+5%）、ピックアップに学習パターン「店のオススメ機種」。
//   共通設定には、その週のデータから見た🔄よく回されている機種をタップで追加できる候補として表示。
//   🔄の表示に「月曜から○日分」を追加（週の初めほど判定材料が少ないため）。エクスポート／インポートにも追加。
// v0.4.6: ピックアップのランクを「予想勝率」（機種の今日の見通し＋台の点数×0.0005）で付けるように。
//   バックテスト（6/12〜10/26・ウォークフォワード）：全体 S61/A47/B44/C41/D38/E32%（台の点数だけ S56/A46/B42/C39/D37/E33%）。
//   マイジャグ S63〜E29%、その他ジャグラー S59〜E33%。喰種・SAO2はSが付かない（今の材料では勝ちやすいと言えないため）。
//   並び順も予想勝率の順。台の点数（pt）と「台の点数だけならのランク」も残して表示。
// v0.4.7: ピックアップの理由の言葉を直した（「当日」「翌日」が同じ予想日を指していて分かりにくかったため）。
//   「前日」＝データの最後の日、「予想日」＝予想する日にそろえ、理由に[日]（日・機種の材料）／[台]（台の材料）を付けた。
//   日の材料が重なって点数が膨らむ件は、予想勝率のランクでは機種の見通しが主で、台の点数は×0.05%なので影響が小さい
//   （台だけの点数にしても S63〜E31%と同程度。台だけの点数の機種内AUCは0.506）。計算は変えていない。
export const APP_VERSION = "0.4.7";
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
  noData: "slot-no-data-days-v1", // [{ date }] 営業していたがデータが取れない日（v0.3.5）
  weekRec: "slot-week-recommends-v1", // { 週の月曜: [機種名...] } 店のオススメ機種（1週間ごと・v0.4.5）
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
export function nextOpenDate(d, closedSet, noDataSet) {
  let x = addDays(d, 1);
  for (let i = 0; i < 60 && ((closedSet && closedSet.has(x)) || (noDataSet && noDataSet.has(x))); i++) x = addDays(x, 1);
  return x;
}
// a と b（a<b）の間に「データなしの日」があるか
export function hasNoDataBetween(a, b, noDataSet) {
  if (!noDataSet || !noDataSet.size) return false;
  for (let x = addDays(a, 1); x < b; x = addDays(x, 1)) if (noDataSet.has(x)) return true;
  return false;
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
// アナスロで全部0（G数・差枚・BB・RB）の台。終日動かなかった台（稼働なし）と、障害などのデータ欠けの両方がある。
// v0.3.9〜0.3.11で数字なし（null）として保存した台も同じ扱い。
// v0.4.2：アナスロのエラーで「差枚はあるがG数が空」の台。個別台（民レポ）で埋められるようにする
export const isNoGRow = (r) => r.src !== "m" && (r.g === null || r.g === undefined) && r.s !== null && r.s !== undefined;
export const isFillableRow = (r) => isBlankRow(r) || isNoGRow(r);
export const isBlankRow = (r) => r.src !== "m" && ((r.g === null && r.s === null) || (!r.g && !r.s && !r.bb && !r.rb));
const asIdle = (r) => ({ ...r, g: 0, s: 0, bb: 0, rb: 0, idle: true });
const asMissing = (r) => ({ ...r, g: null, s: null, bb: null, rb: null, missing: true });
// 民レポを見て、全部0の台を「稼働なし（0）」か「欠け（null）」に分ける。民レポが無ければ全部「稼働なし」。
// rows は em（照合用の機種名）付き。
export function classifyBlankRows(rows, overall, resolve) {
  if (!rows.some(isBlankRow)) return rows;
  if (!overall) return rows.map((r) => (isBlankRow(r) ? asIdle(r) : r));
  const variety = new Map(overall.modelRows.filter((r) => r.isVariety).map((r) => [r.no, r]));
  const modelRow = new Map(overall.modelRows.filter((r) => !r.isVariety).map((r) => [resolve(r.name), r]));
  const played = (m) => m && ((m.avgSada !== null && Math.abs(m.avgSada) > 30) || (m.avgGsu || 0) > 100 || m.hiddenNegative);
  const groups = new Map();
  rows.forEach((r) => { if (variety.has(r.no)) return; const k = resolve(r.em || r.m); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  const missingNos = new Set();
  groups.forEach((rs, k) => {
    const z = rs.filter(isBlankRow);
    if (!z.length) return;
    const m = modelRow.get(k);
    if (!m || m.avgSada === null) return; // 民レポで比べられない → 稼働なし
    const nz = rs.filter((r) => !isBlankRow(r) && r.s !== null);
    if (m.total === nz.length) return; // 民レポがその台を数えていない＝動いていない
    if (!nz.length) { if (played(m)) z.forEach((r) => missingNos.add(r.no)); return; }
    const sum = nz.reduce((a, r) => a + r.s, 0);
    const a0 = sum / (nz.length + z.length), a1 = sum / nz.length;
    if (Math.abs(a1 - m.avgSada) < Math.abs(a0 - m.avgSada)) z.forEach((r) => missingNos.add(r.no));
  });
  rows.forEach((r) => { if (isBlankRow(r) && variety.has(r.no) && played(variety.get(r.no))) missingNos.add(r.no); });
  return rows.map((r) => (isBlankRow(r) ? (missingNos.has(r.no) ? asMissing(r) : asIdle(r)) : r));
}
// 民レポとの照合用：アナスロの行＋欠けを埋めた代用（個別台）の行。アナスロが1台も無い日は照合しない（空）。
export function reconRows(day, noModelMap, overall, resolve) {
  const all = unpackDay(day);
  if (!all.some((x) => x.src !== "m")) return [];
  const rows = all.map((x) => ({ ...x, em: effectiveModelName(x, noModelMap) }));
  return classifyBlankRows(rows, overall, resolve || normalizeModelName);
}
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
  // v0.4.3：1台だけの機種（バラエティ）のページの形にも対応
  //   617番台 / 機種 差枚 G数 出率 / 機種名 差枚 G数 出率 / BB RB 合成 BB率 RB率 / BB RB …（何台分続けて貼ってもよい）
  let single = null; // { no, step, row }
  const flushSingle = () => { if (single && single.row) rows.push(single.row); single = null; };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cols = raw.split("\t").map((c) => c.trim());
    const ban = line.match(/^(\d+)\s*番台$/);
    if (ban) { flushSingle(); single = { no: parseInt(ban[1], 10), step: "head", row: null }; continue; }
    if (single) {
      if (cols[0] === "機種") { single.step = "main"; continue; }
      if (cols[0] === "BB" && cols[1] === "RB") { single.step = "bonus"; continue; }
      if (single.step === "main" && cols.length >= 3) {
        const name = cols[0];
        single.row = { no: single.no, m: name, s: parseIntLoose(cols[1]), g: parseIntLoose(cols[2]), shutsu: parsePct(cols[3]), bb: null, rb: null };
        if (!model) model = name;
        continue;
      }
      if (single.step === "bonus" && single.row && cols.length >= 2) {
        single.row.bb = parseIntLoose(cols[0]); single.row.rb = parseIntLoose(cols[1]);
        flushSingle();
        continue;
      }
      continue;
    }
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
  flushSingle();
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
// v0.3.3: 台数が合わない原因をできるだけ自動で切り分ける。
//  ・民レポのバラエティ欄に載っている台番号は、機種別の台数から外して数える
//    （アナスロでは多台数の機種と同じ名前でも、民レポでは別機種の1台設置として載る台がある）
//  ・稼働なし（G数0・差枚0）の台は民レポが数えないことがあるので、それで台数が合えば「一致」とみなす
//  ・合わない時は、民レポにだけある機種で台数の差を埋められる組み合わせ（例：GOLD 18台＝GOLD 11台＋ゴージャス 7台）をヒントに出す
export const isIdleRow = (r) => !(r.g > 0) && !r.s;
// 機種名が似ているか（正規化した名前の最長共通部分が3文字以上かつ短い方の4割以上、または包含）
export function namesSimilar(a, b) {
  const x = normalizeModelName(a).replace(/[’'"]/g, ""), y = normalizeModelName(b).replace(/[’'"]/g, "");
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  let best = 0;
  const prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let diag = 0;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best >= 3 && best >= 0.4 * Math.min(x.length, y.length);
}
const sadaClose = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) <= Math.max(30, Math.abs(b) * 0.03);
export function reconcileSameDay(overall, anasloRows, resolve) {
  const res = { matched: [], suggestions: [], varietyAliases: [], varietyNoMaps: [], varietyConflicts: [], countMismatch: [], minrepoOnly: [], anasloOnly: [], gtypes: [] };
  if (!overall || !anasloRows || anasloRows.length === 0) return res;
  const nameCount = new Map();
  anasloRows.forEach((r) => { const k = resolve(r.em || r.m); nameCount.set(k, (nameCount.get(k) || 0) + 1); });
  const varietyNos = new Set(overall.modelRows.filter((r) => r.isVariety).map((r) => r.no));
  const groups = new Map();
  anasloRows.forEach((r) => {
    if (varietyNos.has(r.no)) return; // バラエティ欄の台は機種別の台数に入れない
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
      const same = sadaClose(a.s, row.avgSada);
      if (ak !== resolve(row.name)) {
        // 自動登録は「差枚がほぼ同じ（同じ台の同じ日）」かつ「名前が似ている」時だけ。
        // 台移動の反映日のずれ・日付の取り違えで、同じ台番号に別機種が入っていることがあるため。
        if (same && namesSimilar(a.em || a.m, row.name)) {
          // アナスロでその名前の台が1台だけなら機種名の別名、複数台あるなら台番号で振り分け
          if ((nameCount.get(ak) || 0) <= 1) res.varietyAliases.push({ anasloName: a.em || a.m, minrepoName: row.name, no: row.no });
          else res.varietyNoMaps.push({ no: row.no, model: row.name, anasloName: a.m });
        } else res.varietyConflicts.push({ no: row.no, minrepoName: row.name, anasloName: a.em || a.m, sameData: same });
      }
      if (same && a.src !== "m" && row.avgGsu && a.g) res.gtypes.push({ name: row.name, ratio: a.g / row.avgGsu });
      return;
    }
    const k = resolve(row.name);
    const g = groups.get(k);
    if (!g) { unmatchedMinrepo.push(row); return; }
    usedGroups.add(k);
    let rows = g.rows;
    let idleNos = [];
    if (row.total !== g.rows.length) {
      const active = g.rows.filter((r) => !isIdleRow(r));
      if (active.length === row.total) { idleNos = g.rows.filter(isIdleRow).map((r) => r.no); rows = active; }
    }
    const aAvgS = avg(rows, (r) => r.s);
    const aAvgG = avg(rows.filter((r) => !r.idle), (r) => r.g); // 稼働なし（0）の台はG数の判定に使わない
    const item = { name: row.name, key: k, mCount: row.total, aCount: g.rows.length, mAvg: row.avgSada, aAvg: aAvgS, mGsu: row.avgGsu, aGsu: aAvgG, idleNos, nos: g.rows.map((r) => r.no).sort((x, y) => x - y), idle: g.rows.filter(isIdleRow).map((r) => r.no) };
    res.matched.push(item);
    if (row.total !== rows.length) res.countMismatch.push(item);
    else if (row.avgGsu && aAvgG && !rows.some((r) => r.src === "m")) res.gtypes.push({ name: row.name, ratio: aAvgG / row.avgGsu }); // 代用（民レポのG数）が混ざる機種は使わない
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
  // ヒント：民レポにだけある機種の台数で差が埋まるか（アナスロが2機種を1つの名前でまとめている）
  res.countMismatch.forEach((it) => {
    const extra = it.aCount - it.mCount;
    const combo = res.minrepoOnly.find((r) => !r.isVariety && r.total === extra);
    if (combo) it.comboWith = { name: combo.name, count: combo.total };
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

// 民レポとアナスロのずれ（v0.3.2）。機種ごとの平均差枚（台数が一致する機種だけ）と、
// バラエティ台の台番号ごとの差枚で突き合わせ、1台あたりの平均のずれ（err）を出す。
// 同じ日のデータなら err は数十枚以内（実サンプルで約9枚）、違う日なら数百〜千枚以上になる。
export const DRIFT_OK = 60;
export const DRIFT_BAD = 250;
export function compareMinrepoAnaslo(overall, anasloRows, resolve) {
  const varietyNos = new Set(overall.modelRows.filter((r) => r.isVariety).map((r) => r.no));
  const groups = new Map();
  anasloRows.forEach((r) => { if (varietyNos.has(r.no)) return; const k = resolve(r.em || r.m); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  const byNo = new Map(anasloRows.map((r) => [r.no, r]));
  let mTotal = 0, mCount = 0, hidden = 0, errSum = 0, w = 0;
  const aTotal = anasloRows.reduce((a, r) => a + (r.s || 0), 0);
  overall.modelRows.forEach((r) => {
    const n = r.isVariety ? 1 : r.total || 0;
    mCount += n;
    if (r.avgSada === null) { hidden += n; return; }
    mTotal += r.avgSada * n;
    if (r.isVariety) {
      const a = byNo.get(r.no);
      if (a && a.s !== null) { errSum += Math.abs(a.s - r.avgSada); w += 1; }
      return;
    }
    let rows = groups.get(resolve(r.name));
    if (rows && rows.length !== r.total) { const act = rows.filter((x) => !isIdleRow(x)); rows = act.length === r.total ? act : null; }
    if (!rows) return;
    const vals = rows.map((x) => x.s).filter((v) => v !== null);
    if (vals.length !== rows.length) return;
    errSum += Math.abs(vals.reduce((a, b) => a + b, 0) / vals.length - r.avgSada) * r.total;
    w += r.total;
  });
  return { mTotal, aTotal, diff: aTotal - mTotal, mCount, aCount: anasloRows.length, hidden, err: w ? errSum / w : null, matched: w };
}
export function driftLevel(c) {
  if (!c || c.err === null || c.matched < 20) return "unknown";
  if (c.err <= DRIFT_OK) return "ok";
  if (c.err <= DRIFT_BAD) return "warn";
  return "bad";
}

// =============================================================================
// エンジン（指示書 §4）
// =============================================================================
const CAP_NORMAL = 3900; // 通常時G数の信頼度上限（§4-1）
const CAP_TOTAL = 8000; // 総回転数の信頼度上限
export const MIN_N = 15;
export const GRADE_BANDS = [
  // v0.4.1：10/25のバックテストで見直し（+100を超えると勝率がそれ以上上がらず、旧A〜Cはほぼ同じ勝率だったため）
  { min: 100, grade: "S" }, { min: 60, grade: "A" }, { min: -10, grade: "B" },
  { min: -60, grade: "C" }, { min: -100, grade: "D" }, { min: -Infinity, grade: "E" },
];
// v0.4.6：ピックアップのランクを「予想勝率」で付ける（機種の今日の見通し＋台の点数×0.0005）。
//   境目は5/23〜10/26のバックテストの分布（15/15/20/20/15/15%）から。全体で S61%〜E32%（台の点数だけだと S56%〜E33%）。
export const PRED_GRADE_BANDS = [
  { min: 0.62, grade: "S" }, { min: 0.50, grade: "A" }, { min: 0.44, grade: "B" },
  { min: 0.39, grade: "C" }, { min: 0.31, grade: "D" }, { min: -Infinity, grade: "E" },
];
export const PRED_PTS_WEIGHT = 0.0005;
// 日・機種の材料（予想日やその週・店全体のこと）か、台そのものの材料かの区別（表示用）
export const isDayPattern = (k) => /^(strongDay|dayDigit:|ev:|eventDay|noEvent|wd:|xEv:|evTail:|afterStrong|afterSemi|store3|week|evTarget|evNotTarget|m30)/.test(k);
export function predToGrade(p) { return PRED_GRADE_BANDS.find((b) => p >= b.min).grade; }
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
  // gapBefore[di]：dates[di-1] と dates[di] の間に「店休日ではない日」がある（＝データが無い営業日。前日→翌日としてつなげない）
  // closedSet を渡さない時（テスト・古い呼び出し）は、データなしの日だけを見る
  const gapBefore = dates.map((d, i) => {
    if (i === 0) return false;
    if (!o.closedSet) return hasNoDataBetween(dates[i - 1], d, o.noDataSet);
    for (let x = addDays(dates[i - 1], 1); x < d; x = addDays(x, 1)) if (!o.closedSet.has(x)) return true;
    return false;
  });
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
  // v0.4.0：その日の同じ機種の中での差枚の順位（0＝最下位〜1＝1位。3台以上ある時だけ）
  const byDayModel = new Map();
  machines.forEach((m) => m.recs.forEach((rec) => {
    if (rec.s === null || rec.s === undefined) return;
    const k = `${rec.di}|${m.modelKey}`;
    if (!byDayModel.has(k)) byDayModel.set(k, []);
    byDayModel.get(k).push(rec);
  }));
  byDayModel.forEach((list) => {
    if (list.length < 3) return;
    list.sort((a, b) => a.s - b.s);
    list.forEach((rec, idx) => { rec.rankPct = idx / (list.length - 1); });
  });
  // v0.4.1：設定っぽさ（初当たり・その台のいつもより粘られたか・差枚の3つを機種の中での位置にして平均。0〜100）
  //   見切り＝その日いつもより回されず（下位1/3）、差枚が±1000枚の中途半端、初当たりも機種平均以下
  //   入ってそう＝初当たりも粘られ方も上位1/3、または差枚が機種の上位10%
  {
    const byModel = new Map();
    machines.forEach((m) => m.recs.forEach((rec) => { if (!byModel.has(m.modelKey)) byModel.set(m.modelKey, []); byModel.get(m.modelKey).push({ m, rec }); }));
    const pctMap = (arr, val) => { const xs = arr.map(val).filter((v) => v !== null && v !== undefined && !Number.isNaN(v)).sort((a, b) => a - b); return (v) => (v === null || v === undefined || Number.isNaN(v) || !xs.length ? null : sortedInsertRank(xs, v)); };
    byModel.forEach((list) => {
      let K = 0, G = 0;
      list.forEach(({ rec }) => { if (rec.g > 0 && rec.bb !== null && rec.bb !== undefined && rec.rb !== null && rec.rb !== undefined) { K += rec.bb + rec.rb; G += rec.g; } });
      const mrate = G ? K / G : null;
      list.forEach(({ rec }) => {
        rec.hitShr = mrate && rec.g > 0 && rec.bb !== null && rec.bb !== undefined && rec.rb !== null && rec.rb !== undefined ? (rec.bb + rec.rb + mrate * 3000) / (rec.g + 3000) / mrate : null;
      });
      // その台のいつもの回転数（その日より前の5日以上の平均）と比べた今日
      const seen = new Set();
      list.forEach(({ m }) => {
        if (seen.has(m.key)) return; seen.add(m.key);
        let sum = 0, n = 0;
        m.recs.forEach((rec) => { rec.gRel = n >= 5 && rec.g > 0 ? rec.g / (sum / n) : null; if (rec.g > 0) { sum += rec.g; n += 1; } });
      });
      const hitP = pctMap(list, (x) => x.rec.hitShr), sP = pctMap(list, (x) => x.rec.s);
      const byDay = new Map();
      list.forEach((x) => { if (!byDay.has(x.rec.di)) byDay.set(x.rec.di, []); byDay.get(x.rec.di).push(x); });
      byDay.forEach((dl) => {
        const gP = pctMap(dl, (x) => (x.rec.gRel !== null ? x.rec.gRel : null));
        const gRaw = pctMap(dl, (x) => x.rec.g);
        dl.forEach(({ rec }) => {
          if (!(rec.g > 0) || rec.s === null || rec.s === undefined) { rec.setLike = null; return; }
          const h = hitP(rec.hitShr), gp = rec.gRel !== null ? gP(rec.gRel) : gRaw(rec.g), sp = sP(rec.s);
          const parts = [h, gp, sp].filter((v) => v !== null);
          rec.setLike = parts.length >= 2 ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) : null;
          rec.mikiri = gp !== null && gp <= 1 / 3 && Math.abs(rec.s) <= 1000 && rec.hitShr !== null && rec.hitShr < 1;
          rec.iri = (h !== null && gp !== null && h >= 2 / 3 && gp >= 2 / 3) || (sp !== null && sp >= 0.9);
        });
      });
    });
  }
  // v0.4.0：機種ごとの「直近30日の1台平均」の位置（機種の中で下位1/3＝lo・上位1/3＝hi）
  const model30 = new Map();
  {
    const perModel = new Map();
    byDayModel.forEach((list, k) => {
      const [di, mk] = [parseInt(k, 10), k.slice(k.indexOf("|") + 1)];
      if (!perModel.has(mk)) perModel.set(mk, new Array(dates.length).fill(null));
      perModel.get(mk)[di] = list.reduce((a, x) => a + x.s, 0) / list.length;
    });
    perModel.forEach((arr, mk) => {
      const l30 = arr.map((_, di) => {
        const w = arr.slice(Math.max(0, di - 29), di + 1).filter((v) => v !== null);
        return w.length >= 20 ? w.reduce((a, b) => a + b, 0) / w.length : null;
      });
      const sorted = l30.filter((v) => v !== null).sort((a, b) => a - b);
      if (sorted.length < 30) return;
      const lo = quantile(sorted, 1 / 3), hi = quantile(sorted, 2 / 3);
      model30.set(mk, l30.map((v) => (v === null ? null : v <= lo ? "lo" : v >= hi ? "hi" : null)));
    });
  }
  readingsForPct.sort((a, b) => a - b);
  const p20 = quantile(readingsForPct, 0.2);
  const p50 = quantile(readingsForPct, 0.5);
  const p80 = quantile(readingsForPct, 0.8);
  // 記号（§4-2）：読み取りの階層（p20/p50/p80）× 差枚
  machines.forEach((m) => m.recs.forEach((r) => { r.sym = classifySymbol(r, { p20, p50, p80 }); }));
  return { dates, gapBefore, machines, p20, p50, p80, eventsOn, isStrong, isSemi, targetsOn, modelCtx, sampleCount: readingsForPct.length, model30, storeLevel: o.storeLevel || null, weekPlay: o.weekPlay || null, weekRec: o.weekRec || null };
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
  const contiguous = (k) => k >= 1 && r[k].di - r[k - 1].di === 1 && !(ctx.gapBefore && ctx.gapBefore[r[k].di]);
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
  if (tail === tdig) add(`tailMatch:${s0}`, `台番末尾＝予想日の日付末尾 ＋ 前日${s0}`);
  add(`tail${tail}:${s0}`, `台番末尾${tail} ＋ 前日${s0}`);
  // 予想日のイベント
  const tEvents = ctx.eventsOn(target);
  if (s0 === "×") tEvents.forEach((E) => add(`xEv:${E}`, `前日× ＋ 予想日が「${E}」`));
  if (s0 === "×") for (let N = 4; N <= 7; N++) if (isGood(sym(i - N))) add(`xAgo${N}`, `前日× ＋ ${N}日前☆〇`);
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
  if (ctx.isStrong(d)) add("afterStrong", "前日が強いイベント");
  if (ctx.isSemi(d)) add("afterSemi", "前日が準イベント");
  // 予想日の属性
  add(`dayDigit:${tdig}`, `予想日の日付末尾${tdig}`);
  if (tEvents.length) {
    add("eventDay", "予想日がイベント日");
    tEvents.forEach((E) => {
      add(`ev:${E}`, `予想日がイベント「${E}」`);
      if (tail === tdig) add(`evTail:${E}`, `予想日が「${E}」＋ 台番末尾＝日付末尾`);
    });
  } else add("noEvent", "予想日がイベント無し");
  if (ctx.isStrong(target)) add("strongDay", "予想日が強いイベント");
  // イベント対象機種（v0.2.0）
  const tgMap = ctx.targetsOn ? ctx.targetsOn(target) : new Map();
  if (tgMap.size) {
    const hitEvents = [...tgMap.entries()].filter(([, set]) => set.has(m.modelKey)).map(([E]) => E);
    if (hitEvents.length) {
      add("evTarget", "予想日のイベント対象機種");
      hitEvents.forEach((E) => add(`evTarget:${E}`, `予想日の「${E}」の対象機種`));
    } else add("evNotTarget", "予想日は対象機種があるイベントで対象外");
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
  // v0.4.0 追加（10/16の全データ分析で見つかったもの。効くかどうかは他と同じく実測で点数化）
  const rk = r[i].rankPct;
  if (rk !== undefined) {
    if (rk >= 0.9) add("prevRankTop", "前日 同じ機種の中で差枚上位10%");
    else if (rk <= 0.1) add("prevRankBottom", "前日 同じ機種の中で差枚下位10%");
  }
  if (r[i].s !== null && r[i].s !== undefined) {
    if (r[i].s <= -3000) add("prevBigLose", "前日-3000枚以下（大負け）");
    else if (r[i].s >= 3000) add("prevBigWin", "前日+3000枚以上（大勝ち）");
  }
  if (c1 && r[i].g !== null && r[i].g !== undefined && r[i - 1].g !== null && r[i - 1].g !== undefined) {
    const dg = r[i].g - r[i - 1].g;
    if (dg >= 2000) add("gUp", "前日のG数が前々日より2000G以上増加");
    else if (dg <= -2000) add("gDown", "前日のG数が前々日より2000G以上減少");
  }
  if (ctx.weekRec && ctx.weekRec(m.modelKey, target)) add("weekOsusume", "予想日の週の店のオススメ機種（登録）");
  const wp = ctx.weekPlay ? ctx.weekPlay(m.modelKey, target) : null;
  if (wp === "hot") add("weekHot", "予想日の週にいつもより回されている機種（オススメっぽい）");
  else if (wp === "cold") add("weekCold", "予想日の週にいつもより回されていない機種");
  const st = ctx.storeLevel ? ctx.storeLevel(d) : null;
  if (st === "hi") add("store3hi", "店の直近3日が出ている（上位25%）");
  else if (st === "lo") add("store3lo", "店の直近3日が出ていない（下位25%）");
  const m30 = ctx.model30 && ctx.model30.get(m.modelKey);
  const m30v = m30 ? m30[r[i].di] : null;
  if (m30v === "lo") add("m30lo", "機種の直近30日が悪い（下位1/3）");
  else if (m30v === "hi") add("m30hi", "機種の直近30日が良い（上位1/3）");
  // 曜日
  add(`wd:${weekdayOf(target)}`, `予想日が${WD[weekdayOf(target)]}曜日`);
  // 月に☆〇 → 翌日（2通りの解釈を両方実装：今月の☆〇回数／月曜の☆〇）
  const ym = d.slice(0, 7);
  let cnt = 0;
  for (let j = i; j >= 0 && r[j].date.startsWith(ym); j--) if (isGood(r[j].sym)) cnt += 1;
  add(`month:${Math.min(cnt, 2)}`, `今月の☆〇 ${cnt >= 2 ? "2回以上" : `${cnt}回`}`);
  if (weekdayOf(d) === 1 && isGood(s0)) add("monGood", "前日（月曜）が☆〇");
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
      if (ctx.gapBefore && ctx.gapBefore[r[i + 1].di]) continue; // 間にデータなしの日がある組み合わせは使わない
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
export function scoreSymbolPickupToday(ctx, learned, closedSet, noDataSet) {
  const n = ctx.dates.length;
  if (!n) return { target: null, list: [] };
  const lastDi = n - 1;
  const target = nextOpenDate(ctx.dates[lastDi], closedSet, noDataSet);
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

// ---- 機種ページの分析（プラザ2から移植）----
export const EMPTY = Object.freeze([]);
export function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  if (n < 8) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  if (!dx2 || !dy2) return null;
  return num / Math.sqrt(dx2 * dy2);
}
export function buildTrailingPairs(series, w) {
  const pairs = [];
  for (let k = w - 1; k < series.length - 1; k++) {
    let sum = 0;
    for (let j = k - w + 1; j <= k; j++) sum += series[j].sada;
    pairs.push({ trailingSum: sum, nextSada: series[k + 1].sada, nextDate: series[k + 1].date });
  }
  return pairs;
}
export function findBestThresholds(pairs, minSample = 5, baseRate = 0.5) {
  if (pairs.length < minSample) return null;
  const ts = Array.from(new Set(pairs.map((p) => p.trailingSum))).sort((a, b) => a - b);
  let bestAbove = null, bestBelow = null;
  const evalSet = (arr) => ({ winRate: arr.filter((p) => p.nextSada > 0).length / arr.length, avgNext: arr.reduce((a, p) => a + p.nextSada, 0) / arr.length });
  ts.forEach((T) => {
    const above = pairs.filter((p) => p.trailingSum >= T);
    if (above.length >= minSample) {
      const e = evalSet(above);
      if (e.winRate > baseRate && (!bestAbove || e.winRate > bestAbove.winRate || (e.winRate === bestAbove.winRate && above.length > bestAbove.sampleSize))) bestAbove = { threshold: T, sampleSize: above.length, ...e };
    }
    const below = pairs.filter((p) => p.trailingSum <= T);
    if (below.length >= minSample) {
      const e = evalSet(below);
      if (e.winRate > baseRate && (!bestBelow || e.winRate > bestBelow.winRate || (e.winRate === bestBelow.winRate && below.length > bestBelow.sampleSize))) bestBelow = { threshold: T, sampleSize: below.length, ...e };
    }
  });
  return { totalPairs: pairs.length, bestAbove, bestBelow };
}
export function computeBaseRate(series) {
  if (!series.length) return 0.5;
  return series.filter((x) => x.sada > 0).length / series.length;
}
// カテゴリ軸では1日の幅が0なので、隣の日まで広げて帯を見えるようにする
export function getBandRange(dateList, date) {
  const i = dateList.indexOf(date);
  if (i === -1) return null;
  if (i < dateList.length - 1) return { x1: date, x2: dateList[i + 1] };
  if (i > 0) return { x1: dateList[i - 1], x2: date };
  return { x1: date, x2: date };
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
    if (full.gapBefore[t + 1]) continue; // データなしの日をまたぐ予想は採点しない
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
// =============================================================================
// v0.4.0：今日の見通し（10/16の全データ分析の結果をアプリに反映）
// 数字は固定で書かず、民レポから毎回計算する（データが増えると自動で更新される）。
// =============================================================================
function ovrDayAvg(day) {
  let tot = 0, n = 0;
  (day.modelRows || []).forEach((r) => { if (r.total && r.avgSada !== null && r.avgSada !== undefined) { tot += r.avgSada * r.total; n += r.total; } });
  return n ? tot / n : null;
}
// 店の「直近3日」の出方の位置。その日までのデータだけで上位25%＝hi・下位25%＝lo（後から知った数字は使わない）
export function buildStoreLevel(ovrByDate) {
  const dates = Object.keys(ovrByDate || {}).sort();
  const avg = dates.map((d) => ovrDayAvg(ovrByDate[d]));
  const level = {};
  const l3 = {};
  const seen = [];
  dates.forEach((d, i) => {
    if (i < 2 || avg[i] === null || avg[i - 1] === null || avg[i - 2] === null) return;
    const v = (avg[i] + avg[i - 1] + avg[i - 2]) / 3;
    l3[d] = v;
    seen.push(v);
    if (seen.length >= 20) {
      const s = [...seen].sort((a, b) => a - b);
      level[d] = v >= quantile(s, 0.75) ? "hi" : v <= quantile(s, 0.25) ? "lo" : "mid";
    }
  });
  return { level, l3, fn: (d) => level[d] || null };
}

// v0.4.1：ピックアップの点数で勝率の差がほぼ出ていない機種（10/25のバックテスト＝前日までのデータで翌日を予想して確かめた結果）
// 新しいデータで再確認したら書き換える。キーは機種名（照合後）
export const PICKUP_RELIABILITY = {
  "L東京喰種": "喰種は点数による勝率の差がほぼ出ていません（10/25時点のバックテストで S 43%〜E 35%、いつも41%。台・日とも予想が当たらない状態）。台選びより、木曜・勇者たまピーなど日の候補を参考にしてください。",
  "スロット ソードアート・オンラインⅡ": "SAO2は点数による勝率の差が出ていません（10/25時点のバックテストで S〜E すべて34〜38%）。3のつく日・極誓は弱い、1001番は全期間で勝率50%、という分かっていることを参考にしてください。",
};
// v0.4.4：その週（月曜始まり）の、前日までの「回され方」。店が1週間ごとにオススメ機種を変えているため。
//   回され方＝log(機種の平均G ÷ その日の店全体の平均G) から、機種のいつもとその日の全体を差し引いたもの。
//   予想日より前の同じ週の日だけで平均（月曜は前の週の情報を使わない）。上位20%＝hot・下位20%＝cold。
export function weekStartOf2(d) { const x = new Date(d + "T00:00:00Z"); const k = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - k); return x.toISOString().slice(0, 10); }
export function buildWeekPlay(ovrByDate, resolve) {
  const R = resolve || ((x) => x);
  const dates = Object.keys(ovrByDate || {}).sort();
  const gi = new Map(); // date -> Map(key -> value)
  const sum = new Map(), cnt = new Map();
  dates.forEach((d) => {
    const rows = (ovrByDate[d].modelRows || []).filter((r) => !r.isVariety && r.total >= 3 && r.avgGsu > 0);
    let G = 0, N = 0; rows.forEach((r) => { G += r.avgGsu * r.total; N += r.total; });
    if (!N) return;
    const m = new Map();
    rows.forEach((r) => { const k = R(r.name); const v = Math.log(r.avgGsu / (G / N)); m.set(k, v); sum.set(k, (sum.get(k) || 0) + v); cnt.set(k, (cnt.get(k) || 0) + 1); });
    gi.set(d, m);
  });
  // 機種のいつもを引き、その日の全体を引く
  gi.forEach((m) => {
    m.forEach((v, k) => m.set(k, v - sum.get(k) / cnt.get(k)));
    const vals = [...m.values()]; const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    m.forEach((v, k) => m.set(k, v - mean));
  });
  const cache = new Map();
  const priorOf = (k, target) => {
    const ck = `${k}@${target}`;
    if (cache.has(ck)) return cache.get(ck);
    const ws = weekStartOf2(target); let t = 0, n = 0;
    for (let x = ws; x < target; x = addDays(x, 1)) { const v = gi.get(x) && gi.get(x).get(k); if (v !== undefined) { t += v; n += 1; } }
    const out = n ? t / n : null;
    cache.set(ck, out);
    return out;
  };
  // しきい値：過去の「前日までの週平均」の分布（上位20%・下位20%）
  const all = [];
  dates.forEach((d) => { const m = gi.get(d); if (!m) return; m.forEach((_, k) => { const p = priorOf(k, d); if (p !== null) all.push(p); }); });
  all.sort((a, b) => a - b);
  const hi = all.length >= 50 ? quantile(all, 0.8) : null, lo = all.length >= 50 ? quantile(all, 0.2) : null;
  const level = (k, target) => { if (hi === null) return null; const p = priorOf(k, target); return p === null ? null : p >= hi ? "hot" : p <= lo ? "cold" : null; };
  return { priorOf, level, hi, lo };
}
export const SHUYAKU_MIN_N = 7;
export const SHUYAKU_MIN_RATE = 0.8;
export const SHUYAKU_MIN_AVG = 1000;
// 主役機種：その日ほぼ全台が勝った機種（7台以上・8割以上が勝ち・1台平均+1000枚以上）
export function shuyakuOf(day, resolve) {
  return (day.modelRows || []).filter((r) => !r.isVariety && r.total >= SHUYAKU_MIN_N && r.wins !== null && r.wins / r.total >= SHUYAKU_MIN_RATE && (r.avgSada ?? -1e9) >= SHUYAKU_MIN_AVG)
    .map((r) => ({ key: resolve(r.name), name: r.name, wins: r.wins, total: r.total, avg: r.avgSada }));
}

// 見通しの本体。target＝見たい日（その日より前の民レポだけを使う）
export function buildOutlook({ ovr, target, eventsOn, isTargetOn, resolve, weekPlay, weekRecMap }) {
  const dates = Object.keys(ovr || {}).filter((d) => d < target).sort();
  if (dates.length < 10) return null;
  const R = resolve || ((x) => x);
  const tEvents = eventsOn(target);
  const tDig = parseInt(target.slice(8, 10), 10) % 10;
  const tWd = weekdayOf(target);
  // 機種ごとの日別データ
  const series = new Map(); // key -> Map(date -> {wins,total,avg})
  const names = {};
  dates.forEach((d) => ovr[d].modelRows.forEach((r) => {
    if (r.isVariety || !r.total || r.wins === null || r.wins === undefined) return;
    const k = R(r.name);
    names[k] = r.name;
    if (!series.has(k)) series.set(k, new Map());
    series.get(k).set(d, { wins: r.wins, total: r.total, avg: r.avgSada });
  }));
  // 条件（予想日に当てはまるもの）。日付末尾は、同じ日がほぼイベントで登録済みなら二重に数えない
  const conds = [];
  tEvents.forEach((E) => conds.push({ id: `ev:${E}`, label: `「${E}」`, match: (d) => eventsOn(d).includes(E) }));
  if (!tEvents.length) conds.push({ id: "noev", label: "イベント無し", match: (d) => !eventsOn(d).length });
  const digMatch = (d) => parseInt(d.slice(8, 10), 10) % 10 === tDig;
  const digDays = dates.filter(digMatch);
  const dupDig = conds.some((c) => c.id.startsWith("ev:") && digDays.length && digDays.filter(c.match).length / digDays.length >= 0.8);
  if (!dupDig) conds.push({ id: "dig", label: `${tDig}のつく日`, match: digMatch });
  conds.push({ id: "wd", label: `${WD[tWd]}曜日`, match: (d) => weekdayOf(d) === tWd });
  const condDays = conds.map((c) => new Set(dates.filter(c.match)));
  // 主役の履歴（予想日のイベントごと）
  const shuyakuHistory = tEvents.map((E) => ({
    event: E,
    days: dates.filter((d) => eventsOn(d).includes(E)).map((d) => ({ date: d, list: shuyakuOf(ovr[d], R) })).reverse(),
  }));
  const shuyakuCount = {};
  const seenShu = new Set(); // 同じ日に2つのイベント（例：メガンダイ＋8のつく日）があっても1回と数える
  shuyakuHistory.forEach((h) => h.days.forEach((x) => x.list.forEach((s) => { const id = `${x.date}|${s.key}`; if (seenShu.has(id)) return; seenShu.add(id); shuyakuCount[s.key] = (shuyakuCount[s.key] || 0) + 1; })));
  // v0.4.5：店のオススメ機種（登録）。過去の登録週の成績（その機種のいつもとの差）を測る。少ないうちは+5%（10/28の分析値）
  const recKeysOf = (d) => new Set(((weekRecMap || {})[weekStartOf2(d)] || []).map(R));
  let recW = 0, recT = 0, recBase = 0, recDays = 0;
  const baseOf = {};
  series.forEach((m, k) => { let w = 0, t = 0; m.forEach((x) => { w += x.wins; t += x.total; }); baseOf[k] = t ? w / t : null; });
  dates.forEach((d) => { const ks = recKeysOf(d); if (!ks.size) return; ks.forEach((k) => { const x = series.get(k) && series.get(k).get(d); if (x && baseOf[k] !== null) { recW += x.wins; recT += x.total; recBase += baseOf[k] * x.total; recDays += 1; } }); });
  const recMeasured = recT ? (recW - recBase) / recT : null;
  const recLift = recMeasured === null ? 0.05 : (recMeasured * recDays + 0.05 * 20) / (recDays + 20);
  const targetRec = recKeysOf(target);
  const weekDaysSoFar = dates.filter((d) => d >= weekStartOf2(target) && d < target).length;
  // 機種ごとの見通し
  const lastDate = dates[dates.length - 1];
  const models = [];
  series.forEach((m, k) => {
    const latest = m.get(lastDate);
    if (!latest || latest.total < 3) return; // 今も置いてあり3台以上の機種
    let W = 0, T = 0;
    m.forEach((x) => { W += x.wins; T += x.total; });
    if (m.size < 15 || !T) return;
    const base = W / T;
    const parts = [];
    let est = base;
    conds.forEach((c, ci) => {
      let w = 0, t = 0, nd = 0;
      condDays[ci].forEach((d) => { const x = m.get(d); if (x) { w += x.wins; t += x.total; nd += 1; } });
      if (nd < 3 || !t) return;
      const rate = w / t;
      const weight = nd / (nd + 8); // 日数が少ないほど控えめに
      est += weight * (rate - base);
      parts.push({ label: c.label, rate, days: nd, diff: rate - base });
    });
    // v0.4.1：機種の勢い（直近30日・直近3日の勝率がいつもより高い/低い）。10/25の検証で係数0.4・0.2が最も当たった
    const dsAll = [...m.keys()].sort();
    const recentRate = (k) => { const ks = dsAll.slice(-k); let w = 0, t = 0; ks.forEach((d) => { const x = m.get(d); w += x.wins; t += x.total; }); return ks.length >= Math.min(k, 3) && t ? w / t : null; };
    const r30 = dsAll.length >= 20 ? recentRate(30) : null, r3 = recentRate(3);
    if (r30 !== null) { est += 0.4 * (r30 - base); parts.push({ label: "直近30日の勢い", rate: r30, days: Math.min(30, dsAll.length), diff: r30 - base }); }
    if (r3 !== null) { est += 0.2 * (r3 - base); parts.push({ label: "直近3日", rate: r3, days: Math.min(3, dsAll.length), diff: r3 - base }); }
    // v0.4.4：今週（月曜から前日まで）いつもより回されているか。10/28の検証で、上位20%の機種は残りの日の勝率がいつもより+3.5%（下位20%は-2.4%）
    let week = null;
    const isRec = targetRec.has(k);
    if (isRec) est += recLift;
    if (weekPlay) {
      const lv = weekPlay.level(k, target); const pv = weekPlay.priorOf(k, target);
      if (lv === "hot") est += 0.035; else if (lv === "cold") est -= 0.024;
      if (pv !== null) week = { level: lv, pct: Math.exp(pv) - 1, days: weekDaysSoFar };
    }
    // イベント対象機種（3*3など）：過去に対象だった日の成績
    const isTarget = isTargetOn ? isTargetOn(target, k) : false;
    let targetPart = null;
    if (isTarget) {
      let w = 0, t = 0, nd = 0;
      m.forEach((x, d) => { if (isTargetOn(d, k)) { w += x.wins; t += x.total; nd += 1; } });
      if (nd >= 2 && t) { targetPart = { rate: w / t, days: nd, diff: w / t - base }; est += (nd / (nd + 8)) * (w / t - base); }
    }
    // 直近30日の金合わせ（その機種で効いている時だけ表示）
    const ds = [...m.keys()].sort();
    const avgs = ds.map((d) => m.get(d).avg);
    const l30 = ds.map((_, i) => { const w = avgs.slice(Math.max(0, i - 30), i).filter((v) => v !== null); return w.length >= 20 ? w.reduce((a, b) => a + b, 0) / w.length : null; });
    const expOf = (d) => { // その日のイベントから見た「いつもの」平均（同じイベントの日の平均、無ければイベント無しの日の平均）
      const ev = eventsOn(d);
      const same = ds.filter((x) => x !== d && (ev.length ? eventsOn(x).some((e) => ev.includes(e)) : !eventsOn(x).length)).map((x) => m.get(x).avg).filter((v) => v !== null);
      return same.length >= 3 ? same.reduce((a, b) => a + b, 0) / same.length : null;
    };
    const xs = [], ys = [];
    ds.forEach((d, i) => { const e = l30[i] !== null && avgs[i] !== null ? expOf(d) : null; if (e !== null) { xs.push(l30[i]); ys.push(avgs[i] - e); } });
    let balance = null;
    if (xs.length >= 60) {
      const r = pearsonCorrelation(xs, ys);
      const all = avgs.slice(-30).filter((v) => v !== null);
      const cur = all.length >= 20 ? all.reduce((a, b) => a + b, 0) / all.length : null;
      if (r !== null && r <= -0.25 && cur !== null) {
        const sorted = [...xs].sort((a, b) => a - b);
        const pos = cur <= quantile(sorted, 1 / 3) ? "lo" : cur >= quantile(sorted, 2 / 3) ? "hi" : "mid";
        balance = { r, cur, pos, n: xs.length };
      }
    }
    models.push({ key: k, name: names[k], total: latest.total, base, est: Math.max(0.02, Math.min(0.98, est)), parts, isTarget, targetPart, shuyaku: shuyakuCount[k] || 0, balance, week, isRec });
  });
  models.sort((a, b) => b.est - a.est);
  // 店の直近3日
  const sl = buildStoreLevel(Object.fromEntries(dates.map((d) => [d, ovr[d]])));
  const l3dates = Object.keys(sl.l3).sort();
  const nextOf = {}; dates.forEach((d, i) => { if (i + 1 < dates.length) nextOf[d] = dates[i + 1]; });
  const grp = { hi: [], lo: [], mid: [] };
  l3dates.forEach((d) => { const lv = sl.level[d]; const nx = nextOf[d]; if (lv && nx) { const a = ovrDayAvg(ovr[nx]); if (a !== null) grp[lv].push(a); } });
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const store = { level: sl.level[lastDate] || null, l3: sl.l3[lastDate] ?? null, nextHi: mean(grp.hi), nextLo: mean(grp.lo), nextMid: mean(grp.mid), nHi: grp.hi.length, nLo: grp.lo.length };
  // 新台の導入日（民レポで初めて出た日。最初の日は除く）
  const firstSeen = {};
  dates.forEach((d) => ovr[d].modelRows.forEach((r) => { if (!r.isVariety && r.total >= 3) { const k = R(r.name); if (!firstSeen[k]) firstSeen[k] = { d, r }; } }));
  let nw = 0, nt = 0, ns = 0, nn = 0, nDay2w = 0, nDay2t = 0;
  Object.values(firstSeen).forEach(({ d, r }) => {
    if (d === dates[0]) return;
    nw += r.wins || 0; nt += r.total; ns += r.avgSada || 0; nn += 1;
    const i = dates.indexOf(d);
    if (i + 1 < dates.length) { const r2 = ovr[dates[i + 1]].modelRows.find((x) => R(x.name) === R(r.name)); if (r2 && r2.total) { nDay2w += r2.wins || 0; nDay2t += r2.total; } }
  });
  const newMachine = nn >= 3 ? { models: nn, rate: nt ? nw / nt : null, avg: ns / nn, nextRate: nDay2t ? nDay2w / nDay2t : null } : null;
  return { rec: { lift: recLift, measured: recMeasured, days: recDays, registered: targetRec.size }, target, lastDate, events: tEvents, conds: conds.map((c, i) => ({ label: c.label, days: condDays[i].size })), models, shuyakuHistory, store, newMachine };
}

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
  [KEYS.eventTargets]: {}, [KEYS.dateEventTargets]: {}, [KEYS.noData]: [], [KEYS.weekRec]: {},
};
const NO_EVENT_LABEL = "イベント無し";
const DIGIT2_COLOR = "#7dcfff";
const DIGIT7_COLOR = "#f6a04d";
const RANGE_OPTIONS = [
  { key: 10, label: "10日足" }, { key: 20, label: "20日足" }, { key: 30, label: "30日足" },
  { key: 60, label: "60日足" }, { key: "all", label: "全期間" },
];
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
  card: { background: "#1b212b", border: "1px solid #2a323f", borderRadius: 10, padding: 14, marginBottom: 14, minWidth: 0, maxWidth: "100%", boxSizing: "border-box" },
  h: { fontSize: 13, fontWeight: 700, color: "#c7cbd4", marginBottom: 4 },
  note: { fontSize: 11, color: "#5a6272", marginBottom: 10, lineHeight: 1.6 },
  input: { background: "#12161d", border: "1px solid #2a323f", borderRadius: 6, padding: "7px 8px", color: "#e7e9ee", fontSize: 13, boxSizing: "border-box", maxWidth: "100%" },
  textarea: { width: "100%", background: "#0e1218", border: "1px solid #2a323f", borderRadius: 6, padding: 8, color: "#d7dae0", fontSize: 11.5, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box", marginBottom: 10, fontFamily: "'JetBrains Mono','Menlo',monospace" },
  btn: (bg, fg = "#12161d") => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "9px 12px", fontWeight: 700, fontSize: 13, cursor: "pointer" }),
  ghost: { background: "none", border: "1px solid #2a323f", borderRadius: 6, color: "#8b93a3", padding: "5px 10px", fontSize: 11, cursor: "pointer" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 12, background: "#12161d", border: "1px solid #232b37", borderRadius: 6, padding: "6px 8px", minWidth: 0, wordBreak: "break-all" },
  th: { padding: "4px 6px", color: "#5a6272", fontWeight: 600, textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid #2a323f" },
  td: { padding: "4px 6px", borderBottom: "1px solid #1c2129", whiteSpace: "nowrap" },
};
function Status({ s }) {
  if (!s) return null;
  return <div style={{ marginTop: 8, fontSize: 11.5, color: s.type === "ok" ? "#9ece6a" : s.type === "warn" ? "#e8b34c" : "#e5697a", whiteSpace: "pre-wrap" }}>{s.msg}</div>;
}
function Collapse({ title, defaultOpen = false, children, right, flush }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={flush ? { ...S.card, marginBottom: 0 } : S.card}>
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

// 機種名を1つずつ追加・削除するチップ入力（イベント対象機種・ページの正式名称で使用）
// options: [{ key, name, count }]（台数の多い順）。プルダウンで選ぶか、新台などは手入力で追加する。
function ModelChips({ names, onAdd, onRemove, placeholder, options, resolve, icon = "🎯" }) {
  const [v, setV] = useState("");
  const add = () => { const t = v.trim(); if (!t) return; onAdd(t); setV(""); };
  const chosen = new Set(names.map((n) => (resolve ? resolve(n) : n)));
  const opts = (options || []).filter((o) => !chosen.has(o.key));
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
        {names.map((n) => (
          <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, background: "rgba(232,179,76,0.10)", border: "1px solid #3a3320", borderRadius: 999, padding: "2px 6px 2px 8px" }}>
            {icon ? `${icon} ` : ""}{n}<button onClick={() => onRemove(n)} style={{ background: "none", border: "none", color: "#5a6272", cursor: "pointer", padding: 0, display: "flex" }}><X size={10} /></button>
          </span>
        ))}
        {!names.length && <span style={{ fontSize: 11, color: "#5a6272" }}>未登録</span>}
      </div>
      <select value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value); }} style={{ ...S.input, width: "100%", fontSize: 12, padding: "6px 8px", marginBottom: 6 }}>
        <option value="">{opts.length ? `▼ 機種を選んで追加（台数の多い順・${opts.length}機種）` : "（民レポ・アナスロを貼ると機種が選べます）"}</option>
        {opts.map((o) => <option key={o.key} value={o.name}>{o.name}{o.count ? `（${o.count}台）` : ""}</option>)}
      </select>
      <div style={{ display: "flex", gap: 6 }}>
        <input list="model-names" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={placeholder || "機種名を入力（候補が出ます）"} style={{ ...S.input, flex: 1, fontSize: 12, padding: "5px 8px" }} />
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
  const noDataSet = useMemo(() => new Set((kv[KEYS.noData] || []).map((c) => c.date)), [kv]);
  // 予想日を決める時に飛ばす日（データなし＋すでに民レポがある＝終わった日）
  const skipTargetSet = useMemo(() => new Set([...noDataSet, ...Object.keys(ovr)]), [noDataSet, ovr]);
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
    rows: classifyBlankRows(unpackDay(raw[date]).map((r) => ({ ...r, em: effectiveModelName(r, noModel) })), ovr[date], resolve),
  })), [rawDates, raw, noModel, ovr, resolve]);
  const gtypeOf = useCallback((mk) => gtypeOfEntry(gtypes[mk]), [gtypes]);
  const storeLevelFn = useMemo(() => buildStoreLevel(ovr).fn, [ovr]);
  const weekPlay = useMemo(() => buildWeekPlay(ovr, resolve), [ovr, resolve]);
  const weekRecMap = kv[KEYS.weekRec] || KV_DEFAULTS[KEYS.weekRec];
  const weekRecFn = useCallback((k, d) => (weekRecMap[weekStartOf2(d)] || []).some((n) => resolve(n) === k), [weekRecMap, resolve]);
  const [recWeekDate, setRecWeekDate] = useState(todayStr());
  const [recStatus, setRecStatus] = useState(null);
  const recWeek = weekStartOf2(recWeekDate);
  const setWeekRec = useCallback(async (w, updater) => {
    const r = await commitKV(KEYS.weekRec, (prev) => {
      const next = { ...(prev || {}) };
      const list = updater(next[w] || []);
      if (list.length) next[w] = list; else delete next[w];
      return next;
    });
    setRecStatus(r.ok ? { type: "ok", msg: "保存しました。" } : null);
  }, [commitKV]);
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
  // プルダウン用：機種（表記ゆれは1つ）・直近の台数の多い順
  const modelOptions = useMemo(() => {
    const count = {};
    const latest = allDays.length ? allDays[allDays.length - 1] : null;
    if (latest) latest.rows.forEach((r) => { const k = resolve(r.em); count[k] = (count[k] || 0) + 1; });
    const lastOvr = ovrDates.length ? ovr[ovrDates[ovrDates.length - 1]] : null;
    if (lastOvr) lastOvr.modelRows.forEach((r) => { const k = resolve(r.name); if (!count[k]) count[k] = r.total || 1; });
    const keys = new Set(Object.keys(displayNameOf));
    return [...keys].map((k) => ({ key: k, name: displayNameOf[k], count: count[k] || 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));
  }, [allDays, ovrDates, ovr, resolve, displayNameOf]);
  // この週のデータから見た「よく回されている」機種（その週の、今日までに分かっている日で）
  const recSuggest = useMemo(() => {
    const until = addDays(recWeek, 7);
    const target = until <= todayStr() ? until : addDays(todayStr(), 1);
    const out = [];
    const keys = new Set();
    Object.keys(ovr).forEach((d) => { if (d >= recWeek && d < target) ovr[d].modelRows.forEach((r) => { if (!r.isVariety && r.total >= 3) keys.add(resolve(r.name)); }); });
    keys.forEach((k) => { const pv = weekPlay.priorOf(k, target); if (pv !== null && weekPlay.hi !== null && pv >= weekPlay.hi) out.push({ key: k, name: displayNameOf[k] || k, pct: Math.exp(pv) - 1 }); });
    return out.sort((a, b) => b.pct - a.pct).filter((x) => !(weekRecMap[recWeek] || []).some((n) => resolve(n) === x.key));
  }, [recWeek, ovr, resolve, weekPlay, displayNameOf, weekRecMap]);
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
    const rows = reconRows(r, kvRef.current[KEYS.noModel], o, res0);
    if (!rows.length) return null; // アナスロが無い日（代用だけ）は照合しない
    const rec = reconcileSameDay(o, rows, res0);
    // 民レポとアナスロが同じ日のデータだと確認できた時だけ、別名・台番号の対応・G数の種類を自動登録する
    const sameDay = driftLevel(compareMinrepoAnaslo(o, rows, res0)) === "ok";
    if (!sameDay) return { ...rec, varietyAliases: [], varietyNoMaps: [], notSameDay: true };
    const newAliases = {};
    rec.varietyAliases.forEach((v) => { newAliases[normalizeModelName(v.anasloName)] = v.minrepoName; });
    if (Object.keys(newAliases).length) await commitKV(KEYS.aliases, (prev) => ({ ...prev, ...newAliases }));
    // アナスロでは多台数の機種と同じ名前なのに、民レポではバラエティ（別機種の1台）として載っている台 → 台番号で振り分け
    const newNoMaps = {};
    rec.varietyNoMaps.forEach((v) => {
      const cur = kvRef.current[KEYS.noModel][v.no];
      if (!cur || normalizeModelName(cur.model) !== normalizeModelName(v.model)) newNoMaps[v.no] = { model: v.model, anasloName: v.anasloName, since: date };
    });
    if (Object.keys(newNoMaps).length) await commitKV(KEYS.noModel, (prev) => ({ ...prev, ...newNoMaps }));
    const res1 = makeResolver(kvRef.current[KEYS.aliases]);
    const rows1 = Object.keys(newNoMaps).length ? reconRows(r, kvRef.current[KEYS.noModel], o, res0) : rows;
    const rec2 = Object.keys(newAliases).length || Object.keys(newNoMaps).length ? reconcileSameDay(o, rows1, res1) : rec;
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
    return { ...rec2, varietyAliases: rec.varietyAliases, varietyNoMaps: rec.varietyNoMaps }; // 今回自動で照合したバラエティ台を報告する
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
    const dw = driftWarning(ovrDate);
    msg += blankSummary(ovrDate);
    if (noDataSet.has(ovrDate)) msg += `\n${ovrDate} は「データなし」のままです（台ごとのデータが無いため。アナスロか個別台を保存すると自動で外れます）。`;
    setOvrStatus({ type: dw ? "warn" : "ok", msg: msg + (dw || "") });
    setOvrText("");
    setOvrDate(nextOpenDate(ovrDate, closedSet));
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
    const anaNos = new Set(rows.filter((r) => !isFillableRow({ ...r, src: "a" })).map((r) => r.no)); // 数字があるアナスロの台（全部0・G数が空の台は個別台で埋められる）
    const keptManual = existing.filter((r) => r.src === "m" && !anaNos.has(r.no)); // アナスロに無い・欠けている台の代用データは残す
    const keptNos = new Set(keptManual.map((r) => r.no));
    const replaced = existing.filter((r) => r.src === "m" && anaNos.has(r.no)).length;
    const all = [...rows.filter((r) => !keptNos.has(r.no)).map((r) => ({ ...r, src: "a" })), ...keptManual];
    const blankCount = rows.filter((r) => isBlankRow({ ...r, src: "a" }) && !keptNos.has(r.no)).length;
    const noGRows = rows.filter((r) => isNoGRow({ ...r, src: "a" }) && !keptNos.has(r.no));
    setBusy(true);
    const res = await writeWeekly("raw", anaDate, packDay(all));
    setBusy(false);
    if (!res.ok) { setAnaStatus({ type: "error", msg: `保存に失敗しました：${res.error}` }); return; }
    let msg = `${anaDate} のアナスロを保存しました（${rows.length}台${replaced ? `・個別台の代用${replaced}台を上書き` : ""}${keptNos.size ? `・欠けている${keptNos.size}台は個別台の代用データを使用` : ""}）。`;
    if (blankCount) msg += blankSummary(anaDate);
    if (noGRows.length) {
      const byModel = {};
      noGRows.forEach((r) => { byModel[r.m] = (byModel[r.m] || 0) + 1; });
      msg += `\n⚠️ G数が空の台が${noGRows.length}台あります（アナスロのエラー）：${Object.entries(byModel).map(([m, n]) => `${m} ${n}台`).join("、")}。このままだと記号・期待度が出ないので、民レポの機種ページの表を③個別台に貼って埋めてください。`;
    }
    const rec = await autoReconcile(anaDate);
    if (rec) msg += reconcileSummary(rec);
    const dw = driftWarning(anaDate);
    msg += await clearNoDataOn(anaDate);
    setAnaStatus({ type: dw ? "warn" : "ok", msg: msg + (dw || "") });
    setAnaText("");
    setAnaDate(nextOpenDate(anaDate, closedSet));
  }

  async function handleSaveIndividual() {
    if (busy) return;
    const parsed = parseMinRepoIndividual(kbText);
    const model = (parsed.model || kbModel || "").trim();
    if (!model) { setKbStatus({ type: "error", msg: "機種名が分かりません。表の上の「○○ データ一覧」の行も一緒に貼るか、機種名を入力してください。" }); return; }
    if (!parsed.rows.length) { setKbStatus({ type: "error", msg: "台番号の行を読み取れませんでした。" }); return; }
    if (closedSet.has(kbDate)) { setKbStatus({ type: "error", msg: `${kbDate} は店休日として登録されています。` }); return; }
    const existing = rawRef.current[kbDate] ? unpackDay(rawRef.current[kbDate]) : [];
    const anaNos = new Set(existing.filter((r) => r.src !== "m" && !isFillableRow(r)).map((r) => r.no)); // 全部0（稼働なし・欠け）・G数が空のアナスロの台は個別台で埋められる
    const newNos = new Set(parsed.rows.map((r) => r.no));
    const toAdd = parsed.rows.filter((r) => !anaNos.has(r.no));
    const skipped = parsed.rows.length - toAdd.length;
    const addNos = new Set(toAdd.map((r) => r.no));
    // 同じ台番号の古い代用データと、欠けていたアナスロの行（数字なし）は、今回の個別台データに置き換える
    const kept = existing.filter((r) => !(addNos.has(r.no) && (r.src === "m" || isFillableRow(r))) && !(r.src === "m" && newNos.has(r.no)));
    const all = [...kept, ...toAdd.map((r) => ({ m: r.m || model, no: r.no, g: r.g, s: r.s, bb: r.bb, rb: r.rb, src: "m" }))];
    setBusy(true);
    let res = { ok: true };
    if (toAdd.length) res = await writeWeekly("raw", kbDate, packDay(all));
    if (!res.ok) { setBusy(false); setKbStatus({ type: "error", msg: `保存に失敗しました：${res.error}` }); return; }
    // 台番号→機種の対応を覚える（アナスロが別の名前でまとめて出している台だけ）
    // v0.3.11：同じ日のアナスロに数字がある台だけで判断する（数字が同じ＝同じ台と確認できた時だけ）。
    // 以前は近い別の日のアナスロを見ていたため、台の配置が違う日の機種名で間違って覚えることがあった。
    const res0 = makeResolver(kvRef.current[KEYS.aliases]);
    const learnedMap = {};
    parsed.rows.forEach((r) => {
      const a = existing.find((x) => x.no === r.no && x.src !== "m" && !isBlankRow(x)); // G数が空の台も差枚で同じ台か確かめられる
      if (!a || res0(a.m) === res0(r.m || model)) return;
      const same = a.s === r.s || Math.abs((a.s ?? 0) - (r.s ?? 0)) <= Math.max(30, Math.abs(r.s ?? 0) * 0.03);
      if (same) learnedMap[r.no] = { model: r.m || model, anasloName: a.m, since: kbDate };
    });
    if (Object.keys(learnedMap).length) await commitKV(KEYS.noModel, (prev) => ({ ...prev, ...learnedMap }));
    setBusy(false);
    const label = toAdd.some((r) => r.m) ? toAdd.map((r) => `${r.no}番 ${r.m || model}`).join("・") : `「${model}」`;
    const skippedInfo = parsed.rows.filter((r) => anaNos.has(r.no)).slice(0, 5).map((r) => { const a = existing.find((x) => x.no === r.no && x.src !== "m"); return a ? `${r.no}番（アナスロ：G${fmt(a.g)}・差枚${fmtSigned(a.s)}）` : `${r.no}番`; }).join("、");
    let msg = toAdd.length ? `${kbDate} ${label}${toAdd.some((r) => r.m) ? " " : ""}${toAdd.length}台分を代用データとして保存しました（後でアナスロが入ると自動で上書き）。` : `${kbDate} はアナスロに数字が入っているため、代用データは保存していません：${skippedInfo}`;
    if (skipped && toAdd.length) msg += `\n${skipped}台はアナスロ登録済みのため保存していません。`;
    if (toAdd.length) msg += await clearNoDataOn(kbDate);
    if (Object.keys(learnedMap).length) msg += `\n台番号${Object.keys(learnedMap).join("・")}を「${model}」として覚えました（アナスロでは「${Object.values(learnedMap)[0].anasloName}」と表示されている台）。`;
    setKbStatus({ type: "ok", msg });
    setKbText("");
    setKbDate(nextOpenDate(kbDate, closedSet));
  }

  // 全部0の台の内訳（稼働なし／欠け）を説明する文
  function blankSummary(date) {
    const r = rawRef.current[date];
    if (!r) return "";
    const res0 = makeResolver(kvRef.current[KEYS.aliases]);
    const o = ovrRef.current[date];
    const rows = reconRows(r, kvRef.current[KEYS.noModel], o, res0);
    const idle = rows.filter((x) => x.idle).length, miss = rows.filter((x) => x.missing);
    if (!idle && !miss.length) return "";
    if (!o) return `\n全部0の台が${idle}台あります。今は「終日稼働なし（0）」として数えます。同じ日の民レポを入れると、民レポでは動いていた台だけ自動で「データ欠け」に切り替わります。`;
    let t = idle ? `\n全部0の台のうち${idle}台は、民レポと合うので「終日稼働なし（0）」として数えます。` : "";
    if (miss.length) {
      const byModel = {};
      miss.forEach((x) => { byModel[x.m] = (byModel[x.m] || 0) + 1; });
      t += `\n⚠ 民レポでは動いているのにアナスロが全部0の台が${miss.length}台あります（アナスロのデータ欠け）。この台は学習に使いません。必要なら③個別台データで埋められます。\n　${Object.entries(byModel).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m}（${n}台）`).join("、")}`;
    }
    return t;
  }
  // 保存した直後に、同じ日の民レポ／アナスロとずれていないかを確認する（ref から最新を読む）
  function driftWarning(date) {
    const o = ovrRef.current[date];
    const r = rawRef.current[date];
    if (!o || !r) return null;
    const res0 = makeResolver(kvRef.current[KEYS.aliases]);
    const rows = reconRows(r, kvRef.current[KEYS.noModel], o, res0);
    if (!rows.length) return null;
    const c = compareMinrepoAnaslo(o, rows, res0);
    const level = driftLevel(c);
    if (level === "ok" || level === "unknown") return null;
    let better = null;
    Object.keys(ovrRef.current).forEach((od) => {
      if (od === date || od < addDays(date, -7) || od > addDays(date, 7)) return;
      const c2 = compareMinrepoAnaslo(ovrRef.current[od], rows, res0);
      if (c2.err !== null && c2.matched >= 20 && c2.err <= DRIFT_OK && (!better || c2.err < better.err)) better = { date: od, err: c2.err };
    });
    return `\n⚠ ${date} の民レポとアナスロがずれています（1台あたり平均${Math.round(c.err).toLocaleString()}枚・総差枚 民レポ${fmtSigned(c.mTotal)}／アナスロ${fmtSigned(c.aTotal)}）。どちらかの日付を間違えていないか確認してください。${better ? `\n→ このアナスロは ${better.date} の民レポとぴったり合います。` : ""}`;
  }

  function reconcileSummary(rec) {
    const parts = [];
    if (rec.notSameDay) parts.push("民レポとアナスロが同じ日のデータか確認できなかったので、機種名の自動登録はしていません。");
    if (rec.varietyAliases.length) parts.push(`バラエティ台の名前違い${rec.varietyAliases.length}件を台番号で自動照合しました。`);
    if (rec.varietyNoMaps && rec.varietyNoMaps.length) parts.push(`民レポでバラエティ（別機種の1台）として載っている台番号${rec.varietyNoMaps.map((v) => v.no).join("・")}を、台番号で振り分けるように登録しました。`);
    if (rec.suggestions.length) parts.push(`名前が違う機種の候補が${rec.suggestions.length}件あります →「機種名の照合」で確認してください。`);
    if (rec.countMismatch.length) parts.push(`台数が合わない機種：${rec.countMismatch.map((x) => `${x.name}（民レポ${x.mCount}/アナスロ${x.aCount}）`).join("、")}`);
    return parts.length ? `\n${parts.join("\n")}` : "\n民レポとアナスロの機種はすべて一致しました。";
  }

  // 店休日を選んでいる時は入力できない（v0.3.7）
  const closedNotice = (d) => (closedSet.has(d) ? <div style={{ fontSize: 12, color: "#e5697a", fontWeight: 700, marginBottom: 8 }}>🚫 {d} は店休日です。入力できません（日付を変えてください）。</div> : null);
  const lockedArea = (d) => (closedSet.has(d) ? { opacity: 0.35, pointerEvents: "none", background: "#0b0e13" } : {});

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
  // ---- データなしの日（v0.3.5）----
  const [noDataFrom, setNoDataFrom] = useState("");
  const [noDataTo, setNoDataTo] = useState("");
  const [noDataStatus, setNoDataStatus] = useState(null);
  async function addNoData() {
    const from = noDataFrom, to = noDataTo && noDataTo >= noDataFrom ? noDataTo : noDataFrom;
    if (!from) { setNoDataStatus({ type: "error", msg: "日付を選んでください。" }); return; }
    const add = [], skipped = [];
    for (let x = from, i = 0; x <= to && i < 62; x = addDays(x, 1), i++) {
      if (noDataSet.has(x)) continue;
      if (closedSet.has(x)) { skipped.push(`${md(x)}（店休日）`); continue; }
      if (rawRef.current[x]) { skipped.push(`${md(x)}（アナスロあり）`); continue; }
      add.push({ date: x });
    }
    if (!add.length) { setNoDataStatus({ type: "error", msg: `登録できる日がありません。${skipped.join("、")}` }); return; }
    const r = await commitKV(KEYS.noData, (prev) => [...(prev || []), ...add]);
    if (!r.ok) { setNoDataStatus({ type: "error", msg: `保存に失敗しました：${r.error}` }); return; }
    setNoDataStatus({ type: "ok", msg: `${add.map((x) => md(x.date)).join("・")} をデータなしの日として登録しました。${skipped.length ? `（${skipped.join("、")}は登録していません）` : ""}` });
    setNoDataFrom(""); setNoDataTo("");
  }
  async function removeNoData(date) {
    const prev = kvRef.current[KEYS.noData];
    const r = await commitKV(KEYS.noData, (p) => (p || []).filter((c) => c.date !== date));
    if (r.ok) pushUndo({ label: `データなしの日 ${date} を解除`, kind: "kv", key: KEYS.noData, prev });
  }
  // データを保存できた日にデータなしの印が付いていたら、自動で外す（あとからデータが復旧した場合）
  async function clearNoDataOn(date) {
    if (!(kvRef.current[KEYS.noData] || []).some((c) => c.date === date)) return "";
    const r = await commitKV(KEYS.noData, (p) => (p || []).filter((c) => c.date !== date));
    return r.ok ? `\n${date} はデータなしの日として登録されていたので、印を外しました。` : "";
  }
  async function removeClosed(date) {
    const prev = kvRef.current[KEYS.closed];
    const r = await commitKV(KEYS.closed, (p) => p.filter((c) => c.date !== date));
    if (r.ok) pushUndo({ label: `店休日 ${date} を削除`, kind: "kv", key: KEYS.closed, prev });
  }

  // ---- ページ ----
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
      noDataDays: kv[KEYS.noData] || [],
      overallSummaries: ovrDates.map((d) => ({ date: d, event: dateEvent[d] || "", ...ovr[d] })),
      eventNames: kv[KEYS.eventNames],
      rawFullTable: raw,
      rawFullTableFormat: "packed-v1",
      modelAliases: aliases,
      noModelMap: noModel,
      modelGTypes: gtypes,
      eventTargets,
      dateEventTargets,
      weekRecommends: kv[KEYS.weekRec] || {},
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
        [KEYS.closed, obj.closedDays], [KEYS.noData, obj.noDataDays], [KEYS.dateEvent, obj.dateEventMap], [KEYS.aliases, obj.modelAliases], [KEYS.noModel, obj.noModelMap], [KEYS.gtype, obj.modelGTypes],
        [KEYS.eventTargets, obj.eventTargets], [KEYS.dateEventTargets, obj.dateEventTargets], [KEYS.weekRec, obj.weekRecommends],
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
  // ---- 怪しい別名・台番号の対応（名前が似ていない）v0.3.4 ----
  const suspiciousAliases = useMemo(() => Object.entries(aliases).filter(([k, v]) => !namesSimilar(k, v)).map(([k]) => k), [aliases]);
  // 台番号の対応は「名前が似ていない」か「登録した日のアナスロ（数字のある行）で、その台番号がその名前だったと確認できない」ものを怪しいとする
  const suspiciousNoMaps = useMemo(() => Object.entries(noModel).filter(([no, v]) => {
    if (!v || !v.anasloName) return false;
    if (!namesSimilar(v.anasloName, v.model)) return true;
    const day = v.since && raw[v.since];
    if (!day) return true;
    const a = unpackDay(day).find((x) => x.no === Number(no) && x.src !== "m" && !isBlankRow(x));
    return !a || normalizeModelName(a.m) !== normalizeModelName(v.anasloName);
  }).map(([no]) => no), [noModel, raw]);
  // G数の種類（通常時／総回転数）を、民レポとアナスロが同じ日と確認できた日だけから作り直す
  async function rebuildGtypes() {
    const res0 = makeResolver(kvRef.current[KEYS.aliases]);
    const next = {};
    Object.keys(ovrRef.current).sort().forEach((d) => {
      const r = rawRef.current[d];
      if (!r) return;
      const rows = reconRows(r, kvRef.current[KEYS.noModel], ovrRef.current[d], res0);
      if (!rows.length || driftLevel(compareMinrepoAnaslo(ovrRef.current[d], rows, res0)) !== "ok") return;
      reconcileSameDay(ovrRef.current[d], rows, res0).gtypes.forEach((g) => {
        const t = gtypeFromRatio(g.ratio);
        if (!t) return;
        const k = res0(g.name);
        const e = next[k] || (next[k] = { normal: 0, total: 0, dates: [] });
        e[t] += 1;
        e.dates = [...e.dates, d].slice(-60);
        e.lastRatio = Math.round(g.ratio * 1000) / 1000;
        e.lastDate = d;
      });
    });
    return commitKV(KEYS.gtype, () => next);
  }
  async function removeSuspicious() {
    const prevA = kvRef.current[KEYS.aliases], prevN = kvRef.current[KEYS.noModel];
    const r1 = await commitKV(KEYS.aliases, (p) => { const n = { ...p }; suspiciousAliases.forEach((k) => delete n[k]); return n; });
    const r2 = await commitKV(KEYS.noModel, (p) => { const n = { ...p }; suspiciousNoMaps.forEach((k) => delete n[k]); return n; });
    if (r1.ok) pushUndo({ label: `怪しい別名${suspiciousAliases.length}件を削除`, kind: "kv", key: KEYS.aliases, prev: prevA });
    if (r2.ok && suspiciousNoMaps.length) pushUndo({ label: `怪しい台番号の対応${suspiciousNoMaps.length}件を削除`, kind: "kv", key: KEYS.noModel, prev: prevN });
    const prevG = kvRef.current[KEYS.gtype];
    const r3 = await rebuildGtypes();
    if (r3.ok) pushUndo({ label: "G数の種類を作り直し", kind: "kv", key: KEYS.gtype, prev: prevG });
    if (r1.ok && r2.ok) setNotice({ type: "ok", msg: `怪しい別名${suspiciousAliases.length}件・台番号の対応${suspiciousNoMaps.length}件を削除し、G数の種類を確認できた日だけから作り直しました（右下の操作履歴から元に戻せます）。` });
  }
  // ---- 民レポとアナスロのずれチェック（v0.3.2）----
  const anasloRowsOf = useCallback((d) => (raw[d] ? reconRows(raw[d], noModel, ovr[d], resolve) : []), [raw, noModel, ovr, resolve]);
  const driftChecks = useMemo(() => {
    if (viewMode !== "common" || !unlocked) return null;
    const out = {};
    bothDates.forEach((d) => {
      const rows = anasloRowsOf(d);
      if (!rows.length) return;
      const c = compareMinrepoAnaslo(ovr[d], rows, resolve);
      const level = driftLevel(c);
      let better = null;
      if (level === "warn" || level === "bad") {
        // 前後7日の民レポのうち、このアナスロとぴったり合う日を探す
        ovrDates.forEach((od) => {
          if (od === d || od < addDays(d, -7) || od > addDays(d, 7)) return;
          const c2 = compareMinrepoAnaslo(ovr[od], rows, resolve);
          if (c2.err !== null && c2.matched >= 20 && c2.err <= DRIFT_OK && (!better || c2.err < better.err)) better = { date: od, err: c2.err };
        });
      }
      out[d] = { ...c, level, better };
    });
    return out;
  }, [viewMode, unlocked, bothDates, anasloRowsOf, ovr, ovrDates, resolve]);
  // ---- 台数が合わない日の履歴（全期間・v0.3.3）----
  const countHistory = useMemo(() => {
    if (viewMode !== "common" || !unlocked) return null;
    const byKey = new Map();
    let prevNos = new Map();
    bothDates.forEach((d) => {
      const rec = reconcileSameDay(ovr[d], anasloRowsOf(d), resolve);
      const mis = new Map(rec.countMismatch.map((x) => [x.key, x]));
      const curNos = new Map(rec.matched.map((x) => [x.key, x.nos]));
      mis.forEach((x, k) => {
        if (!byKey.has(k)) byKey.set(k, { key: k, name: x.name, days: [], comboWith: null });
        const h = byKey.get(k);
        const before = prevNos.get(k);
        const added = before ? x.nos.filter((n) => !before.includes(n)) : [];
        const removed = before ? before.filter((n) => !x.nos.includes(n)) : [];
        h.days.push({ date: d, mCount: x.mCount, aCount: x.aCount, added, removed, nos: x.nos });
        if (x.comboWith) h.comboWith = x.comboWith;
      });
      // 一致した日も「区切り」として記録（期間をまたいでくっつけないため）
      byKey.forEach((h, k) => { if (!mis.has(k) && curNos.has(k)) h.days.push({ date: d, ok: true }); });
      prevNos = curNos;
    });
    // 同じ台数の連続した日を1つの期間にまとめる
    return [...byKey.values()].map((h) => {
      const runs = [];
      h.days.forEach((x) => {
        const last = runs[runs.length - 1];
        if (last && !x.ok && !last.ok && last.mCount === x.mCount && last.aCount === x.aCount && !x.added.length && !x.removed.length) { last.to = x.date; last.n += 1; return; }
        if (last && x.ok && last.ok) { last.to = x.date; last.n += 1; return; }
        runs.push({ ...x, from: x.date, to: x.date, n: 1 });
      });
      const bad = h.days.filter((x) => !x.ok);
      return { ...h, runs, badDays: bad.length, first: bad[0].date, last: bad[bad.length - 1].date };
    }).sort((a, b) => b.last.localeCompare(a.last) || b.badDays - a.badDays);
  }, [viewMode, unlocked, bothDates, ovr, anasloRowsOf, resolve]);
  const driftProblems = useMemo(() => (driftChecks ? Object.entries(driftChecks).filter(([, c]) => c.level === "warn" || c.level === "bad").sort((a, b) => b[0].localeCompare(a[0])) : []), [driftChecks]);
  const onlyOneSide = useMemo(() => {
    const all = new Set([...ovrDates, ...rawDates]);
    return [...all].filter((d) => !noDataSet.has(d) && !(ovr[d] && raw[d] && unpackDay(raw[d]).some((x) => x.src !== "m"))).sort().reverse();
  }, [ovrDates, rawDates, ovr, raw, noDataSet]);
  const [recDate, setRecDate] = useState("");
  const recDateEff = recDate && bothDates.includes(recDate) ? recDate : bothDates[bothDates.length - 1] || "";
  const recResult = useMemo(() => {
    if (!recDateEff || viewMode !== "common" || !unlocked) return null;
    const rows = reconRows(raw[recDateEff], noModel, ovr[recDateEff], resolve);
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
    const ctx = buildSymbolContext(pageDays, { profileOf: (mk) => profileByKey[mk] || null, gtypeOf, eventsOn, isStrong, isSemi, targetsOn, noDataSet, closedSet, storeLevel: storeLevelFn, weekPlay: weekPlay.level, weekRec: weekRecFn });
    const learned = learnSymbolPatternWeights(ctx);
    const pick = scoreSymbolPickupToday(ctx, learned, closedSet, skipTargetSet);
    // v0.4.6：予想勝率（機種の見通し＋台の点数）でランク付け
    let ol = null;
    try { if (pick.target) ol = buildOutlook({ ovr, target: pick.target, eventsOn, isTargetOn, resolve, weekPlay, weekRecMap }); } catch (e) { ol = null; }
    const estOf = new Map(ol ? ol.models.map((x) => [x.key, x]) : []);
    pick.list.forEach((it) => {
      const mk = ctx.machines.get(it.key) ? ctx.machines.get(it.key).modelKey : null;
      const o = mk ? estOf.get(mk) : null;
      it.ptGrade = it.grade;
      if (o) { it.modelEst = o.est; it.pred = o.est + PRED_PTS_WEIGHT * it.points; it.grade = predToGrade(it.pred); } else { it.modelEst = null; it.pred = null; }
    });
    pick.list.sort((a, b) => (b.pred ?? -1) - (a.pred ?? -1) || b.points - a.points || a.no - b.no);
    return { ctx, learned, pick };
  }, [pageDays, profileByKey, gtypeOf, eventsOn, isStrong, isSemi, targetsOn, closedSet, noDataSet, skipTargetSet, storeLevelFn, weekPlay, weekRecFn, ovr, isTargetOn, resolve, weekRecMap]);
  const isMultiModel = useMemo(() => new Set(pageDays.flatMap((d) => d.machines.map((m) => m.modelKey))).size > 1, [pageDays]);
  const machineLabel = (m) => (isMultiModel ? `${m.model} ${m.no}番` : `${m.no}番`);

  // ページ内の表示設定（v0.3.0：プラザ2の機種ページと同じ構成）
  const [showPast, setShowPast] = useState(false);
  const [gridEventFilter, setGridEventFilter] = useState([]); // イベント複数選択（マトリクス表の絞り込み）
  const [range, setRange] = useState(30);
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [selected, setSelected] = useState([]);
  const [viewDate, setViewDate] = useState("");
  const [viewWindow, setViewWindow] = useState(7);
  const [luckyDigit, setLuckyDigit] = useState(null);
  const [analysisWindow, setAnalysisWindow] = useState(10);
  const [expandedPick, setExpandedPick] = useState({});
  const [dateListOpen, setDateListOpen] = useState(false);
  const [confirmDeleteDate, setConfirmDeleteDate] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pageStatus, setPageStatus] = useState(null);
  useEffect(() => {
    setSelected([]); setViewDate(""); setExpandedPick({}); setShowPast(false); setGridEventFilter([]);
    setUseCustomRange(false); setLuckyDigit(null); setConfirmDeleteDate(null); setConfirmReset(false); setPageStatus(null);
  }, [activePageId]);

  const pageDates = engine ? engine.ctx.dates : EMPTY;
  const lastPageDi = pageDates.length - 1;
  const lastPageDate = pageDates.length ? pageDates[lastPageDi] : "";
  // 台 key → (日付 → 記録)
  const recIndex = useMemo(() => {
    const idx = new Map();
    if (engine) engine.ctx.machines.forEach((m) => idx.set(m.key, new Map(m.recs.map((r) => [r.date, r]))));
    return idx;
  }, [engine]);
  const recOf = useCallback((key, date) => { const mm = recIndex.get(key); return mm ? mm.get(date) || null : null; }, [recIndex]);
  const recAt = useCallback((m, date) => recOf(m.key, date), [recOf]);
  // 日付ごとの☆〇の数（判定不可の－は数えない）
  const goodCountByDate = useMemo(() => {
    const out = {};
    if (engine) engine.ctx.machines.forEach((m) => m.recs.forEach((r) => {
      if (r.sym === "－") return;
      const c = out[r.date] || (out[r.date] = { good: 0, n: 0 });
      c.n += 1;
      if (GOOD_SYMBOLS.has(r.sym)) c.good += 1;
    }));
    return out;
  }, [engine]);
  const sortMachines = (arr) => arr.sort((a, b) => a.no - b.no || a.model.localeCompare(b.model));
  const activeMachines = useMemo(() => (engine ? sortMachines([...engine.ctx.machines.values()].filter((m) => m.recs.length && m.recs[m.recs.length - 1].di === lastPageDi)) : EMPTY), [engine, lastPageDi]);
  const allMachines = useMemo(() => (engine ? sortMachines([...engine.ctx.machines.values()]) : EMPTY), [engine]);
  const pageMachines = showPast ? allMachines : activeMachines; // 「表示する台番」の候補・マトリクス表の行
  const machineByKey = useMemo(() => new Map(allMachines.map((m) => [m.key, m])), [allMachines]);
  // 最初の6台を選ぶのはページを開いた時の1回だけ（全解除した後に勝手に選び直さない）
  const autoSelectedFor = useRef(null);
  useEffect(() => {
    if (autoSelectedFor.current === activePageId || !activeMachines.length) return;
    autoSelectedFor.current = activePageId;
    setSelected(activeMachines.slice(0, 6).map((m) => m.key));
  }, [activeMachines, activePageId]);
  const effViewDate = viewDate || lastPageDate;

  // マトリクス表の日付（イベント複数選択で絞り込み。未選択なら直近30日）新しい日が左
  const gridDates = useMemo(() => {
    let ds;
    if (gridEventFilter.length) {
      ds = pageDates.filter((d) => {
        const names = eventsOn(d);
        if (!names.length) return gridEventFilter.includes(NO_EVENT_LABEL);
        return names.some((n) => gridEventFilter.includes(n));
      });
    } else ds = pageDates.slice(-30);
    return [...ds].reverse();
  }, [pageDates, gridEventFilter, eventsOn]);

  // グラフの日付軸（データのある日＋その間の店休日）
  const timelineDates = useMemo(() => {
    if (!pageDates.length) return EMPTY;
    const first = pageDates[0], last = pageDates[lastPageDi];
    const set = new Set(pageDates);
    closedSet.forEach((d) => { if (d >= first && d <= last) set.add(d); });
    noDataSet.forEach((d) => { if (d >= first && d <= last) set.add(d); });
    return [...set].sort();
  }, [pageDates, lastPageDi, closedSet, noDataSet]);
  const visibleDates = useMemo(() => {
    if (useCustomRange && customStart && customEnd) return timelineDates.filter((d) => d >= customStart && d <= customEnd);
    if (range === "all") return timelineDates;
    // 「○日足」はデータのある日で数える（店休日は数に入れない）
    const dataDays = timelineDates.filter((d) => !closedSet.has(d) && !noDataSet.has(d));
    const start = dataDays.length > range ? dataDays[dataDays.length - range] : dataDays[0];
    return timelineDates.filter((d) => d >= start);
  }, [timelineDates, range, useCustomRange, customStart, customEnd, closedSet, noDataSet]);
  const chartData = useMemo(() => visibleDates.map((date) => {
    const row = { date, event: eventsOn(date).join("、"), closed: closedSet.has(date) };
    selected.forEach((k) => { const r = recOf(k, date); row[k] = r && r.s !== null ? r.s : null; });
    return row;
  }), [visibleDates, selected, recOf, eventsOn, closedSet]);
  const chartMarks = useMemo(() => {
    const out = { closed: [], nodata: [], d2: [], d7: [], strong: [], semi: [], ev: [] };
    visibleDates.forEach((d) => {
      if (closedSet.has(d)) out.closed.push(d);
      if (noDataSet.has(d)) out.nodata.push(d);
      const dd = parseInt(d.slice(8, 10), 10) % 10;
      if (dd === 2) out.d2.push(d);
      if (dd === 7) out.d7.push(d);
      const names = eventsOn(d);
      if (!names.length) return;
      if (isStrong(d)) out.strong.push({ date: d, name: names.find((n) => strongNames.has(n)) || names[0] });
      else if (isSemi(d)) out.semi.push({ date: d, name: names.find((n) => semiNames.has(n)) || names[0] });
      else out.ev.push({ date: d, name: names[0] });
    });
    return out;
  }, [visibleDates, closedSet, noDataSet, eventsOn, isStrong, isSemi, strongNames, semiNames]);
  // 台別チャート（選んだ期間の累計差枚）
  const cumSeries = useCallback((key, dates) => {
    let cum = 0, started = false, last = null;
    const raw = dates.map((date) => {
      const r = recOf(key, date);
      if (r && r.s !== null) { cum += r.s; started = true; last = date; }
      return { date, value: started ? cum : null };
    });
    const series = raw.map((pt) => (last && pt.date > last ? { ...pt, value: null } : pt));
    return { series, total: cum, count: raw.filter((pt, i) => { const r = recOf(key, dates[i]); return r && r.s !== null; }).length };
  }, [recOf]);
  const machineSummaries = useMemo(() => selected.map((k) => {
    const m = machineByKey.get(k);
    if (!m) return null;
    return { key: k, m, ...cumSeries(k, visibleDates) };
  }).filter(Boolean), [selected, machineByKey, cumSeries, visibleDates]);
  // 日別データ＋この日までの差枚推移（7/10/20/30日間）
  const viewDateList = useMemo(() => (effViewDate ? allMachines.map((m) => ({ m, r: recOf(m.key, effViewDate) })).filter((x) => x.r) : EMPTY), [allMachines, recOf, effViewDate]);
  const viewWindowDates = useMemo(() => pageDates.filter((d) => d <= effViewDate).slice(-viewWindow), [pageDates, effViewDate, viewWindow]);
  const viewWindowSeries = useMemo(() => viewDateList.map(({ m }) => {
    const { series, total } = cumSeries(m.key, viewWindowDates);
    const zero = viewWindowDates.length ? [{ date: addDays(viewWindowDates[0], -1), value: 0 }] : [];
    return { key: m.key, m, total, series: [...zero, ...series] };
  }), [viewDateList, viewWindowDates, cumSeries]);
  // 〇のつく日 平均差枚（全期間）
  const luckyDay = useMemo(() => {
    if (luckyDigit === null) return null;
    const ds = pageDates.filter((d) => parseInt(d.slice(8, 10), 10) % 10 === luckyDigit);
    if (!ds.length) return { stats: [], dayCount: 0, avgTotal: null };
    const stats = allMachines.map((m) => {
      let sum = 0, n = 0;
      ds.forEach((d) => { const r = recOf(m.key, d); if (r && r.s !== null) { sum += r.s; n += 1; } });
      return n ? { key: m.key, m, avg: sum / n, count: n } : null;
    }).filter(Boolean).sort((a, b) => b.avg - a.avg);
    const totals = ds.map((d) => allMachines.reduce((a, m) => { const r = recOf(m.key, d); return a + (r && r.s !== null ? r.s : 0); }, 0));
    return { stats, dayCount: ds.length, avgTotal: totals.reduce((a, b) => a + b, 0) / totals.length };
  }, [luckyDigit, pageDates, allMachines, recOf]);
  // 台同士の相関
  const machineCorrelations = useMemo(() => {
    if (viewMode !== "page") return EMPTY;
    const maps = pageMachines.map((m) => ({ m, map: recIndex.get(m.key) }));
    const out = [];
    for (let i = 0; i < maps.length; i++) for (let j = i + 1; j < maps.length; j++) {
      const A = maps[i], B = maps[j];
      const xs = [], ys = [];
      A.map.forEach((ra, d) => { const rb = B.map.get(d); if (rb && ra.s !== null && rb.s !== null) { xs.push(ra.s); ys.push(rb.s); } });
      if (xs.length < 10) continue;
      const r = pearsonCorrelation(xs, ys);
      if (r !== null && Math.abs(r) >= 0.4) out.push({ a: A.m, b: B.m, r, n: xs.length });
    }
    return out.sort((x, y) => Math.abs(y.r) - Math.abs(x.r)).slice(0, 60);
  }, [viewMode, pageMachines, recIndex]);
  // 総差枚しきい値分析
  const thresholdAnalyses = useMemo(() => selected.map((k) => {
    const m = machineByKey.get(k);
    if (!m) return null;
    const series = m.recs.filter((r) => r.s !== null).map((r) => ({ date: r.date, sada: r.s }));
    const baseRate = computeBaseRate(series);
    const pairs = buildTrailingPairs(series, analysisWindow);
    const d2 = pairs.filter((p) => parseInt(p.nextDate.slice(8, 10), 10) % 10 === 2);
    const d7 = pairs.filter((p) => parseInt(p.nextDate.slice(8, 10), 10) % 10 === 7);
    return { key: k, m, baseRate, validDays: series.length, overall: findBestThresholds(pairs, 5, baseRate), digit2: findBestThresholds(d2, 3, baseRate), digit7: findBestThresholds(d7, 3, baseRate), nAll: pairs.length, n2: d2.length, n7: d7.length };
  }).filter(Boolean), [selected, machineByKey, analysisWindow]);

  // このページのデータ（日付単位の削除・全削除）。アナスロ保存データから、このページの機種の行だけを消す。
  async function rewriteRawDays(updates) {
    const next = { ...rawRef.current };
    Object.entries(updates).forEach(([d, v]) => { if (v) next[d] = v; else delete next[d]; });
    rawRef.current = next;
    const weeks = Array.from(new Set(Object.keys(updates).map(weekStartOf)));
    for (const w of weeks) {
      const bucket = {};
      Object.keys(next).forEach((d) => { if (weekStartOf(d) === w) bucket[d] = next[d]; });
      if (Object.keys(bucket).length) await storage.set(RAW_PREFIX + w, JSON.stringify(bucket));
      else await storage.delete(RAW_PREFIX + w);
    }
    await storage.set(RAW_INDEX, JSON.stringify(Object.keys(next).sort()));
    setRaw(next);
  }
  function withoutPageRows(date) {
    const rows = unpackDay(rawRef.current[date]);
    const rest = rows.filter((r) => !pageNameKeys.has(resolve(effectiveModelName(r, noModel))));
    return { removed: rows.length - rest.length, packed: rest.length ? packDay(rest) : null };
  }
  async function deletePageDate(date) {
    const prev = rawRef.current[date];
    const { removed, packed } = withoutPageRows(date);
    try {
      await rewriteRawDays({ [date]: packed });
      pushUndo({ label: `${currentPage.name || "ページ"} ${date} の${removed}台分を削除`, kind: "raw", date, prev });
      setPageStatus({ type: "ok", msg: `${date} のこのページのデータ（${removed}台）を削除しました。` });
    } catch (e) { setPageStatus({ type: "error", msg: `削除に失敗しました：${errMsg(e)}` }); }
    setConfirmDeleteDate(null);
  }
  async function resetPageData() {
    const updates = {};
    pageDates.forEach((d) => { updates[d] = withoutPageRows(d).packed; });
    try {
      await rewriteRawDays(updates);
      setPageStatus({ type: "ok", msg: `このページのデータ（${pageDates.length}日分）を削除しました。` });
    } catch (e) { setPageStatus({ type: "error", msg: `削除に失敗しました：${errMsg(e)}` }); }
    setConfirmReset(false);
  }

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
  const [ovrGridEventFilter, setOvrGridEventFilter] = useState([]);
  const ovrGridDates = useMemo(() => {
    if (!ovrGridEventFilter.length) return [...ovrDates].slice(-30).reverse();
    return ovrDates.filter((d) => {
      const names = eventsOn(d);
      if (!names.length) return ovrGridEventFilter.includes(NO_EVENT_LABEL);
      return names.some((n) => ovrGridEventFilter.includes(n));
    }).reverse();
  }, [ovrDates, ovrGridEventFilter, eventsOn]);
  // ---- 今日の見通し（v0.4.0）----
  const [outlookDate, setOutlookDate] = useState("");
  const defaultOutlookDate = useMemo(() => (ovrDates.length ? nextOpenDate(ovrDates[ovrDates.length - 1], closedSet, noDataSet) : todayStr()), [ovrDates, closedSet, noDataSet]);
  const effOutlookDate = outlookDate || defaultOutlookDate;
  const [outlookAll, setOutlookAll] = useState(false);
  const outlook = useMemo(() => {
    if (viewMode !== "overall" || !effOutlookDate) return null;
    try { return buildOutlook({ ovr, target: effOutlookDate, eventsOn, isTargetOn, resolve, weekPlay, weekRecMap }); } catch (e) { return null; }
  }, [viewMode, ovr, effOutlookDate, eventsOn, isTargetOn, resolve, weekPlay, weekRecMap]);
  // ---- イベントを選んで過去を見る（v0.2.2）----
  const [evHist, setEvHist] = useState("");
  const allEventNames = useMemo(() => {
    const set = new Set(kv[KEYS.eventNames]);
    Object.values(dateEvent).forEach((c) => splitNames(c).forEach((n) => set.add(n)));
    return [...set].sort((a, b) => a.localeCompare(b, "ja"));
  }, [kv, dateEvent]);
  const evHistory = useMemo(() => {
    if (!evHist || viewMode !== "overall") return null;
    const match = (d) => (evHist === NO_EVENT_LABEL ? !eventsOn(d).length : eventsOn(d).includes(evHist));
    const dates = ovrDates.filter(match).reverse();
    const totals = dailyTotals.filter((t) => match(t.date));
    const stat = {};
    dates.forEach((d) => ovr[d].modelRows.forEach((r) => {
      const k = resolve(r.name);
      const st = stat[k] || (stat[k] = { key: k, n: 0, sum: 0, sumN: 0, marks: 0, target: 0, targetMarks: 0 });
      st.n += 1;
      if (r.avgSada !== null) { st.sum += r.avgSada; st.sumN += 1; }
      const mk = classifyMinRepoMark(r);
      if (mk) st.marks += 1;
      if (isTargetOn(d, k)) { st.target += 1; if (mk) st.targetMarks += 1; }
    }));
    const models = Object.values(stat).map((x) => ({ ...x, avg: x.sumN ? x.sum / x.sumN : null, markRate: x.marks / x.n }))
      .sort((a, b) => b.markRate - a.markRate || (b.avg ?? -1e9) - (a.avg ?? -1e9));
    const dig = {};
    dates.forEach((d) => ovr[d].digitRows.forEach((r) => {
      const x = dig[r.name] || (dig[r.name] = { name: r.name, sum: 0, n: 0, hidden: 0, wins: 0, total: 0 });
      if (r.avgSada !== null) { x.sum += r.avgSada; x.n += 1; } else if (r.hiddenNegative) x.hidden += 1;
      if (r.total) { x.wins += r.wins; x.total += r.total; }
    }));
    const avgTotal = totals.filter((t) => t.total !== null);
    return {
      dates, totals, models, digits: Object.values(dig),
      avgTotal: avgTotal.length ? avgTotal.reduce((a, t) => a + t.total, 0) / avgTotal.length : null,
      avgPer: avgTotal.length ? avgTotal.reduce((a, t) => a + t.avg, 0) / avgTotal.length : null,
    };
  }, [evHist, viewMode, ovrDates, ovr, dailyTotals, eventsOn, resolve, isTargetOn]);
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
    const closedSk = [], noDataSk = [];
    for (let x = addDays(engine.pick.lastDate, 1); x < t; x = addDays(x, 1)) (closedSet.has(x) ? closedSk : noDataSk).push(md(x));
    return `${md(t)}のピックアップ（実測パターン方式）${closedSk.length ? `　※${closedSk.join("・")}は店休日` : ""}${noDataSk.length ? `　※${noDataSk.join("・")}は台ごとのデータなし（${md(engine.pick.lastDate)}の結果で予想）` : ""}`;
  })() : "ピックアップ（実測パターン方式）";

  // ---- 機種ページの部品（プラザ2と同じ見た目）----
  // イベントの複数選択（機種ページのマトリクス表と全体データのマトリクスで共通）
  const renderEventMultiSelect = (selectedList = gridEventFilter, setList = setGridEventFilter) => (
    <div className="scrollbar" style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, padding: 8, background: "#12161d", border: "1px solid #2a323f", borderRadius: 6 }}>
      {[NO_EVENT_LABEL, ...allEventNames].map((n) => {
        const active = selectedList.includes(n);
        const noEv = n === NO_EVENT_LABEL;
        return (
          <button key={n} onClick={() => setList((l) => (l.includes(n) ? l.filter((x) => x !== n) : [...l, n]))} style={{
            fontSize: 11, padding: "4px 9px", borderRadius: 999, cursor: "pointer",
            border: active ? `1px solid ${noEv ? "#8b93a3" : "#7aa2f7"}` : noEv ? "1px dashed #3a4353" : "1px solid #2a323f",
            background: active ? (noEv ? "rgba(139,147,163,0.15)" : "rgba(122,162,247,0.15)") : "transparent",
            color: active ? (noEv ? "#c7cbd4" : "#7aa2f7") : "#8b93a3",
          }}>{n}</button>
        );
      })}
    </div>
  );
  const gridHeadCell = (d) => {
    const c = goodCountByDate[d];
    const rate = c && c.n ? c.good / c.n : null;
    return (
      <th key={d} className="mono" title={c ? `☆〇 ${c.good}台／判定できた台 ${c.n}台` : ""} style={{ background: "#12161d", padding: "4px 3px", borderBottom: "1px solid #2a323f", fontSize: 9, whiteSpace: "nowrap", fontWeight: 600, color: isStrong(d) ? "#e5484d" : isSemi(d) ? "#9ece6a" : eventsOn(d).length ? "#f2d24b" : "#5a6272" }}>
        {d.slice(5)}
        {c && <div style={{ fontSize: 8, fontWeight: 400, marginTop: 1, color: rate >= 0.5 ? "#e5697a" : rate >= 0.3 ? "#f2d24b" : "#5a6272" }}>☆〇{c.good}/{c.n}</div>}
      </th>
    );
  };
  const rowHeadStyle = { position: "sticky", left: 0, zIndex: 1, background: "#12161d", color: "#c7cbd4", padding: "4px 8px", borderBottom: "1px solid #1c2129", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 112, boxSizing: "border-box" };
  const renderSymbolGrid = (dates, list) => (!list.length || !dates.length ? <div style={{ fontSize: 12, color: "#5a6272" }}>表示できるデータがまだありません。</div> : (
    <div className="scrollbar" style={{ overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch", overscrollBehaviorX: "contain" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
        <thead><tr><th style={{ ...rowHeadStyle, zIndex: 2, borderBottom: "1px solid #2a323f" }} />{dates.map(gridHeadCell)}</tr></thead>
        <tbody>{list.map((m) => (
          <tr key={m.key}>
            <td title={machineLabel(m)} style={rowHeadStyle}>{machineLabel(m)}</td>
            {dates.map((d) => { const r = recAt(m, d); return (
              <td key={d} className="mono" title={r ? `G${fmt(r.g)} 差枚${fmtSigned(r.s)} BB${r.bb ?? "-"} RB${r.rb ?? "-"}${r.src === "m" ? "（代用）" : ""}` : ""} style={{ padding: "4px 3px", borderBottom: "1px solid #1c2129", textAlign: "center", color: r ? SYMBOL_COLORS[r.sym] : "#2a323f", fontWeight: 700, textDecoration: r && r.src === "m" ? "underline dotted" : undefined, background: isTargetOn(d, m.modelKey) ? "rgba(232,179,76,0.13)" : undefined }}>{r ? r.sym : "・"}</td>
            ); })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  ));
  const renderExpGrid = (dates, list) => (!list.length || !dates.length ? <div style={{ fontSize: 12, color: "#5a6272" }}>表示できるデータがまだありません。</div> : (
    <div className="scrollbar" style={{ overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch", overscrollBehaviorX: "contain" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
        <thead><tr><th style={{ ...rowHeadStyle, zIndex: 2, borderBottom: "1px solid #2a323f" }} />{dates.map(gridHeadCell)}</tr></thead>
        <tbody>{list.map((m) => (
          <tr key={m.key}>
            <td title={machineLabel(m)} style={rowHeadStyle}>{machineLabel(m)}</td>
            {dates.map((d) => {
              const r = recAt(m, d);
              const e = r && r.exp;
              if (!e) return <td key={d} style={{ padding: "4px 3px", borderBottom: "1px solid #1c2129", textAlign: "center", color: "#2a323f" }}>・</td>;
              const v = Math.round(e.score * 100);
              return (
                <td key={d} className="mono" title={`期待度${v}　生の読み取り${Math.round(e.raw * 100)}　信頼度${e.confidence.toFixed(2)}　G${fmt(r.g)}`} style={{ padding: "4px 3px", borderBottom: "1px solid #1c2129", textAlign: "center", color: fiveBandColor(v), background: isTargetOn(d, m.modelKey) ? "rgba(232,179,76,0.13)" : undefined }}>
                  <span style={{ display: "inline-flex", alignItems: "baseline", gap: 1 }}>{e.lowGsuFlag && <span style={{ fontSize: 8 }}>▼</span>}<span>{v}</span><sub style={{ fontSize: 8, color: "#5a6272" }}>{Math.round(e.raw * 100)}</sub></span>
                </td>
              );
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  ));
  const chipBtn = (active) => ({ fontSize: 12, padding: "6px 10px", borderRadius: 6, cursor: "pointer", border: `1px solid ${active ? "#4fd1c5" : "#2a323f"}`, background: active ? "rgba(79,209,197,0.12)" : "transparent", color: active ? "#4fd1c5" : "#c7cbd4" });
  const MiniChart = ({ title, series, total, height, axis, marks }) => (
    <div style={{ background: "#0e1218", border: "1px solid #232b37", borderRadius: 10, overflow: "hidden", minWidth: 0 }}>
      <div className="mono" style={{ background: "#e7e9ee", color: "#12161d", fontWeight: 700, fontSize: 12, textAlign: "center", padding: "3px 4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>[{title}]</div>
      <div style={{ position: "relative", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#232b37" strokeDasharray="2 3" />
            <YAxis hide={!axis} width={axis ? 36 : 0} tick={{ fontSize: 9, fill: "#4a5262" }} axisLine={false} tickLine={false} />
            <XAxis dataKey="date" hide />
            <Tooltip contentStyle={{ background: "#1b212b", border: "1px solid #2a323f", borderRadius: 6, fontSize: 11 }} />
            {marks && marks.closed.map((d) => { const band = getBandRange(series.map((x) => x.date), d); return band ? <ReferenceArea key={`c${d}`} x1={band.x1} x2={band.x2} fill="#5a6272" fillOpacity={0.28} stroke="none" /> : null; })}
            {marks && marks.d2.map((d) => <ReferenceLine key={`2${d}`} x={d} stroke={DIGIT2_COLOR} strokeDasharray="2 2" strokeOpacity={0.5} />)}
            {marks && marks.d7.map((d) => <ReferenceLine key={`7${d}`} x={d} stroke={DIGIT7_COLOR} strokeDasharray="2 2" strokeOpacity={0.5} />)}
            {marks && marks.strong.map((x) => <ReferenceLine key={`s${x.date}`} x={x.date} stroke="#e5484d" strokeDasharray="4 2" strokeWidth={1.5} />)}
            <Line type="monotone" dataKey="value" stroke="#3ecf8e" strokeWidth={1.75} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="mono" style={{ position: "absolute", right: 6, bottom: 4, fontSize: axis ? 16 : 13, fontWeight: 800, color: "#f2d24b", textShadow: "0 0 8px rgba(242,210,75,0.35)" }}>{total === null ? "―" : `${total >= 0 ? "+" : ""}${Math.round(total).toLocaleString()}枚`}</div>
      </div>
    </div>
  );
  const renderThresholdResult = (result, label, pairsCount, minSample) => {
    if (!result) return <div style={{ fontSize: 11, color: "#5a6272", marginBottom: 6 }}>{label}：十分なデータがありません（有効な組み合わせ {pairsCount}件、最低{minSample}件必要）</div>;
    const line = (b, dir) => (b ? (
      <div style={{ fontSize: 12, color: "#c7cbd4" }}>
        総差枚が <span className="mono" style={{ color: "#e8b34c" }}>{fmtSigned(b.threshold)}枚</span> {dir} → 翌日プラス率 <span style={{ color: "#9ece6a", fontWeight: 700 }}>{Math.round(b.winRate * 100)}%</span>（{b.sampleSize}件中、平均{fmtSigned(b.avgNext)}枚）
      </div>
    ) : <div style={{ fontSize: 11, color: "#5a6272" }}>{dir}パターン：この台の基準勝率を上回るしきい値は見つかりませんでした</div>);
    return <div style={{ marginBottom: 8 }}><div style={{ fontSize: 11, color: "#8b93a3", marginBottom: 2 }}>{label}</div>{line(result.bestAbove, "以上")}{line(result.bestBelow, "以下")}</div>;
  };

  return (
    <div style={{ fontFamily: "'Inter','Hiragino Sans',sans-serif", background: "#12161d", color: "#e7e9ee", minHeight: "100%", padding: "20px max(12px, env(safe-area-inset-right)) 90px max(12px, env(safe-area-inset-left))", boxSizing: "border-box", overflowX: "hidden", maxWidth: "100vw" }}>
      <style>{`
        .mono { font-family: 'JetBrains Mono','Menlo',monospace; font-variant-numeric: tabular-nums; }
        input[type="date"] { color-scheme: dark; }
        .scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .scrollbar::-webkit-scrollbar-thumb { background: #333c4a; border-radius: 3px; }
        .tab { cursor: pointer; border: 1px solid #2a323f; border-radius: 8px 8px 0 0; padding: 8px 12px; font-size: 12px; font-weight: 700; background: #1b212b; color: #8b93a3; }
        .tab.active { background: #12161d; color: #e8b34c; border-bottom: 1px solid #12161d; }
        .grid2 { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 14px; }
        .tracker-grid { display: grid; grid-template-columns: minmax(0,380px) minmax(0,1fr); gap: 14px; align-items: start; }
        .mini-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
        .mini-grid.wide { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
        table td, table th { box-sizing: border-box; }
        @media (max-width: 860px) {
          .grid2, .tracker-grid { grid-template-columns: minmax(0,1fr); }
        }
        @media (max-width: 520px) {
          .mini-grid, .mini-grid.wide { grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px; }
          .tab { padding: 8px 10px; font-size: 12px; }
        }
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
              {(suspiciousAliases.length > 0 || suspiciousNoMaps.length > 0) && (
                <div style={{ ...S.card, borderColor: "#7a3038", background: "#24161a" }}>
                  <div style={{ ...S.h, color: "#e5697a" }}>⚠ 間違っている可能性が高い機種名の対応があります</div>
                  <div style={{ fontSize: 12, color: "#c7cbd4", lineHeight: 1.6, marginBottom: 8 }}>
                    名前が似ていない機種どうしや、登録した日のアナスロで確認できない台番号が「同じ機種」として登録されています。台移動の日や、欠けた台を個別台で埋めた日に、以前の版が別の日の配置を見て自動で登録してしまったものです。このままだと別の機種のデータが混ざります。
                    {suspiciousAliases.map((k) => <div key={k} className="mono" style={{ color: "#e8b34c" }}>・{k} → {aliases[k]}</div>)}
                    {suspiciousNoMaps.map((no) => <div key={no} className="mono" style={{ color: "#e8b34c" }}>・台番号{no}：{noModel[no].anasloName} → {noModel[no].model}</div>)}
                  </div>
                  <button onClick={removeSuspicious} style={S.btn("#e5697a")}>これらをまとめて削除する</button>
                  <div style={{ fontSize: 11, color: "#8b93a3", marginTop: 6 }}>削除しても右下の「操作履歴」から元に戻せます。</div>
                </div>
              )}
              <div style={S.card}>
                <div style={S.h}>① 民レポ（機種別サマリー＋バラエティ＋末尾別データ）</div>
                <div style={S.note}>民レポの表を上から下までそのまま貼り付けてください。同じ日のアナスロがあれば、機種名と台数を自動で照合します。</div>
                <input type="date" value={ovrDate} onChange={(e) => loadOvrDate(e.target.value)} style={{ ...S.input, marginBottom: 8 }} />
                {closedNotice(ovrDate) || <div style={{ fontSize: 11, color: ovr[ovrDate] ? "#9ece6a" : "#5a6272", marginBottom: 8 }}>{ovr[ovrDate] ? "この日は登録済み（保存すると上書き）" : "この日はまだ未登録です"}</div>}
                {eventsOn(ovrDate).length > 0 && <div style={{ fontSize: 12, color: "#e8b34c", marginBottom: 8 }}><Flag size={11} style={{ verticalAlign: -1 }} /> この日のイベント：{eventsOn(ovrDate).join("、")}</div>}
                <textarea className="scrollbar" rows={8} disabled={closedSet.has(ovrDate)} value={ovrText} onChange={(e) => setOvrText(e.target.value)} placeholder={"機種\t平均差枚\t平均G数\t勝率\t出率\n…"} style={{ ...S.textarea, ...lockedArea(ovrDate) }} />
                <button disabled={busy || closedSet.has(ovrDate)} onClick={handleSaveOverall} style={{ ...S.btn("#e8b34c", "#1b1508"), width: "100%", opacity: busy ? 0.6 : 1, ...lockedArea(ovrDate) }}>{busy ? "保存中..." : "この日の民レポを保存"}</button>
                <Status s={ovrStatus} />
              </div>

              <div style={S.card}>
                <div style={S.h}>② アナスロ（全台の一覧表）</div>
                <div style={S.note}>アナスロの表をそのまま貼り付けてください（後ろの空白列・空行・「平均」行は自動で無視します）。正式名称が一致するページに自動で反映されます。</div>
                <input type="date" value={anaDate} onChange={(e) => loadAnaDate(e.target.value)} style={{ ...S.input, marginBottom: 8 }} />
                <div style={{ fontSize: 11, color: raw[anaDate] ? "#9ece6a" : "#5a6272", marginBottom: 8 }}>{raw[anaDate] ? `この日は登録済み（${unpackDay(raw[anaDate]).length}台）` : "この日はまだ未登録です"}</div>
                {closedNotice(anaDate)}
                <textarea className="scrollbar" rows={8} disabled={closedSet.has(anaDate)} value={anaText} onChange={(e) => setAnaText(e.target.value)} placeholder={"機種名\t台番号\tG数\t差枚\tBB\tRB\t合成確率\tBB確率\tRB確率\n…"} style={{ ...S.textarea, ...lockedArea(anaDate) }} />
                <button disabled={busy || closedSet.has(anaDate)} onClick={() => handleSaveAnaslo(false)} style={{ ...S.btn("#4fd1c5", "#0b1f1c"), width: "100%", opacity: busy ? 0.6 : 1, ...lockedArea(anaDate) }}>{busy ? "保存中..." : "この日のアナスロを保存"}</button>
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
                {(() => { const pr = parseMinRepoIndividual(kbText); if (!pr.model) return null; const singles = pr.rows.filter((r) => r.m); return <div style={{ fontSize: 11, color: "#9ece6a", marginBottom: 8 }}>{singles.length ? `読み取った台：${singles.map((r) => `${r.no}番 ${r.m}（差枚${fmtSigned(r.s)}・G${fmt(r.g)}・BB${r.bb ?? "-"}・RB${r.rb ?? "-"}）`).join("、")}` : `読み取った機種名：${pr.model}（${pr.rows.length}台）`}</div>; })()}
                {closedNotice(kbDate)}
                <textarea className="scrollbar" rows={6} disabled={closedSet.has(kbDate)} value={kbText} onChange={(e) => setKbText(e.target.value)} placeholder={"○○ データ一覧\n台番\t差枚\tG数\t出率\tBB\tRB\t合成\tBB率\tRB率\n…"} style={{ ...S.textarea, ...lockedArea(kbDate) }} />
                <button disabled={busy || closedSet.has(kbDate)} onClick={handleSaveIndividual} style={{ ...S.btn("#bb9af7"), width: "100%", opacity: busy ? 0.6 : 1, ...lockedArea(kbDate) }}>{busy ? "保存中..." : "個別台データを保存"}</button>
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
                        {recResult.countMismatch.map((x, i) => (
                          <div key={`${x.key}-${i}`} style={{ ...S.row, color: "#e8b34c", display: "block" }}>
                            台数が違う：「{x.name}」民レポ{x.mCount}台 / アナスロ{x.aCount}台
                            {x.comboWith ? <div style={{ color: "#9ece6a", marginTop: 2 }}>→ 民レポの「{x.comboWith.name}」（{x.comboWith.count}台）と合わせると一致します。アナスロが2機種を1つの名前でまとめています。「{x.comboWith.name}」の個別台データ（③）を一度貼ると台番号で分けられます。</div>
                              : <div style={{ color: "#8b93a3", marginTop: 2 }}>→ アナスロの台番号：<span className="mono">{x.nos.join(", ")}</span>{x.idle.length > 0 && `（稼働なし：${x.idle.join(", ")}）`}。下の履歴で、いつから合わなくなったか（台番号の増減）を確認できます。</div>}
                          </div>
                        ))}
                        {recResult.varietyConflicts.length > 0 && (
                          <div style={{ color: "#8b93a3" }}>同じ台番号で機種名が違う台（自動では同じ機種にしていません）：
                            {recResult.varietyConflicts.map((v) => <div key={v.no} className="mono" style={{ fontSize: 11 }}>・{v.no}番：民レポ「{v.minrepoName}」／アナスロ「{v.anasloName}」{v.sameData ? "（数字は一致）" : "（数字も違う＝台移動の反映日のずれか日付の取り違え）"}</div>)}
                          </div>
                        )}
                        {recResult.minrepoOnly.length > 0 && <div style={{ color: "#e5697a" }}>アナスロに見つからない：{recResult.minrepoOnly.map((r) => r.name + (r.no ? `(${r.no})` : "")).join("、")}</div>}
                        {recResult.anasloOnly.length > 0 && <div style={{ color: "#e5697a" }}>民レポに見つからない：{recResult.anasloOnly.map((g) => `${g.name}(${g.count}台)`).join("、")}</div>}
                      </div>
                    )}
                  </>
                )}
                {countHistory && countHistory.length > 0 && (
                  <Collapse title={`📅 台数が合わない日の履歴（全期間・${countHistory.length}機種）`} defaultOpen>
                    <div style={S.note}>機種ごとに、民レポとアナスロで台数が合わなかった期間をまとめています。期間の切れ目で台番号が増えた・減った時は「＋／−」で表示します（新台入れ替えや台移動のタイミングの目安）。</div>
                    <div className="scrollbar" style={{ maxHeight: 460, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                      {countHistory.map((h) => (
                        <div key={h.key} style={{ background: "#12161d", border: "1px solid #3a3320", borderRadius: 6, padding: "8px 10px", fontSize: 12 }}>
                          <div style={{ fontWeight: 700, color: "#e8b34c" }}>{h.name}</div>
                          <div className="mono" style={{ color: "#8b93a3", fontSize: 11, marginTop: 2 }}>合わない日：{h.badDays}日（最初 {md(h.first)}・最後 {md(h.last)}）</div>
                          {h.comboWith && <div style={{ color: "#9ece6a", fontSize: 11, marginTop: 2 }}>→ 民レポの「{h.comboWith.name}」（{h.comboWith.count}台）と合わせると一致。その個別台データ（③）を一度貼ると解決します。</div>}
                          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                            {h.runs.map((r, i) => (
                              <div key={i} className="mono" style={{ fontSize: 11, color: r.ok ? "#5a6272" : "#c7cbd4", lineHeight: 1.5 }}>
                                {md(r.from)}{r.to !== r.from ? `〜${md(r.to)}` : ""}（{r.n}日）
                                {r.ok ? "　一致" : <>　民レポ{r.mCount}台／アナスロ<b style={{ color: "#e8b34c" }}>{r.aCount}台</b></>}
                                {!r.ok && (r.added.length > 0 || r.removed.length > 0) && (
                                  <span style={{ color: "#7aa2f7" }}>　台番号{r.added.length > 0 ? ` ＋${r.added.join(",")}` : ""}{r.removed.length > 0 ? ` −${r.removed.join(",")}` : ""}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Collapse>
                )}
                {countHistory && countHistory.length === 0 && bothDates.length > 0 && <div style={{ fontSize: 12, color: "#9ece6a", margin: "6px 0" }}>全期間で、民レポとアナスロの台数はすべて合っています。</div>}
                <Collapse title={`登録済みの別名（${Object.keys(aliases).length}）・台番号の対応（${Object.keys(noModel).length}）・G数の種類（${Object.keys(gtypes).length}）`}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                    {Object.entries(aliases).map(([k, v]) => (
                      <div key={k} style={S.row}><span style={{ color: !namesSimilar(k, v) ? "#e5697a" : undefined }}>{!namesSimilar(k, v) && "⚠ "}別名：{k} → {v}</span><button style={S.ghost} onClick={async () => { const prev = kvRef.current[KEYS.aliases]; const r = await commitKV(KEYS.aliases, (p) => { const n = { ...p }; delete n[k]; return n; }); if (r.ok) pushUndo({ label: `別名「${k}」を削除`, kind: "kv", key: KEYS.aliases, prev }); }}><Trash2 size={11} /></button></div>
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

              <div style={{ ...S.card, borderColor: driftProblems.some(([, c]) => c.level === "bad") ? "#7a3038" : "#2a323f" }}>
                <div style={S.h}>⑤ 民レポとアナスロのずれチェック</div>
                <div style={S.note}>同じ日の民レポとアナスロを、機種ごと（バラエティは台番号ごと）の平均差枚で突き合わせます。同じ日のデータなら1台あたりのずれは数十枚以内です。ずれが大きい日は、どちらかの日付を間違えて貼った可能性があります。前後7日の民レポとも比べて、ぴったり合う日があれば表示します。</div>
                {!driftChecks || !bothDates.length ? <div style={{ fontSize: 12, color: "#5a6272" }}>民レポとアナスロが両方そろった日がまだありません。</div> : (
                  <>
                    <div style={{ fontSize: 12, marginBottom: 8, color: driftProblems.length ? "#e8b34c" : "#9ece6a" }}>
                      {Object.keys(driftChecks).length}日分チェック：{driftProblems.length ? `ずれている日が${driftProblems.length}日あります` : "すべて一致しています"}
                      {onlyOneSide.length > 0 && <span style={{ color: "#8b93a3" }}>　（片方しか入っていない日：{onlyOneSide.length}日）</span>}
                    </div>
                    <div className="scrollbar" style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                      {driftProblems.map(([d, c]) => (
                        <div key={d} style={{ background: "#12161d", border: `1px solid ${c.level === "bad" ? "#7a3038" : "#5a4a20"}`, borderRadius: 6, padding: "8px 10px", fontSize: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span><span style={{ color: c.level === "bad" ? "#e5697a" : "#e8b34c", fontWeight: 700 }}>{c.level === "bad" ? "⚠ 大きくずれ" : "△ 少しずれ"}</span>　<span className="mono">{d}（{WD[weekdayOf(d)]}）</span></span>
                            <button style={S.ghost} onClick={() => { loadOvrDate(d); loadAnaDate(d); window.scrollTo({ top: 0, behavior: "smooth" }); }}>入力欄に読み込む</button>
                          </div>
                          <div className="mono" style={{ color: "#8b93a3", marginTop: 4, lineHeight: 1.6 }}>
                            1台あたり平均 <b style={{ color: c.level === "bad" ? "#e5697a" : "#e8b34c" }}>{Math.round(c.err).toLocaleString()}枚</b> のずれ<br />
                            総差枚 民レポ {fmtSigned(c.mTotal)}{c.hidden > 0 ? "（マイナス非表示あり）" : ""} ／ アナスロ {fmtSigned(c.aTotal)}（差 {fmtSigned(c.diff)}）<br />
                            台数 民レポ {c.mCount}台 ／ アナスロ {c.aCount}台
                          </div>
                          {c.better && <div style={{ marginTop: 4, color: "#9ece6a" }}>→ このアナスロは <b className="mono">{c.better.date}</b> の民レポとぴったり合います（1台あたり{Math.round(c.better.err)}枚）。アナスロの日付を間違えて貼った可能性が高いです。</div>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <Collapse title={`登録済みの日付（${new Set([...ovrDates, ...rawDates]).size}日${noDataSet.size ? `・データなし${noDataSet.size}日` : ""}）`} defaultOpen>
                <div className="scrollbar" style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                  {Array.from(new Set([...ovrDates, ...rawDates, ...noDataSet])).sort().reverse().map((d) => {
                    if (noDataSet.has(d) && !ovr[d] && !raw[d]) return <div key={d} style={{ ...S.row, color: "#e5697a" }}><span className="mono">{d}　📭 データなし</span></div>;
                    const ndBadge = noDataSet.has(d) ? <span style={{ marginLeft: 6, color: "#e5697a" }}>📭台ごとのデータなし</span> : null;
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
                          {(() => { const miss = rows.some(isBlankRow) ? classifyBlankRows(rows.map((x) => ({ ...x, em: effectiveModelName(x, noModel) })), ovr[d], resolve).filter((x) => x.missing).length : 0; return miss ? <span style={{ marginLeft: 6, color: "#e8b34c" }}>アナスロ欠け{miss}台</span> : null; })()}
                          {(() => { const ng = rows.filter(isNoGRow).length; return ng ? <span style={{ marginLeft: 6, color: "#e8b34c" }}>G数なし{ng}台</span> : null; })()}
                          {ndBadge}
                          {driftChecks && driftChecks[d] && (driftChecks[d].level === "bad" || driftChecks[d].level === "warn") && <span style={{ marginLeft: 6, color: driftChecks[d].level === "bad" ? "#e5697a" : "#e8b34c", fontWeight: 700 }}>⚠ずれ</span>}
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
                  <ModelChips options={modelOptions} resolve={resolve} names={evTargets} onAdd={(n) => setEvTargets((l) => addUniqueName(l, n))} onRemove={(n) => setEvTargets((l) => l.filter((x) => x !== n))} />
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
                            <ModelChips options={modelOptions} resolve={resolve} names={(dateEventTargets[d] || {})[editTarget.name] || []} onAdd={(n) => setDateTargets(d, editTarget.name, (l) => addUniqueName(l, n))} onRemove={(n) => setDateTargets(d, editTarget.name, (l) => l.filter((x) => x !== n))} />
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
                  <div style={{ ...S.h, marginTop: 14 }}>📭 データなしの日</div>
                  <div style={{ ...S.note, marginBottom: 6 }}>お店は営業していたのに、民レポ・アナスロのデータが取れない日（サイトの障害など）。店休日とは違い、この日をまたいで「前日→翌日」をつなげないので、予想が間違って学習されません。連続した日は「〜」で期間をまとめて登録できます。あとからデータを保存すると、印は自動で外れます。</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input type="date" value={noDataFrom} onChange={(e) => setNoDataFrom(e.target.value)} style={{ ...S.input, flex: "1 1 120px" }} />
                    <span style={{ fontSize: 11, color: "#5a6272" }}>〜</span>
                    <input type="date" value={noDataTo} onChange={(e) => setNoDataTo(e.target.value)} style={{ ...S.input, flex: "1 1 120px" }} />
                    <button onClick={addNoData} style={S.btn("#7a3038", "#e7e9ee")}>登録</button>
                  </div>
                  <Status s={noDataStatus} />
                  {[...(kv[KEYS.noData] || [])].sort((a, b) => b.date.localeCompare(a.date)).map((c) => <div key={c.date} style={{ ...S.row, marginBottom: 4, marginTop: 4 }}><span className="mono">{c.date}　<span style={{ color: "#e5697a" }}>データなし</span></span><button style={S.ghost} onClick={() => removeNoData(c.date)}><Trash2 size={11} /></button></div>)}
                </div>
              </div>

              <div style={S.card}>
                <div style={S.h}>🎯 いつも同じ対象機種のイベント</div>
                <div style={S.note}>「このイベントはこの機種」と決まっているイベントは、ここでイベント名に対象機種を1回登録すれば、そのイベントの日は毎回自動で対象になります。毎回違う機種のイベント（3×3など）は、📅イベント登録の方で日付ごとに入れてください。</div>
                <input list="event-names" value={fixedEvName} onChange={(e) => setFixedEvName(e.target.value)} placeholder="イベント名を入力（または選択）" style={{ ...S.input, width: "100%", marginBottom: 8 }} />
                {fixedEvName.trim() && (
                  <div style={{ marginBottom: 10 }}>
                    <ModelChips options={modelOptions} resolve={resolve} names={eventTargets[fixedEvName.trim()] || []} onAdd={(n) => setFixedTargets(fixedEvName.trim(), (l) => addUniqueName(l, n))} onRemove={(n) => setFixedTargets(fixedEvName.trim(), (l) => l.filter((x) => x !== n))} />
                  </div>
                )}
                {Object.keys(eventTargets).sort().map((E) => (
                  <div key={E} style={{ ...S.row, marginBottom: 4, cursor: "pointer" }} onClick={() => setFixedEvName(E)}>
                    <span><b>{E}</b>　<span style={{ color: "#e8b34c" }}>🎯 {eventTargets[E].join("、")}</span></span>
                  </div>
                ))}
              </div>

              <div style={S.card}>
                <div style={S.h}>⭐ 店のオススメ機種（1週間ごと・月曜から日曜）</div>
                <div style={S.note}>店で見たその週のオススメ機種を登録します（何機種でも）。見通しに⭐で表示し、ピックアップの学習パターン「店のオススメ機種」にも入ります。日付を選ぶと、その日を含む週（月曜始まり）に登録されます。10/28の分析では、オススメっぽい週の機種は勝率がいつもより+3.5〜5%でした。</div>
                <input type="date" value={recWeekDate} onChange={(e) => setRecWeekDate(e.target.value || todayStr())} style={{ ...S.input, marginBottom: 6 }} />
                <div style={{ fontSize: 12, color: "#c7cbd4", marginBottom: 8 }}>{md(recWeek)}（月）〜{md(addDays(recWeek, 6))}（日）の週</div>
                {recSuggest.length > 0 && (
                  <div style={{ fontSize: 11, color: "#8b93a3", marginBottom: 8, lineHeight: 1.8 }}>データから見たこの週の🔄よく回されている機種（タップで追加）：{recSuggest.map((x) => <button key={x.key} onClick={() => setWeekRec(recWeek, (l) => addUniqueName(l, x.name))} style={{ ...S.ghost, fontSize: 11, padding: "1px 7px", margin: "2px 4px 2px 0" }}>🔄 {x.name} +{Math.round(x.pct * 100)}%</button>)}</div>
                )}
                <ModelChips icon="⭐" options={modelOptions} resolve={resolve} names={weekRecMap[recWeek] || []} onAdd={(n) => setWeekRec(recWeek, (l) => addUniqueName(l, n))} onRemove={(n) => setWeekRec(recWeek, (l) => l.filter((x) => x !== n))} />
                <Status s={recStatus} />
                {Object.keys(weekRecMap).filter((w) => (weekRecMap[w] || []).length).sort().reverse().slice(0, 8).map((w) => (
                  <div key={w} style={{ ...S.row, marginBottom: 4, marginTop: 4, cursor: "pointer" }} onClick={() => setRecWeekDate(w)}>
                    <span style={{ fontSize: 12 }}><span className="mono">{md(w)}〜{md(addDays(w, 6))}</span>　<span style={{ color: "#f2d24b" }}>⭐ {weekRecMap[w].join("、")}</span></span>
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
          {ovrDates.length >= 10 && (
            <div style={S.card}>
              <div style={S.h}>🔮 今日の見通し（機種が強くなる日・弱くなる日）</div>
              <div style={S.note}>10/16の全データ分析で、本店は「どの台か」より「どの日にどの機種か」で結果が決まると分かったため、その日の条件から機種ごとの見通しを出します。数字は民レポの過去データから毎回計算します（データが増えると自動で更新）。台ごとのピックアップは各機種ページにそのまま残っています。</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                <input type="date" value={effOutlookDate} onChange={(e) => setOutlookDate(e.target.value)} style={{ ...S.input, width: 170 }} />
                {outlookDate && <button onClick={() => setOutlookDate("")} style={chipBtn(false)}>次の営業日に戻す</button>}
                <span style={{ fontSize: 12, color: "#c7cbd4" }}>（{WD[weekdayOf(effOutlookDate)]}）{eventsOn(effOutlookDate).length ? <span style={{ color: isStrong(effOutlookDate) ? "#e5484d" : "#f2d24b" }}>{eventsOn(effOutlookDate).join("、")}</span> : <span style={{ color: "#5a6272" }}>イベント未登録</span>}</span>
              </div>
              {closedSet.has(effOutlookDate) && <div style={{ fontSize: 12, color: "#e5697a", marginBottom: 8 }}>この日は店休日です。</div>}
              {!eventsOn(effOutlookDate).length && <div style={{ fontSize: 11, color: "#8b93a3", marginBottom: 8 }}>※イベントがある日は、先に「共通設定」でその日のイベント（と対象機種）を登録すると見通しに反映されます。</div>}
              {!outlook ? <div style={{ fontSize: 12, color: "#5a6272" }}>民レポが10日分以上たまると表示されます。</div> : (
                <>
                  {outlook.store.level && (
                    <div style={{ background: "#12161d", border: "1px solid #2a323f", borderRadius: 6, padding: "8px 10px", marginBottom: 8, fontSize: 12, lineHeight: 1.6 }}>
                      <b>🏪 店の直近3日（〜{md(outlook.lastDate)}）</b>：1台平均 <span className="mono" style={{ color: (outlook.store.l3 ?? 0) >= 0 ? "#9ece6a" : "#e5697a" }}>{fmtSigned(outlook.store.l3)}</span>
                      {outlook.store.level === "hi" && <span style={{ color: "#e5697a" }}>　出ている（上位25%）→ 締めやすい</span>}
                      {outlook.store.level === "lo" && <span style={{ color: "#9ece6a" }}>　出ていない（下位25%）→ 返しやすい</span>}
                      {outlook.store.level === "mid" && <span style={{ color: "#8b93a3" }}>　普通</span>}
                      <div style={{ fontSize: 11, color: "#8b93a3" }}>過去の翌日の店平均：上位25%のあと <span className="mono">{fmtSigned(outlook.store.nextHi)}</span>（{outlook.store.nHi}回）／下位25%のあと <span className="mono">{fmtSigned(outlook.store.nextLo)}</span>（{outlook.store.nLo}回）</div>
                    </div>
                  )}
                  {outlook.newMachine && outlook.events.some((e) => e.includes("新台")) && (
                    <div style={{ background: "#12161d", border: "1px solid #2a323f", borderRadius: 6, padding: "8px 10px", marginBottom: 8, fontSize: 12, lineHeight: 1.6 }}>
                      <b>🆕 新台の導入日</b>：過去{outlook.newMachine.models}機種の導入日は勝率 <b>{Math.round(outlook.newMachine.rate * 100)}%</b>・平均 <span className="mono">{fmtSigned(outlook.newMachine.avg)}</span>。翌日は勝率{outlook.newMachine.nextRate !== null ? Math.round(outlook.newMachine.nextRate * 100) : "―"}%に下がります（強いのは導入日だけ）。
                    </div>
                  )}
                  {outlook.shuyakuHistory.map((h) => (
                    <div key={h.event} style={{ background: "#12161d", border: "1px solid #2a323f", borderRadius: 6, padding: "8px 10px", marginBottom: 8, fontSize: 12, lineHeight: 1.6 }}>
                      <b>👑 「{h.event}」の過去の主役機種</b><span style={{ fontSize: 11, color: "#8b93a3" }}>（{SHUYAKU_MIN_N}台以上・8割以上が勝ち・平均+{SHUYAKU_MIN_AVG}枚以上）</span>
                      {h.days.length === 0 ? <div style={{ color: "#5a6272" }}>このイベントの過去の民レポはまだありません。</div> : h.days.slice(0, 8).map((x) => (
                        <div key={x.date} className="mono" style={{ fontSize: 11 }}>
                          <span style={{ color: "#8b93a3" }}>{md(x.date)}</span>　{x.list.length ? x.list.map((s) => <span key={s.key} style={{ marginRight: 8, color: "#f2d24b" }}>{s.name} {s.wins}/{s.total}台 {fmtSigned(s.avg)}</span>) : <span style={{ color: "#5a6272" }}>主役なし</span>}
                        </div>
                      ))}
                      {h.days.length > 8 && <div style={{ fontSize: 11, color: "#5a6272" }}>ほか{h.days.length - 8}回（主役あり{h.days.slice(8).filter((x) => x.list.length).length}回）</div>}
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: "#8b93a3", margin: "4px 0 6px", lineHeight: 1.6 }}>⭐店のオススメ：{outlook.rec.registered ? `この週は${outlook.rec.registered}機種を登録済み` : "この週はまだ登録なし（共通設定で登録）"}。見通しに{outlook.rec.lift >= 0 ? "+" : ""}{(outlook.rec.lift * 100).toFixed(1)}%（{outlook.rec.measured === null ? "まだ登録の実績が無いので10/28の分析値+5%" : `登録した週の実績${outlook.rec.measured >= 0 ? "+" : ""}${(outlook.rec.measured * 100).toFixed(1)}%・${outlook.rec.days}機種日を反映`}）。🔄＝今週（月曜から前日まで）いつもより回されている機種（データからの推測、+3.5%）。</div>
                  <div style={{ fontSize: 11, color: "#8b93a3", margin: "4px 0 6px" }}>見通し＝その機種のいつもの勝率に、今日の条件（{outlook.conds.map((c) => `${c.label}${c.days}日`).join("・")}{" "}／🎯対象）で過去どうだったかを日数に応じて足したもの。勝率＝差枚プラスの台の割合。</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {(outlookAll ? outlook.models : outlook.models.slice(0, 12)).map((m) => {
                      const d = m.est - m.base;
                      return (
                        <div key={m.key} style={{ background: "#12161d", border: `1px solid ${d >= 0.08 ? "#4a5a2a" : d <= -0.08 ? "#5a2a33" : "#232b37"}`, borderRadius: 6, padding: "7px 9px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                            <span>{m.isRec && <span>⭐</span>}{m.isTarget && <span style={{ color: "#e8b34c" }}>🎯</span>}{m.week && m.week.level === "hot" && <span>🔄</span>}{m.shuyaku > 0 && <span style={{ color: "#f2d24b" }}>👑{m.shuyaku}</span>} {m.name}<span style={{ color: "#5a6272" }}>（{m.total}台）</span></span>
                            <span className="mono">見通し <b style={{ color: d >= 0.05 ? "#9ece6a" : d <= -0.05 ? "#e5697a" : "#c7cbd4" }}>{Math.round(m.est * 100)}%</b><span style={{ color: "#5a6272" }}>　いつも{Math.round(m.base * 100)}%</span></span>
                          </div>
                          <div style={{ fontSize: 11, color: "#8b93a3", marginTop: 3, lineHeight: 1.7 }}>
                            {m.parts.map((p) => <span key={p.label} style={{ marginRight: 8, display: "inline-block", color: p.diff >= 0.05 ? "#9ece6a" : p.diff <= -0.05 ? "#e5697a" : "#8b93a3" }}>{p.label} {Math.round(p.rate * 100)}%（{p.days}日）</span>)}
                            {m.isRec && <span style={{ marginRight: 8, display: "inline-block", color: "#f2d24b" }}>⭐店のオススメ（今週・登録）</span>}
                            {m.week && m.week.level && <span style={{ marginRight: 8, display: "inline-block", color: m.week.level === "hot" ? "#9ece6a" : "#e5697a" }}>{m.week.level === "hot" ? "🔄今週よく回されている（オススメっぽい）" : "今週あまり回されていない"} {m.week.pct >= 0 ? "+" : ""}{Math.round(m.week.pct * 100)}%（月曜から{m.week.days}日分）</span>}
                            {m.targetPart && <span style={{ marginRight: 8, display: "inline-block", color: "#e8b34c" }}>🎯対象の日 {Math.round(m.targetPart.rate * 100)}%（{m.targetPart.days}日）</span>}
                            {m.balance && m.balance.pos !== "mid" && <span style={{ display: "inline-block", color: m.balance.pos === "lo" ? "#9ece6a" : "#e5697a" }}>⚖️直近30日が{m.balance.pos === "lo" ? "悪い→戻りやすい" : "良い→締めやすい"}（この機種で相関{m.balance.r.toFixed(2)}）</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {outlook.models.length > 12 && <button onClick={() => setOutlookAll((v) => !v)} style={{ ...chipBtn(false), marginTop: 8 }}>{outlookAll ? "上位12機種だけ表示" : `全${outlook.models.length}機種を表示`}</button>}
                  <div style={{ fontSize: 11, color: "#5a6272", marginTop: 8, lineHeight: 1.6 }}>
                    10/16の分析で分かっていること：台番号・台の位置・据え置きには法則が見つからない（576通り調べて偶然と同じ）／前日に同じ機種で上位だった台はわずかに下がり、大負けした台はわずかに上がる（1〜3%）。これらは各機種ページのピックアップの学習パターンに入っています。
                  </div>
                </>
              )}
            </div>
          )}
          {dailyTotals.length > 0 && (
            <div style={S.card}>
              <div style={S.h}>📈 店全体の推移（民レポ）</div>
              <div style={S.note}>機種別の平均差枚×台数を全機種分（バラエティ含む）足し合わせています。</div>
              <div className="scrollbar" style={{ maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {dailyTotals.map((d) => (
                  <div key={d.date} style={{ background: "#12161d", border: "1px solid #232b37", borderRadius: 6, padding: "7px 9px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                      <span className="mono">{d.date}<span style={{ color: "#5a6272" }}>（{WD[weekdayOf(d.date)]}）</span>{eventsOn(d.date).length > 0 && <span style={{ marginLeft: 4, fontSize: 11, color: isStrong(d.date) ? "#e5484d" : isSemi(d.date) ? "#9ece6a" : "#f2d24b" }}>{eventsOn(d.date).join("、")}</span>}</span>
                      <span className="mono">総差枚 <b style={{ color: (d.total ?? 0) >= 0 ? "#9ece6a" : "#e5697a" }}>{fmtSigned(d.total)}</b></span>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "#8b93a3", marginTop: 2 }}>1台平均 <span style={{ color: (d.avg ?? 0) >= 0 ? "#9ece6a" : "#e5697a" }}>{fmtSigned(d.avg)}</span>　平均G {fmt(d.avgG)}　{d.n}台</div>
                    {d.marks.length > 0 && <div style={{ fontSize: 11, marginTop: 3, lineHeight: 1.6 }}>{d.marks.map((m, i) => <span key={i} style={{ color: markColor(m.mark), marginRight: 8, display: "inline-block" }}>{m.mark}{m.name}</span>)}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {ovrDates.length > 0 && (
            <div style={S.card}>
              <div style={S.h}>📅 イベントを選んで過去を見る</div>
              <div style={S.note}>イベントを選ぶと、そのイベントがあった過去の日の結果（民レポ）をまとめて表示します。「イベント無し」を選ぶと通常日の結果が見られます。黄色の🎯はその日の対象機種です。</div>
              <select value={evHist} onChange={(e) => setEvHist(e.target.value)} style={{ ...S.input, width: "100%", marginBottom: 10 }}>
                <option value="">イベントを選択...</option>
                <option value={NO_EVENT_LABEL}>{NO_EVENT_LABEL}（通常日）</option>
                {allEventNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              {evHistory && (evHistory.dates.length === 0 ? <div style={{ fontSize: 12, color: "#5a6272" }}>このイベントの日の民レポはまだありません。</div> : (
                <>
                  <div style={{ fontSize: 12, color: "#c7cbd4", marginBottom: 8 }}>
                    {evHistory.dates.length}回　平均の総差枚 <span className="mono" style={{ color: (evHistory.avgTotal ?? 0) >= 0 ? "#9ece6a" : "#e5697a" }}>{fmtSigned(evHistory.avgTotal)}</span>　1台平均 <span className="mono" style={{ color: (evHistory.avgPer ?? 0) >= 0 ? "#9ece6a" : "#e5697a" }}>{fmtSigned(evHistory.avgPer)}</span>
                  </div>
                  <div className="scrollbar" style={{ maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                    {evHistory.totals.map((t) => {
                      const tgMap = targetsOn(t.date);
                      const tgKeys = new Set([...tgMap.values()].flatMap((x) => [...x]));
                      const tgRows = ovr[t.date].modelRows.filter((r) => tgKeys.has(resolve(r.name)));
                      return (
                        <div key={t.date} style={{ background: "#12161d", border: "1px solid #2a323f", borderRadius: 6, padding: "7px 9px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, fontSize: 12 }}>
                            <span className="mono">{t.date}（{WD[weekdayOf(t.date)]}）{eventsOn(t.date).length > 0 && <span style={{ color: "#5a6272", fontSize: 10 }}> {eventsOn(t.date).join("、")}</span>}</span>
                            <span className="mono">総差枚 <b style={{ color: (t.total ?? 0) >= 0 ? "#9ece6a" : "#e5697a" }}>{fmtSigned(t.total)}</b>　平均{fmtSigned(t.avg)}　G{fmt(t.avgG)}</span>
                          </div>
                          {tgRows.length > 0 && (
                            <div style={{ fontSize: 11, marginTop: 4, color: "#e8b34c" }}>
                              🎯 {tgRows.map((r) => { const mk = classifyMinRepoMark(r); return <span key={r.name} style={{ marginRight: 8 }}>{r.name} <span className="mono" style={{ color: r.hiddenNegative || (r.avgSada ?? 0) < 0 ? "#e5697a" : "#9ece6a" }}>{r.hiddenNegative ? "マイナス" : fmtSigned(r.avgSada)}</span>{mk && <span style={{ color: markColor(mk) }}> {mk}</span>}</span>; })}
                            </div>
                          )}
                          {t.marks.length > 0 && (
                            <div style={{ fontSize: 11, marginTop: 4 }}>{t.marks.map((m, i) => <span key={i} style={{ color: markColor(m.mark), marginRight: 8 }}>{m.mark}{m.name}</span>)}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <Collapse title={`この日の機種別成績（マークが付いた割合の高い順・${evHistory.models.length}機種）`}>
                    <div className="scrollbar" style={{ maxHeight: 360, overflow: "auto" }}>
                      <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                        <thead><tr><th style={S.th}>機種</th><th style={{ ...S.th, textAlign: "right" }}>回数</th><th style={{ ...S.th, textAlign: "right" }}>マーク率</th><th style={{ ...S.th, textAlign: "right" }}>平均差枚</th><th style={{ ...S.th, textAlign: "right" }}>🎯対象</th></tr></thead>
                        <tbody>{evHistory.models.map((m) => (
                          <tr key={m.key}>
                            <td style={{ ...S.td, whiteSpace: "normal" }}>{displayNameOf[m.key] || m.key}</td>
                            <td className="mono" style={{ ...S.td, textAlign: "right" }}>{m.n}</td>
                            <td className="mono" style={{ ...S.td, textAlign: "right" }}>{Math.round(m.markRate * 100)}%</td>
                            <td className="mono" style={{ ...S.td, textAlign: "right", color: (m.avg ?? 0) >= 0 ? "#9ece6a" : "#e5697a" }}>{fmtSigned(m.avg)}</td>
                            <td className="mono" style={{ ...S.td, textAlign: "right", color: "#e8b34c" }}>{m.target ? `${m.target}回（マーク${m.targetMarks}）` : "―"}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </Collapse>
                  <Collapse title="この日の末尾別成績">
                    <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr><th style={S.th}>末尾</th><th style={{ ...S.th, textAlign: "right" }}>平均差枚</th><th style={{ ...S.th, textAlign: "right" }}>勝率</th></tr></thead>
                      <tbody>{evHistory.digits.map((x) => (
                        <tr key={x.name}>
                          <td style={S.td}>{x.name}</td>
                          <td className="mono" style={{ ...S.td, textAlign: "right", color: x.n && x.sum / x.n >= 0 ? "#9ece6a" : "#e5697a" }}>{x.n ? fmtSigned(x.sum / x.n) : "―"}{x.hidden > 0 && <span style={{ color: "#5a6272", fontSize: 10 }}>（マイナス非表示{x.hidden}回）</span>}</td>
                          <td className="mono" style={{ ...S.td, textAlign: "right" }}>{x.total ? `${Math.round((x.wins / x.total) * 100)}%` : "―"}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </Collapse>
                </>
              ))}
            </div>
          )}
          {ovrGridDates.length > 0 && (
            <Collapse title={`📋 機種×日付マトリクス（☆◎◯▲、${ovrGridEventFilter.length ? `選んだイベントの日・${ovrGridDates.length}日` : "直近30日"}）`} defaultOpen>
              <div style={S.note}>台数の多い順。イベントを選ぶと、そのイベントがあった日付だけを並べます（複数選択可。何も選ばない時は直近30日）。青い枠はその日バラエティ（1台設置）だったセル、黄色い背景はイベント対象機種🎯です。日付の色：赤＝強いイベント・緑＝準イベント・黄＝イベント。</div>
              {renderEventMultiSelect(ovrGridEventFilter, setOvrGridEventFilter)}
              {!ovrGridDates.length && <div style={{ fontSize: 12, color: "#5a6272", marginBottom: 6 }}>選んだイベントの日の民レポはまだありません。</div>}
              <div className="scrollbar" style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
                  <thead><tr><th style={{ ...S.th, position: "sticky", left: 0, background: "#1b212b" }} />{ovrGridDates.map((d) => <th key={d} className="mono" title={eventsOn(d).join("、")} style={{ ...S.th, fontSize: 9, color: isStrong(d) ? "#e5484d" : isSemi(d) ? "#9ece6a" : eventsOn(d).length ? "#f2d24b" : "#5a6272" }}>{d.slice(5)}</th>)}</tr></thead>
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

      {/* =================================================================== 機種ページ（v0.3.0：プラザ2と同じ構成） */}
      {viewMode === "page" && currentPage && (
        <div>
          {/* ページ名・正式名称（編集はロック解除時だけ） */}
          {unlocked ? (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <Pencil size={14} color="#5a6272" />
                <input defaultValue={currentPage.name} key={`n-${currentPage.id}`} onBlur={(e) => e.target.value !== currentPage.name && updatePage(currentPage.id, { name: e.target.value })} placeholder="ページ名（例：マイジャグ）"
                  style={{ fontSize: 16, fontWeight: 700, background: "transparent", border: "none", borderBottom: "1px dashed #2a323f", color: "#e7e9ee", padding: "4px 2px", flex: "1 1 200px", minWidth: 0 }} />
                <button style={{ ...S.ghost, color: "#e5697a" }} onClick={() => window.confirm("このページを削除しますか？（データ自体は消えません）") && deletePage(currentPage.id)}><Trash2 size={11} /> ページ削除</button>
              </div>
              <div style={{ fontSize: 11, color: "#5a6272", marginBottom: 6 }}>正式名称（アナスロ・民レポと連携。複数機種を束ねる場合は1つずつ追加）</div>
              <ModelChips icon="" options={modelOptions} resolve={resolve} names={splitNames(currentPage.officialName)}
                onAdd={(n) => updatePage(currentPage.id, { officialName: joinNames([...splitNames(currentPage.officialName).filter((x) => !modelNamesMatch(x, n, resolve)), n.trim()]) })}
                onRemove={(n) => updatePage(currentPage.id, { officialName: joinNames(splitNames(currentPage.officialName).filter((x) => x !== n)) })} />
            </div>
          ) : (
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>{currentPage.name || "（無題）"}</div>
          )}

          {!pageNameKeys.size ? (
            <div style={S.card}><div style={S.note}>このページにはまだ機種が登録されていません。{unlocked ? "上の欄から正式名称を追加してください。" : "「🔧 共通設定」で暗証番号を解除すると設定できます。"}</div></div>
          ) : !engine ? (
            <div style={S.card}><div style={S.note}>この機種のアナスロデータがまだありません。</div></div>
          ) : (
            <div className="tracker-grid">
              {/* ---------------- 左列 ---------------- */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                {unlocked ? (
                  <div style={{ ...S.card, marginBottom: 0 }}>
                    <div style={S.h}>このページのデータ</div>
                    <div style={S.note}>データの入力は「🔧 共通設定」タブのアナスロから行います。正式名称が一致すると、ここには自動で反映されます。</div>
                    <Status s={pageStatus} />
                    <div style={{ marginTop: 12, borderTop: "1px solid #2a323f", paddingTop: 12 }}>
                      <button onClick={() => setDateListOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", fontSize: 12, fontWeight: 700, color: "#c7cbd4", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left", marginBottom: dateListOpen ? 8 : 0 }}>
                        {dateListOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}登録済みの日付（{pageDates.length}件）
                      </button>
                      {dateListOpen && (
                        <div className="scrollbar" style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                          {[...pageDates].reverse().map((d) => (
                            <div key={d} style={S.row}>
                              <span>
                                <span className="mono">{d}</span>
                                {eventsOn(d).length > 0 && <span style={{ marginLeft: 6, color: isStrong(d) ? "#e5484d" : isSemi(d) ? "#9ece6a" : "#f2d24b" }}>{isStrong(d) ? "★" : isSemi(d) ? "🚩" : "☆"}{eventsOn(d).join("、")}</span>}
                                <span style={{ marginLeft: 6, color: "#5a6272" }}>{allMachines.filter((m) => recOf(m.key, d)).length}台</span>
                              </span>
                              {confirmDeleteDate === d ? (
                                <span style={{ display: "flex", gap: 8 }}>
                                  <button onClick={() => deletePageDate(d)} style={{ fontSize: 11, color: "#e5697a", background: "none", border: "none", cursor: "pointer" }}>削除する</button>
                                  <button onClick={() => setConfirmDeleteDate(null)} style={{ fontSize: 11, color: "#8b93a3", background: "none", border: "none", cursor: "pointer" }}>取消</button>
                                </span>
                              ) : (
                                <button onClick={() => setConfirmDeleteDate(d)} title="この日のこのページのデータを削除" style={{ background: "none", border: "none", cursor: "pointer", color: "#5a6272" }}><Trash2 size={13} /></button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ marginTop: 10 }}>
                        {confirmReset ? (
                          <div style={{ display: "flex", gap: 8, fontSize: 12, flexWrap: "wrap" }}>
                            <span style={{ color: "#e5697a" }}>このページのデータを全て削除しますか？（元に戻せません）</span>
                            <button onClick={resetPageData} style={{ color: "#e5697a", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>はい</button>
                            <button onClick={() => setConfirmReset(false)} style={{ color: "#8b93a3", background: "none", border: "none", cursor: "pointer" }}>いいえ</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmReset(true)} style={{ fontSize: 11, color: "#5a6272", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><RotateCcw size={11} />このページのデータをリセット</button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ ...S.card, marginBottom: 0, fontSize: 12, color: "#8b93a3", display: "flex", alignItems: "center", gap: 8 }}><Lock size={13} />データ入力はロック中です。「🔧 共通設定」タブで暗証番号を入力すると解除できます。</div>
                )}

                <div style={{ ...S.card, marginBottom: 0 }}>
                  <div style={S.h}>📋 台番号×日付マトリクス表</div>
                  <div style={S.note}>台番号ごとに、日付ごとの記号を一覧表示します。イベントを選ぶと、そのイベントがあった日付だけに絞り込めます（複数選択可）。何も選ばない時は直近30日分を表示します。</div>
                  {renderEventMultiSelect()}
                  <div style={{ ...S.note, marginBottom: 8 }}><span style={{ color: SYMBOL_COLORS["☆"] }}>☆</span>＝読み取り上位20%＋プラス　<span style={{ color: SYMBOL_COLORS["〇"] }}>〇</span>＝上位50%＋プラス　<span style={{ color: SYMBOL_COLORS["▽"] }}>▽</span>＝上位50%だがマイナス　<span style={{ color: SYMBOL_COLORS["□"] }}>□</span>＝中間　<span style={{ color: "#8b93a3" }}>×</span>＝推定低設定（下位20%）　－＝判定不可（回転数不足）。点線の下線は個別台の代用データ。黄色い背景＝その日のイベント対象機種🎯。日付の色：赤＝強いイベント・緑＝準イベント・黄＝イベント。日付の下の「☆〇4/12」＝その日☆〇だった台数／判定できた台数（出る日・出ない日の目安。赤＝半分以上、黄＝3割以上）。</div>
                  {renderSymbolGrid(gridDates, pageMachines)}
                </div>

                <div style={{ ...S.card, marginBottom: 0 }}>
                  <div style={S.h}>🎰 設定期待度マトリクス表</div>
                  <div style={S.note}>
                    大きい数字＝設定期待度（0〜100、回転数が少ないほど0側に寄せた値）、右下の小さい数字＝寄せる前の生の読み取り。<span style={{ color: "#e8b34c" }}>▼</span>＝回転数が少ないのに出ている台（設定ではなく展開の可能性）。色：赤75以上／黄60／緑45／青30／灰。日付・イベントの絞り込みは上の表と共通です。
                    {[...engine.ctx.modelCtx.values()].map((c) => (
                      <div key={c.key}>・{displayNameOf[c.key] || c.key}：{c.profile ? "確率表あり（設定判別）" : "確率表なし（店内の合算確率の順位で暫定判定）"}・G数は{c.gtype === "normal" ? "通常時（上限3900）" : c.gtype === "total" ? "総回転数（上限8000）" : "未判定（上限3900で計算）"}</div>
                    ))}
                  </div>
                  {renderExpGrid(gridDates, pageMachines)}
                </div>
              </div>

              {/* ---------------- 右列 ---------------- */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                <div style={{ ...S.card, marginBottom: 0 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end", marginBottom: 10 }}>
                    {RANGE_OPTIONS.map((r) => <button key={r.key} onClick={() => { setRange(r.key); setUseCustomRange(false); }} style={chipBtn(!useCustomRange && range === r.key)}>{r.label}</button>)}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", justifyContent: "flex-end", marginBottom: 12 }}>
                    <span style={{ fontSize: 11, color: "#5a6272" }}>期間を指定：</span>
                    <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ ...S.input, fontSize: 11, padding: "5px 6px", borderColor: useCustomRange ? "#4fd1c5" : "#2a323f" }} />
                    <span style={{ fontSize: 11, color: "#5a6272" }}>〜</span>
                    <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ ...S.input, fontSize: 11, padding: "5px 6px", borderColor: useCustomRange ? "#4fd1c5" : "#2a323f" }} />
                    <button onClick={() => setUseCustomRange(true)} disabled={!customStart || !customEnd} style={{ fontSize: 11, padding: "5px 10px", borderRadius: 6, border: "1px solid #4fd1c5", background: useCustomRange ? "rgba(79,209,197,0.12)" : "transparent", color: "#4fd1c5", cursor: customStart && customEnd ? "pointer" : "not-allowed", opacity: customStart && customEnd ? 1 : 0.5 }}>適用</button>
                    {useCustomRange && <button onClick={() => setUseCustomRange(false)} style={{ fontSize: 11, padding: "5px 10px", borderRadius: 6, border: "1px solid #2a323f", background: "transparent", color: "#8b93a3", cursor: "pointer" }}>解除</button>}
                  </div>
                  {!selected.length ? (
                    <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: "#5a6272", fontSize: 13, textAlign: "center" }}>下の「表示する台番」から台を選ぶと、ここにグラフが表示されます。</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={chartData} margin={{ top: 14, right: 8, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#232b37" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#8b93a3" }} tickFormatter={(d) => md(d)} minTickGap={12} />
                        <YAxis tick={{ fontSize: 10, fill: "#8b93a3" }} width={48} />
                        <Tooltip contentStyle={{ background: "#1b212b", border: "1px solid #2a323f", borderRadius: 8, fontSize: 12 }} labelFormatter={(label, payload) => { const ev = payload && payload[0] && payload[0].payload ? payload[0].payload.event : ""; return ev ? `${label}（${ev}）` : label; }} />
                        {selected.length <= 12 && <Legend wrapperStyle={{ fontSize: 10 }} />}
                        <ReferenceLine y={0} stroke="#3a4353" />
                        {chartMarks.closed.map((d) => { const band = getBandRange(chartData.map((x) => x.date), d); return band ? <ReferenceArea key={`closed-${d}`} x1={band.x1} x2={band.x2} fill="#5a6272" fillOpacity={0.28} stroke="none" label={{ value: "休", position: "insideTop", fill: "#c7cbd4", fontSize: 10 }} /> : null; })}
                        {chartMarks.nodata.map((d) => { const band = getBandRange(chartData.map((x) => x.date), d); return band ? <ReferenceArea key={`nodata-${d}`} x1={band.x1} x2={band.x2} fill="#7a3038" fillOpacity={0.25} stroke="none" label={{ value: "なし", position: "insideTop", fill: "#e5697a", fontSize: 9 }} /> : null; })}
                        {chartMarks.d2.map((d) => <ReferenceLine key={`d2-${d}`} x={d} stroke={DIGIT2_COLOR} strokeDasharray="2 2" strokeOpacity={0.55} label={{ value: "2", position: "top", fill: DIGIT2_COLOR, fontSize: 9 }} />)}
                        {chartMarks.d7.map((d) => <ReferenceLine key={`d7-${d}`} x={d} stroke={DIGIT7_COLOR} strokeDasharray="2 2" strokeOpacity={0.55} label={{ value: "7", position: "top", fill: DIGIT7_COLOR, fontSize: 9 }} />)}
                        {chartMarks.strong.map((x) => <ReferenceLine key={`st-${x.date}`} x={x.date} stroke="#e5484d" strokeDasharray="5 3" strokeWidth={2} label={{ value: "★", position: "top", fill: "#e5484d", fontSize: 10 }} />)}
                        {chartMarks.semi.map((x) => <ReferenceLine key={`se-${x.date}`} x={x.date} stroke="#9ece6a" strokeDasharray="2 4" strokeOpacity={0.8} label={{ value: "🚩", position: "top", fill: "#9ece6a", fontSize: 9 }} />)}
                        {chartMarks.ev.map((x) => <ReferenceLine key={`ev-${x.date}`} x={x.date} stroke="#f2d24b" strokeDasharray="4 3" label={{ value: "☆", position: "top", fill: "#f2d24b", fontSize: 11 }} />)}
                        {selected.map((k, i) => { const m = machineByKey.get(k); return m ? <Line key={k} type="monotone" dataKey={k} name={machineLabel(m)} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} /> : null; })}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                  <div style={{ fontSize: 11, color: "#5a6272", marginTop: 6, lineHeight: 1.6 }}>単位：枚（その日の差枚）　★(赤) = 強いイベント　☆(黄) = イベント　🚩(緑) = 準イベント　水色点線 = 2のつく日　オレンジ点線 = 7のつく日　グレー帯 = 店休日　赤い帯 = データなし</div>
                </div>

                <div style={{ ...S.card, marginBottom: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                    <div style={{ ...S.h, marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}><ListChecks size={14} />表示する台番（{selected.length}/{pageMachines.length}）</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <label style={{ fontSize: 11, color: "#8b93a3", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />過去の台番も表示</label>
                      <button onClick={() => setSelected(pageMachines.map((m) => m.key))} style={{ fontSize: 12, color: "#4fd1c5", background: "none", border: "1px solid #2a4a47", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>全選択</button>
                      <button onClick={() => setSelected([])} style={{ fontSize: 12, color: "#8b93a3", background: "none", border: "1px solid #2a323f", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>全解除</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {pageMachines.map((m) => {
                      const idx = selected.indexOf(m.key);
                      const color = idx >= 0 ? PALETTE[idx % PALETTE.length] : "#2a323f";
                      return <button key={m.key} className="mono" onClick={() => setSelected((sl) => (idx >= 0 ? sl.filter((x) => x !== m.key) : [...sl, m.key]))} style={{ fontSize: 12, padding: "6px 9px", borderRadius: 6, cursor: "pointer", border: `1px solid ${color}`, background: idx >= 0 ? `${color}22` : "transparent", color: idx >= 0 ? color : "#5a6272" }}>{isMultiModel ? `${m.model} ${m.no}` : m.no}</button>;
                    })}
                  </div>
                </div>

                <div style={{ ...S.card, marginBottom: 0 }}>
                  <div style={S.h}>日別データを見る</div>
                  <input type="date" value={effViewDate} onChange={(e) => setViewDate(e.target.value)} style={{ ...S.input, marginBottom: 12, marginTop: 4 }} />
                  {!viewDateList.length ? (
                    <div style={{ fontSize: 12, color: "#5a6272" }}>この日のデータはまだありません。</div>
                  ) : (
                    <>
                      <div style={{ fontSize: 11, color: "#8b93a3", marginBottom: 6, lineHeight: 1.6 }}>設定っぽさ（0〜100）＝初当たり・その台のいつもより粘られたか・差枚を機種の中で比べた平均。🔥入ってそう／💤見切り（回されず差枚も中途半端）。マイジャグで確かめると、設定っぽさ下位1/5はRB 1/418・上位1/5は1/278。</div>
                      <div className="scrollbar" style={{ maxHeight: 300, overflow: "auto", marginBottom: 14 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead><tr><th style={S.th}>台番</th><th style={{ ...S.th, textAlign: "right" }}>差枚</th><th style={{ ...S.th, textAlign: "right" }}>G数</th><th style={{ ...S.th, textAlign: "center" }}>記号</th><th style={{ ...S.th, textAlign: "right" }}>期待度</th><th style={{ ...S.th, textAlign: "right" }}>設定っぽさ</th></tr></thead>
                          <tbody>{viewDateList.map(({ m, r }) => (
                            <tr key={m.key} style={{ borderTop: "1px solid #232b37" }}>
                              <td className="mono" style={{ padding: "6px 6px", color: "#c7cbd4" }}>{isMultiModel ? machineLabel(m) : m.no}{r.src === "m" && <span style={{ color: "#bb9af7", fontSize: 10 }}> 代用</span>}</td>
                              <td className="mono" style={{ padding: "6px 6px", textAlign: "right", fontWeight: 700, color: (r.s ?? 0) >= 0 ? "#9ece6a" : "#e5697a" }}>{r.s === null ? "―" : `${fmtSigned(r.s)}枚`}</td>
                              <td className="mono" style={{ padding: "6px 6px", textAlign: "right", color: "#8b93a3" }}>{fmt(r.g)}</td>
                              <td className="mono" style={{ padding: "6px 6px", textAlign: "center", fontWeight: 700, color: SYMBOL_COLORS[r.sym] }}>{r.sym}</td>
                              <td className="mono" style={{ padding: "6px 6px", textAlign: "right", color: r.exp ? fiveBandColor(Math.round(r.exp.score * 100)) : "#5a6272" }}>{r.exp ? Math.round(r.exp.score * 100) : "―"}</td>
                              <td className="mono" style={{ padding: "6px 6px", textAlign: "right", whiteSpace: "nowrap", color: r.setLike !== null && r.setLike !== undefined ? fiveBandColor(r.setLike) : "#5a6272" }}>{r.iri && <span title="入ってそう">🔥</span>}{r.mikiri && <span title="見切り" style={{ color: "#8b93a3" }}>💤</span>}{r.setLike ?? "―"}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                      <div style={{ borderTop: "1px solid #2a323f", paddingTop: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                          <div style={{ ...S.h, marginBottom: 0 }}>この日までの差枚推移</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{[7, 10, 20, 30].map((w) => <button key={w} onClick={() => setViewWindow(w)} style={chipBtn(viewWindow === w)}>{w}日間</button>)}</div>
                        </div>
                        <div className="mini-grid">
                          {viewWindowSeries.map((x) => <React.Fragment key={x.key}>{MiniChart({ title: isMultiModel ? machineLabel(x.m) : x.m.no, series: x.series, total: x.total, height: 100, axis: false })}</React.Fragment>)}
                        </div>
                      </div>
                      <div style={{ borderTop: "1px solid #2a323f", paddingTop: 12, marginTop: 14 }}>
                        <div style={S.h}>この日までの設定期待度マトリクス表</div>
                        {renderExpGrid([...viewWindowDates].reverse(), viewDateList.map((x) => x.m))}
                      </div>
                    </>
                  )}
                </div>

                {machineSummaries.length > 0 && (
                  <div style={{ ...S.card, marginBottom: 0 }}>
                    <div style={{ ...S.h, marginBottom: 12 }}>台別チャート（{useCustomRange ? "指定期間" : (RANGE_OPTIONS.find((r) => r.key === range) || {}).label}・累計差枚）</div>
                    <div className="mini-grid wide">
                      {machineSummaries.map((x) => <React.Fragment key={x.key}>{MiniChart({ title: isMultiModel ? machineLabel(x.m) : x.m.no, series: x.series, total: x.count ? x.total : null, height: 130, axis: true, marks: { closed: chartMarks.closed, d2: chartMarks.d2, d7: chartMarks.d7, strong: chartMarks.strong } })}</React.Fragment>)}
                    </div>
                  </div>
                )}

                <div style={{ ...S.card, marginBottom: 0 }}>
                  <div style={S.h}>〇のつく日 平均差枚</div>
                  <div style={S.note}>数字を選ぶと、その数字で終わる日付（例：2 なら 2日・12日・22日）の平均差枚を台ごとに計算します（このページの全期間データが対象）。</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                      <button key={d} onClick={() => setLuckyDigit(d === luckyDigit ? null : d)} className="mono" style={{ width: 34, height: 34, borderRadius: 8, cursor: "pointer", border: `1px solid ${luckyDigit === d ? "#e8b34c" : "#2a323f"}`, background: luckyDigit === d ? "rgba(232,179,76,0.15)" : "transparent", color: luckyDigit === d ? "#e8b34c" : "#c7cbd4", fontSize: 13, fontWeight: 700 }}>{d}</button>
                    ))}
                  </div>
                  {luckyDigit === null ? <div style={{ fontSize: 12, color: "#5a6272" }}>上の数字を選んでください。</div>
                    : !luckyDay.stats.length ? <div style={{ fontSize: 12, color: "#5a6272" }}>該当する日付のデータがまだありません。</div> : (
                    <>
                      <div style={{ background: "#12161d", border: "1px solid #2a323f", borderRadius: 8, padding: "10px 12px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, color: "#8b93a3" }}>全体合計差枚の平均（{luckyDay.dayCount}日分）</span>
                        <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: luckyDay.avgTotal >= 0 ? "#9ece6a" : "#e5697a" }}>{fmtSigned(luckyDay.avgTotal)}枚</span>
                      </div>
                      <div className="scrollbar" style={{ maxHeight: 260, overflowY: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead><tr><th style={S.th}>台番</th><th style={{ ...S.th, textAlign: "right" }}>平均差枚</th><th style={{ ...S.th, textAlign: "right" }}>該当日数</th></tr></thead>
                          <tbody>{luckyDay.stats.map((x) => (
                            <tr key={x.key} style={{ borderTop: "1px solid #232b37" }}>
                              <td className="mono" style={{ padding: "6px 6px", color: "#c7cbd4" }}>{isMultiModel ? machineLabel(x.m) : x.m.no}</td>
                              <td className="mono" style={{ padding: "6px 6px", textAlign: "right", fontWeight: 700, color: x.avg >= 0 ? "#9ece6a" : "#e5697a" }}>{fmtSigned(x.avg)}枚</td>
                              <td className="mono" style={{ padding: "6px 6px", textAlign: "right", color: "#5a6272" }}>{x.count}日</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>

                  <div style={{ ...S.card, marginBottom: 0 }}>
                    <div style={{ ...S.h, fontSize: 14 }}>{pickTitle}</div>
                    <div style={S.note}>
                      {engine.pick.lastDate}までのデータで予想。過去の「パターンに当てはまった台の、予想日（データの次の営業日）の☆〇率 − 全体の☆〇率（基準{engine.learned.base !== null ? `${(engine.learned.base * 100).toFixed(1)}%` : "―"}）」を点数にして合計しています。学習済みパターン{engine.learned.weights.size}件（データ{engine.ctx.dates.length}日・サンプル数15未満のパターンは使いません）。
                      「前日」＝データの最後の日、「予想日」＝予想する日。[日]＝その日・機種の材料（同じ日の台は全部同じ）、[台]＝その台の材料。ランクは「予想勝率」＝今日の機種の見通し（全体データの🔮と同じ）＋台の点数×0.05%で付けます：S≥62% / A≥50% / B≥44% / C≥39% / D≥31% / E（v0.4.6。バックテストで全体 S61%〜E32%）。機種の見通しが出ない時は台の点数だけ（S≥100 / A≥60 / B≥-10 / C≥-60 / D≥-100）。
                    </div>
                    {(() => { const hit = Object.keys(PICKUP_RELIABILITY).filter((n) => pageNameKeys.has(resolve(n))).map((n) => PICKUP_RELIABILITY[n]); return hit.length ? <div style={{ fontSize: 12, color: "#e8b34c", background: "rgba(232,179,76,0.08)", border: "1px solid #5a4a2a", borderRadius: 6, padding: "7px 9px", marginBottom: 10, lineHeight: 1.6 }}>⚠️ 参考表示：{hit.join(" ")}</div> : null; })()}
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
                              {p.pred !== null && p.pred !== undefined && <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "#e7e9ee" }}>予想勝率 {Math.round(p.pred * 100)}%</span>}
                              <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: p.points >= 0 ? "#9ece6a" : "#e5697a" }}>{p.points >= 0 ? "+" : ""}{p.points.toFixed(1)}pt</span>
                              {p.modelEst !== null && p.modelEst !== undefined && <span style={{ fontSize: 11, color: "#5a6272" }}>機種の見通し {Math.round(p.modelEst * 100)}%・台の点数だけなら{p.ptGrade}</span>}
                              <span style={{ fontSize: 11, color: "#5a6272" }}>前日 <span style={{ color: SYMBOL_COLORS[p.lastSym], fontWeight: 700 }}>{p.lastSym}</span>{p.lastExp && <> ・期待度 <span style={{ color: fiveBandColor(Math.round(p.lastExp.score * 100)) }}>{Math.round(p.lastExp.score * 100)}</span></>}{m && m.recs.length > 0 && m.recs[m.recs.length - 1].setLike != null && <> ・設定っぽさ <span style={{ color: fiveBandColor(m.recs[m.recs.length - 1].setLike) }}>{m.recs[m.recs.length - 1].iri ? "🔥" : m.recs[m.recs.length - 1].mikiri ? "💤" : ""}{m.recs[m.recs.length - 1].setLike}</span></>}</span>
                            </div>
                            {items.length > 0 && (
                              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 1 }}>
                                {items.map((it) => (
                                  <div key={it.key} className="mono" style={{ fontSize: 11, display: "flex", justifyContent: "space-between", gap: 8, color: "#8b93a3" }}>
                                    <span><span style={{ color: isDayPattern(it.key) ? "#7aa2f7" : "#e8b34c", marginRight: 3 }}>{isDayPattern(it.key) ? "[日]" : "[台]"}</span>{it.label}<span style={{ color: "#5a6272" }}>：過去この条件の予想日の☆〇率 {(it.rate * 100).toFixed(1)}%（n={it.n}）</span></span>
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

                <div style={{ ...S.card, marginBottom: 0 }}>
                  <div style={S.h}>台同士の相関</div>
                  <div style={S.note}>日ごとの差枚が似た動きをする台の組み合わせを探します（相関係数の絶対値が0.4以上、同時データ10日分以上のペアのみ表示）。相関は因果関係を示すものではなく、偶然による見かけ上の一致も含まれる点にご注意ください。</div>
                  {!machineCorrelations.length ? <div style={{ fontSize: 12, color: "#5a6272" }}>目立った相関の組み合わせはまだ見つかっていません。</div> : (
                    <div className="scrollbar" style={{ maxHeight: 300, overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead><tr><th style={S.th}>台番A</th><th style={S.th}>台番B</th><th style={{ ...S.th, textAlign: "right" }}>相関係数</th><th style={{ ...S.th, textAlign: "right" }}>同時日数</th></tr></thead>
                        <tbody>{machineCorrelations.map((c) => (
                          <tr key={`${c.a.key}-${c.b.key}`} style={{ borderTop: "1px solid #232b37" }}>
                            <td className="mono" style={{ padding: "6px 6px", color: "#c7cbd4" }}>{isMultiModel ? machineLabel(c.a) : c.a.no}</td>
                            <td className="mono" style={{ padding: "6px 6px", color: "#c7cbd4" }}>{isMultiModel ? machineLabel(c.b) : c.b.no}</td>
                            <td className="mono" style={{ padding: "6px 6px", textAlign: "right", fontWeight: 700, color: c.r >= 0 ? "#9ece6a" : "#e5697a" }}>{c.r >= 0 ? "+" : ""}{c.r.toFixed(2)}</td>
                            <td className="mono" style={{ padding: "6px 6px", textAlign: "right", color: "#5a6272" }}>{c.n}日</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div style={{ ...S.card, marginBottom: 0 }}>
                  <div style={S.h}>総差枚しきい値分析（翌日プラスになりやすいライン）</div>
                  <div style={S.note}>選んでいる台ごとに、直近N日間の総差枚が「いくら以上／以下」だと翌日プラスになりやすいかを、このページの全期間データから探します。</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>{[10, 20, 30].map((w) => <button key={w} onClick={() => setAnalysisWindow(w)} style={chipBtn(analysisWindow === w)}>{w}日足</button>)}</div>
                  {!thresholdAnalyses.length ? <div style={{ fontSize: 12, color: "#5a6272" }}>台を選ぶと、ここに分析結果が表示されます。</div> : (
                    <div className="scrollbar" style={{ maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
                      {thresholdAnalyses.map((a) => (
                        <div key={a.key} style={{ borderTop: "1px solid #232b37", paddingTop: 10 }}>
                          <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: "#e8b34c", marginBottom: 6 }}>{machineLabel(a.m)}　<span style={{ fontSize: 10, color: "#5a6272", fontWeight: 400 }}>（有効データ {a.validDays}日分・基準勝率{Math.round(a.baseRate * 100)}%）</span></div>
                          {renderThresholdResult(a.overall, "全日", a.nAll, 5)}
                          {renderThresholdResult(a.digit2, "翌日が2のつく日のみ", a.n2, 3)}
                          {renderThresholdResult(a.digit7, "翌日が7のつく日のみ", a.n7, 3)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                  <Collapse flush title={`🧪 学習済みパターン一覧（${engine.learned.weights.size}件）`}>
                    <div style={S.note}>点数の大きい順。n＝過去に当てはまった回数。⚠️は信頼度の低い項目です。</div>
                    <div className="scrollbar" style={{ maxHeight: 360, overflowY: "auto" }}>
                      <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
                        <thead><tr><th style={S.th}>パターン</th><th style={{ ...S.th, textAlign: "right" }}>n</th><th style={{ ...S.th, textAlign: "right" }}>予想日の☆〇率</th><th style={{ ...S.th, textAlign: "right" }}>点数</th></tr></thead>
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
              </div>
            </div>
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
