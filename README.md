# 忘年会 ベッティングクイズ

部署忘年会のテーブル対抗ベッティングクイズ。Vue 3 + Firebase（Firestore / Hosting / Authentication）。
仕様書 v0.2 準拠。要決定事項は以下で確定済みです。

| 項目 | 確定内容 |
| --- | --- |
| 問題数 | 全7問・4択 |
| 配当 | 第1〜6問は2倍、第7問（最終問題）は3倍 |
| 初期コイン | 1,000 |
| 賭け金 | 100単位・最低100・上限は所持コイン（全額可） |
| 0コインの救済 | 正解で +100（最終問題も +100） |
| 送信後の変更 | 不可（ルール側でロック） |
| 未送信のまま締切 | 100を賭けて不正解として精算（0コインのテーブルは ±0） |
| 制限時間 | 20秒（演出のみ。締切は司会の手動操作） |
| 復活ボーナス | 第4問前に司会が「全テーブル一律ボーナス」を実行（既定 +200） |

## 画面

| URL | 用途 | 端末 |
| --- | --- | --- |
| `/` | 入室（テーブル選択＋合言葉） | 各テーブルのスマホ |
| `/play` | 回答画面 | 各テーブルのスマホ |
| `/screen` | スクリーン表示 | プロジェクター接続PC |
| `/admin` | 司会用コンソール | 司会PC |
| `/qr` | テーブル別QRシート（印刷用） | 司会PC |

テーブル別QRは `/?t=1` 〜 `/?t=7`。読み込むとテーブル番号が自動で選ばれます。

---

## 1. Firebase側のセットアップ（最初に1回だけ）

1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成（**無料のSparkプランで足ります**）
2. **Firestore Database** を作成（ロケーション: `asia-northeast1`、モードはどちらでもよい。ルールは後でデプロイする）
3. **Authentication** を有効化し、プロバイダで次の2つをON
   - 匿名（各テーブルの端末用）
   - メール / パスワード（司会用）
4. Authentication > Users で**司会アカウントを1つ作成**（例: `host@example.com`）
5. プロジェクトの設定 > マイアプリ で**ウェブアプリを追加**し、`firebaseConfig` をコピー
6. `cp .env.example .env` して `firebaseConfig` の値を貼る（`src/config.js` に直接書いてもよい）
7. `cp .firebaserc.example .firebaserc` してプロジェクトIDを書く
8. **司会アカウントのUIDを `firestore.rules` の `hostUids()` に貼る**
   - UIDは Authentication > Users で確認できます
   - `/admin` で司会アカウントにログインすると画面にもUIDが表示されます（未登録の場合はその旨のメッセージが出ます）
9. ルールとアプリをデプロイ

```bash
npm install -g firebase-tools   # 初回のみ
firebase login                  # ブラウザ認証。Claude Code からは「! firebase login」で実行
npm install
npm run deploy                  # ビルド → Hosting + Firestoreルール をデプロイ
```

## 2. 初期データの作成（管理画面から）

1. `https://<プロジェクト>.web.app/admin` を開いて司会アカウントでログイン
2. 「設定」タブ → **合言葉**を入力して **［初期データを作成］**
   - `game/main`、`tables/1..7`、`questions/1..7`、`config/secret` が作られます
3. 同じ画面で **テーブル名**と**問題7問（問題文・4択・正解）**を入力して保存
   - 正解はラジオボタンで指定します
   - 第7問は自動で配当3倍になります
4. 「QRシート」を開いて印刷し、各テーブルに1枚ずつ置く

> 問題文はFirestoreに入るので、**当日その場で修正しても再デプロイは不要**です。

## 3. 当日の進行（1問の流れ）

司会コンソールの「進行」タブのボタンを上から順に押すだけです。

| 操作 | 何が起きるか |
| --- | --- |
| ① 問題表示・受付開始 | `phase=answering`。スマホに問題と4択、スクリーンにカウントダウンが出る |
| （各テーブルが送信） | 送信と同時にスクリーンへ賭け金が公開される（回答は隠す） |
| ② 締切 | 未送信があれば確認ダイアログが出る。`phase=closed` |
| ③ 正解発表 | 正解がスクリーンとスマホに出る。`phase=revealed` |
| ④ 精算実行 | コインを増減。1問につき1回だけ実行される。`phase=settled` |
| ⑤ ランキング | 順位と前問からの変動をスクリーンに表示。`phase=ranking` |
| ⑥ 次の問題へ | 次の問題の待機画面へ。第7問の前は「最終問題 配当3倍」の演出が出る |

