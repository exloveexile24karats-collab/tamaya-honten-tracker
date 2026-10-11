# 玉屋本店 台データ推移トラッカー

民レポとアナスロを1日2回貼り付けるだけで、機種ページごとの差枚推移・記号（☆〇▽□×－）・設定期待度・
「M/Dのピックアップ（実測パターン方式）」を自動で出すWebアプリです。
GitHub Pages + Firebase（Firestore）で動き、スマホのホーム画面に追加して使えます。

- 形式（画面・保存・PWA）はプラザ2版が手本、エンジンは「本店指示書 §4」の仕様で新規実装
- データは玉屋本店専用の **新しい** Firebase プロジェクトに保存（プラザ2・雑餉隈のデータには一切触れません）

---

## 公開までの手順（初回だけ）

### 1. Firebase プロジェクトを作る
1. https://console.firebase.google.com/ →「プロジェクトを作成」（名前例：`tamaya-honten`、Google Analytics はオフでOK）
2. 左メニュー「構築」→「Firestore Database」→「データベースの作成」（ロケーション `asia-northeast1`、いったん「テストモード」）
3. 「ルール」タブに、このフォルダの `firestore.rules` の中身を貼って「公開」
4. 歯車 →「プロジェクトの設定」→「マイアプリ」→ `</>`（ウェブ）でアプリ登録
5. 表示された `firebaseConfig` の6つの値を、`src/firebase.js` の `REPLACE_ME` と置き換える

> `REPLACE_ME` のままだと、アプリ上部に「Firebaseが未設定です」と出て保存できません（誤って他店のデータに書き込む事故を防ぐため）。

### 2. GitHub にアップする
1. GitHub で空のリポジトリ `tamaya-honten-tracker` を作る
2. このフォルダで：
   ```bash
   git init
   git add .
   git commit -m "Initial commit: tamaya honten tracker v0.1.0"
   git branch -M main
   git remote add origin https://github.com/<ユーザー名>/tamaya-honten-tracker.git
   git push -u origin main
   ```
3. リポジトリの「Settings」→「Pages」→「Source」を **GitHub Actions** にする
4. 「Actions」タブでビルドが緑になったら `https://<ユーザー名>.github.io/tamaya-honten-tracker/` で開けます

### 3. スマホに追加
iPhone：Safari で開く → 共有 →「ホーム画面に追加」／Android：Chrome のメニュー →「ホーム画面に追加」

---

## 毎日の使い方
1. 「🔧 共通設定」で暗証番号を入れて解除
2. ① 民レポ：日付を選んで、表を上から下まで（バラエティ・末尾別データ込み）そのまま貼って保存
3. ② アナスロ：日付を選んで、全台の表をそのまま貼って保存（空白列・「平均」行は自動で無視）
4. アナスロの更新が遅い日は ③ 個別台（民レポの機種ページの表）で代用。後でアナスロが入ると自動で上書き
5. 同じ日の民レポとアナスロがそろうと、機種名・台数・G数の種類を自動で照合します（④に結果）

### 機種名の照合について
- バラエティ（1台設置）の台は、台番号で自動照合（例：「アニマルスロット ドッチ」＝「ドッチ」）
- 通常の機種は「台数」と「平均差枚（誤差3%以内）」で候補を出すので、④で「同じ機種として登録」を押す（1回だけでOK）
- アナスロが2機種を1つの名前でまとめている場合（沖ドキGOLD＋ゴージャス）は、混ざっている方の個別台データを③に一度貼ると、台番号で振り分けるようになります

### G数の種類（自動判定）
同じ日の民レポ（総回転数）とアナスロの平均G数を比べ、機種ごとに「通常時G数」か「総回転数」かを判定します。
一度でも通常時と判定された機種は通常時（信頼度の上限3900）、そうでなければ総回転数（上限8000）で計算します。

---

## 保存の仕組み（事故防止）
- アナスロ・民レポは **週（月曜起点）ごとのキー＋日付の索引** に分けて保存（1キー約0.1MB／上限1MB）
- 書き込む前にサイズを測り、1MBを超える場合は書き込まずにエラーを表示
- 同じキーへの書き込みは必ず順番待ち（キュー）。「保存しました」は保存の成功を確認してから表示
- 削除した日付・イベント等は右下の「操作履歴」から元に戻せます

## 確率表の追加（対象機種が決まったら）
`src/App.jsx` の `SETTING_PROFILES` に追加します（形式はファイル内のコメント参照）。
登録の無い機種は「店内の合算確率の順位」による暫定の読み取りで動きます。

## 開発・検証
```bash
npm install
npm run dev                       # http://localhost:5173
npm run build                     # 本番ビルド

# テスト（jsdom・esbuild は検証用。package.json には入れていません）
npm install --no-save jsdom@24 esbuild@0.21
node test/build_test_bundle.mjs   # storage をメモリ版（1MB上限つき）に差し替えてバンドル
node test/render_test.mjs         # 実サンプルを貼り付けて保存→画面を確認

# バックテスト（エクスポートJSONを使う）
node tools/backtest.mjs tamaya-honten-export-YYYY-MM-DD.json
```

## 構成
- `src/App.jsx` … アプリ本体（前半＝パーサー・機種名照合・エンジン、後半＝画面）
- `src/storage.js` … Firestore 保存（キュー・1MB上限チェック）
- `src/firebase.js` … Firebase 接続設定（★玉屋本店用の値を貼る）
- `public/manifest.json` / `public/sw.js` / `public/icons/` … PWA
- `tools/backtest.mjs` … 定期バックテスト　`docs/backtest_instructions.md` … その手順
- `test/` … テスト（`test/samples/` は本店の実サンプル）
