# ST A-1 Trainer

ITストラテジスト 科目A-1の個人学習用Webアプリです。

## V2の主な変更

- Googleログイン（Supabase Auth）を追加
- 未ログイン時は学習画面を表示しない
- 学習履歴・ブックマーク・追加問題を `Supabase user.id` ごとに分離
- 学習履歴自体は引き続きブラウザの localStorage に保存

> 重要：現段階では端末間同期はしません。同じGoogleアカウントでも、別PC・スマホでは別の学習履歴になります。次段階でSupabase Databaseへ移行すれば同期できます。

## 学習機能

- ランダム10問
- A-1模擬（最大30問）
- 分野指定出題
- 誤答だけ再出題
- 苦手優先出題（低正答率・誤答・「知らなかった」）
- 「自信あり / 迷った / 知らなかった」の理解度記録
- ブックマーク
- 分野別正答率
- JSONによる問題追加

## Googleログイン設定

### 1. Supabaseプロジェクトを用意

Supabaseで新規プロジェクトを作成するか、この学習アプリ専用のプロジェクトを用意します。

### 2. Google OAuthを有効化

Supabase Dashboard → Authentication → Providers → Google を開きます。

そこに表示される Callback URL を控えます。一般的には次の形式です。

```text
https://<PROJECT_REF>.supabase.co/auth/v1/callback
```

### 3. Google Cloud側でOAuthクライアントを作成

Google Auth Platform / Google Cloud Consoleで「Web application」のOAuth Clientを作成します。

Authorized JavaScript origins 例：

```text
http://localhost:3000
https://your-app.vercel.app
```

Authorized redirect URIs には、Supabase側に表示されたCallback URLを登録します。

```text
https://<PROJECT_REF>.supabase.co/auth/v1/callback
```

発行されたGoogle Client ID / Client SecretをSupabaseのGoogle Provider設定へ登録します。

### 4. SupabaseのRedirect URLを設定

Supabase Dashboard → Authentication → URL Configuration で設定します。

Site URL（本番）：

```text
https://your-app.vercel.app
```

Redirect URLs：

```text
http://localhost:3000/**
https://your-app.vercel.app/**
```

### 5. 環境変数を設定

`.env.example` を `.env.local` にコピーします。

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

Supabase DashboardのProject Settings / API KeysからURLとPublishable Keyを取得してください。

Vercelへデプロイするときも、同じ2つを Project Settings → Environment Variables に登録します。

## ローカル起動

```bash
npm install
npm run dev
```

ブラウザで http://localhost:3000 を開きます。

## Vercel

GitHubへこのフォルダをpushし、VercelでImportします。
その後、上記2つの環境変数をVercelへ登録して再デプロイしてください。

## データ保存について

V2ではログイン必須ですが、学習データはまだlocalStorageです。
保存キーにSupabaseの `user.id` を含めているため、同一ブラウザでもGoogleアカウントごとに履歴が分離されます。

次段階では以下をSupabase Databaseへ移す予定です。

- 解答履歴
- ブックマーク
- 理解度
- カスタム問題

その際はRow Level Security (RLS)で `auth.uid()` の行だけ読み書きできるようにします。

## 問題データについて

`data/questions.ts` の標準20問は、アプリ動作確認用に作成したオリジナル問題です。
IPA公式過去問そのものはまだ同梱していません。

IPA公式過去問を利用する場合は、年度・期・試験区分・時間区分・問番号等の出典を明記してください。

公式過去問一覧:
https://www.ipa.go.jp/shiken/mondai-kaiotu/index.html

追加データ形式は `sample-question-template.json` を参照してください。

## standalone版について

`standalone/index.html` はV1のUI確認用です。Google認証がないため、本番運用には使用しないでください。

## 次の開発候補

1. IPA公式A-1過去問データ投入
2. Supabase Databaseへ学習履歴を同期
3. 間隔反復（翌日/3日後/7日後）
4. A-2追加
5. B-1記述・B-2論文管理
6. 社労士問題データへの横展開