- 第4問を始める前に「補填・演出」タブの **［全テーブルに反映］**（既定 +200）を実行すると、復活ボーナスがスクリーンのランキングに即時反映されます
- 最終問題の精算後は「最終順位」タブで順位を確定 → 終了画面になります
  - 同点があると警告が出ます。じゃんけんの結果に合わせて順位の数字を入れ替えて［確定］

## 4. トラブル対応

| 症状 | 対応 |
| --- | --- |
| スマホが壊れた・電池切れ | 別の端末で同じQRを読み、合言葉を入れれば入り直せます（紐付けは上書きされます） |
| それでも入れない | 「進行」タブの［代理入力］で司会が賭け金と回答を入力 |
| テーブルが誤操作で送信した | ［取消］で送信を削除 → そのテーブルに再送信させる |
| 入室するテーブルを間違えた | ［端末解除］でそのテーブルの紐付けを外し、正しいQRから入り直してもらう |
| 精算後に間違いに気づいた | ［精算のやり直し］でコインを戻す（正解を直して再精算）か、「補填・演出」タブでコインを調整 |
| 回線が切れた | 再接続すると現在のフェーズに自動復帰します（送信済みかどうかもFirestoreから復元） |
| 受付を締め切ったあとに送信させたい | ［受付再開］（カウントダウンも打ち直されます） |

すべての補填・代理入力・取消・やり直しは「ログ」タブに記録されます。

## 5. ローカル開発

```bash
npm run dev          # http://localhost:5173
npm test             # 精算ロジックのテスト（node:test）
npm run check:rules  # セキュリティルールの検証（実機のFirebaseに接続）
npm run build
```

実機のFirebaseに直接つなぐのが手軽です。エミュレータを使う場合は `.env` で
`VITE_USE_EMULATOR=1` にして `firebase emulators:start` を起動してください
（**Firestoreエミュレータの実行にはJavaが必要**です。未インストールなら `brew install openjdk`）。

## 6. データ構造（Firestore）

```
game/main                         phase, currentQ, timeLimitSec, startedAt, announcement, updatedAt
tables/{1..7}                     name, coins, correctCount, finalRank
questions/{1..7}                  no, text, choices[4], multiplier
answers/{1..7}                    correctIndex                      ← 司会のみ読める
reveals/{q}                       correctIndex, revealedAt          ← 正解発表時に司会がコピーする
submissions/{q}/items/{tableId}   questionNo, tableId, bet, answerIndex, submittedAt, isProxy, uid
publicBets/{q}/items/{tableId}    tableId, bet, submittedAt         ← スクリーン公開用（賭け金のみ）
settlements/{q}                   settledAt, multiplier, correctIndex, results{tableId: {...}}
claims/{uid}                      tableId                           ← 端末とテーブルの紐付け
presence/{tableId}                at, uid                           ← 接続状況
logs/{autoId}                     type, tableId, before, after, delta, reason, at
config/secret                     passphrase                        ← 司会のみ。ルール内の get() で照合
```

仕様書の `submissions/{q}_{tableId}` はサブコレクション `submissions/{q}/items/{tableId}` に変更しています。
セキュリティルールでドキュメントIDと「現在の問題番号」「自分のテーブル」を厳密に突き合わせるためです
（他テーブルのIDで先に書き込んで妨害する、といったことができなくなります）。

正解は `answers/{q}` に置き、司会以外は読めません。正解発表のタイミングで司会が `reveals/{q}` に
コピーすることで全画面に見えるようになります。

## 7. セキュリティ

- 賭け金のバリデーション（100の倍数・100以上・所持コイン以下、0コインなら0のみ）はルール側でも検証
- 送信は `phase=answering` のときだけ作成でき、更新は不可（送信後ロック）。取り消しは司会だけ
- 他テーブルの回答は読めない（スクリーンに出るのは `publicBets` の賭け金のみ）
- `coins` / `game` / `questions` / `answers` / `settlements` / `logs` を書けるのは司会UIDのみ
- 合言葉は `config/secret` に置き、ルール内の `get()` でのみ照合する（クライアントに平文を置かない）

### ルールの検証

実機のプロジェクトに対して「匿名ユーザー（テーブル端末）に何が許可/拒否されるか」を確認できます。
成功する書き込みは行わないので、実行してもデータは残りません。

```bash
npm run check:rules
```

2026-11-17 時点で18項目すべて想定どおり（正解・合言葉・ログの読み取り拒否、コインやフェーズの
書き換え拒否、間違った合言葉での入室拒否、紐付けの無い端末からの送信拒否 など）。

正常系（正しい合言葉で入室 → 送信 → 送信後は変更不可）は、合言葉を設定したあとに
実機のスマホで一度試してください。
