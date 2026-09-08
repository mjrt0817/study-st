# ST A-1 Trainer V3.4

## V3.4 追加機能

- 2025・2024・2023年度の公式A-1 90問を年度横断で復習
- 「今日のおすすめ10問」：誤答、知らなかった、迷った、弱点分野を自動優先
- 「間違えた／迷った／知らなかった」別の復習モード
- 弱点TOP3から分野指定で公式問題を10問出題
- 復習回答もSupabaseへ保存し、次回おすすめに反映
- ホームに公式90問の回答済み数、直近正答率、要復習件数を表示

Supabaseのテーブル構成・RLS・環境変数はV3.3から変更ありません。追加SQLは不要です。

## V3.3 追加内容

- IPA公式 **2025年度・2024年度・2023年度**のA-1（旧 午前Ⅰ）を各30問、合計90問に拡張
- ホームから年度別に公式30問を開始可能
- 公式PDFプロキシを `?year=2025|2024|2023` に対応
- 各年度30問について正解、分野、小分野、復習ポイント、PDFページを登録
- 3年分の公式回答履歴を同じ「分野別成績」「弱点判定」に集約
- Supabaseのテーブル構造はV3.0から変更なし（追加SQL不要）

### 更新方法

現在のV3.2をV3.3のファイルで上書きしてGitHubへpushしてください。Supabase SQLの再実行や環境変数の追加は不要です。

---

ITストラテジスト 科目A-1の個人学習用Webアプリです。

## V3.1の主な変更

- 2025年度（令和7年度）春期 高度試験 午前Ⅰの公式過去問30問モードを追加
- 問題本文・図表はIPA公式PDFを画面内表示し、アプリは解答・自信度・採点・復習ポイントを管理
- 30問を一括採点し、結果をSupabaseへ保存
- 問題別の分野タグとオリジナル復習ポイントを追加
- 公式過去問の結果も分野別成績・弱点判定に反映
- 既存DBの変更は不要

## V3までの主な変更

- Googleログイン必須（Supabase Auth）
- 解答履歴をSupabase Databaseへ保存
- ブックマークをSupabaseへ保存
- 「自信あり / 迷った / 知らなかった」を解答履歴と一緒に保存
- JSONで追加した問題もSupabaseへ保存
- 同じGoogleアカウントならPC・スマホ間で進捗同期
- V1/V2でlocalStorageに残っている旧学習データは、初回同期時にSupabaseへ自動移行
- 移行成功後は旧学習データをlocalStorageから削除
- RLSで本人の行だけ読み書き可能

## 最初に必ず行うこと：DB作成

Googleログインが既に動いていても、V3ではDatabase用テーブルが必要です。

1. Supabase Dashboardを開く
2. `SQL Editor` → `New query`
3. このプロジェクトの `supabase/setup.sql` を全て貼り付ける
4. `Run` を押す

作成されるテーブル：

- `study_attempts`
- `study_bookmarks`
- `study_custom_questions`

3表ともRLSが有効になり、`auth.uid()` が一致する本人のデータだけSELECT/INSERT/UPDATE/DELETEできます。

## 環境変数

V2と同じ2つだけです。Secret Keyは使用しません。

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

Vercelにも Project Settings → Environment Variables から同じ値を設定してください。

## Google OAuth

V2ですでにGoogleログインできている場合、変更不要です。

新規設定の場合はSupabase AuthenticationでGoogle Providerを有効化し、Google Cloud側のOAuth ClientとSupabase側のRedirect URLを設定してください。

## データ同期の動き

ログイン直後：

1. 旧localStorageデータを確認
2. 存在すればSupabaseへupsert
3. 移行成功後、旧localStorageデータを削除
4. Supabaseから最新の学習履歴・ブックマーク・追加問題を読み込み

学習中：

- 回答するたび `study_attempts` に1行保存
- ★ブックマーク操作を即時同期
- JSON問題追加時に `study_custom_questions` へupsert
- ホーム画面の「再同期」でクラウドの最新状態を再読込

Supabaseへの保存に失敗した回答は「保存済み」と見なさず、画面上の履歴も元へ戻します。

## 学習機能

- ランダム10問
- A-1模擬（最大30問）
- 分野指定出題
- 誤答だけ再出題
- 苦手優先出題（低正答率・誤答・「知らなかった」）
- 理解度記録
- ブックマーク
- 分野別正答率
- JSON問題追加

## デプロイ

```bash
npm install
npm run build
```

ビルド成功後、GitHubへpushするとVercel側で再デプロイされます。

## 問題データについて

`data/questions.ts` の標準20問は動作確認用のオリジナル問題です。
IPA公式過去問そのものはまだ同梱していません。

公式過去問を追加する場合は、年度・期・試験区分・時間区分・問番号などの出典を明記してください。

公式過去問一覧：
https://www.ipa.go.jp/shiken/mondai-kaiotu/index.html

追加形式は `sample-question-template.json` を参照してください。

## 次の開発候補

1. 2024年度以前の公式A-1セット追加
2. 間隔反復（翌日 / 3日後 / 7日後）
3. A-2追加
4. B-1記述・B-2論文管理
5. 社労士問題データへの横展開


## 2025年度公式A-1モードについて

問題本文・選択肢・図表はアプリに複製せず、IPA公式PDFを参照します。アプリ側には問番号、正解、分野タグ、学習用のオリジナル復習ポイントを保持します。

- 問題PDF: `data/officialA1.ts` の `OFFICIAL_A1_2025_PDF`
- 解答PDF: `OFFICIAL_A1_2025_ANSWER_PDF`
- 正答・分野タグ: `officialA1Questions2025`

PDFが端末内で埋め込み表示できない場合も「PDFを別タブで開く」から利用できます。


## V3.2: 公式PDFがアプリ内に表示されない場合への対応

V3.1ではIPA公式PDFを外部URLのままiframeへ埋め込んでいましたが、ブラウザや配信側の制約により表示できない場合がありました。V3.2では `/api/official-pdf` から同一オリジン経由で公式PDFを取得して表示します。

- Supabaseの追加SQLは不要です。
- Vercelの環境変数変更も不要です。
- 画面上の「PDFを別タブで開く」は公式IPA URLへ直接開くフォールバックとして残しています。
- APIルートは固定のIPA公式PDFだけを取得し、任意URLは受け付けません。