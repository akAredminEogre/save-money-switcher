# save-money-switcher

新規開発プロジェクト。**CoDD (Coherence-Driven Development)** — 主筋殿下謹製
[yohey-w/codd-dev](https://github.com/yohey-w/codd-dev)（MIT License）— を開発基盤として組み込み、
「要件を書けば、設計→コード→テスト→検証まで CoDD が組み立てる」方式で開発する。

本プロジェクトのプロダクトは **家族クイズ操作盤**（SAVE MONEY 方式）。
**クラウド上で実行する WEB アプリ**である（クラウド上のサーバで制御盤・TV・各解答者タブレットをリアルタイム同期。ホストPCはサーバにしない。本番当日のインターネット接続を前提とする）。※旧記述「ホストPCをローカルサーバとするオフライン完結」は 2026-08-08 の殿御下命により撤回済。
要件は `docs/requirements/requirements.md` に集約し、現在は**残論点の確定段階**である。

## CoDD とは（30秒版）

- 要件・設計・コード・テストの「つながりの地図」を作り、双方向のつじつま合わせ (coherence) を機械にやらせるツール。
- 入り口は `codd greenfield --requirements <file>` の1コマンド。要件 Markdown を渡すと
  init → elicit（仕様の抜け漏れ検出）→ 設計生成 → 実装 → 検証まで無人で回る。
- 組込方式は PyPI パッケージのインストール（`pip install codd-dev` / 本環境は `uv tool install codd-dev` 済）。
  submodule やソースコピーは CoDD の想定利用法ではない。

## セットアップ状態（済）

| 項目 | 状態 |
|------|------|
| codd CLI | `uv tool install codd-dev` 済（`codd version` → 3.37.0、`~/.local/bin/codd`） |
| リポジトリ | 本リポ（git init 済） |
| 要件テンプレート | `docs/requirements/requirements.md`（壁打ちの書き溜め場所） |
| Claude Code スキル | `/codd-greenfield`（repo スコープ、`.claude/skills/`） |

`codd init` は**まだ実行していない**（意図的）。init は `--language` が必須だが、言語はプロダクトが
決まってから選ぶべきもので、`codd greenfield` が未初期化プロジェクトでは init を内部実行してくれる
（`--project-name` / `--language` を greenfield 側で渡せる）ため、事前 init は不要。

## 壁打ちの回し方（殿向け手順）

1. **アイデアを出す** — dashboard（MAS）経由で「save-money-switcher でこういうものを作りたい」と
   指示するか、直接 `docs/requirements/requirements.md` に書き込む。MAS 側の足軽が対話内容を
   requirements.md へ反映して育てていく。
2. **抜け漏れチェック（任意）** — 要件がある程度書けたら:
   ```bash
   cd ~/akAredminEogre-project/save-money-switcher
   codd elicit --interactive
   ```
   業界標準ベースの lexicon（WCAG/OWASP/REST 等 39種）で仕様の穴を指摘してくれる。
3. **要件が固まったら組み立て開始**:
   ```bash
   cd ~/akAredminEogre-project/save-money-switcher
   codd greenfield --requirements docs/requirements/requirements.md \
     --project-name save-money-switcher --language <python|typescript|javascript|go|java>
   ```
   - 先に計画だけ見る: `--dry-run`
   - 中断から再開: `codd greenfield --resume`（チェックポイントは `.codd/greenfield_session.yaml`）
   - Claude Code 内なら `/codd-greenfield` スキルでも可（repo スコープ導入済）。
4. **以後の変更** — 動き出した後は `codd fix "<変えたいことを言葉で>"` / `codd impact` / `codd verify`。

AI 呼び出しは既定で `claude --print`（Opus）を使う（`codd.yaml` の `ai_command` で変更可）。

## 検証済みの起動確認

- `codd version` → 3.37.0
- `codd greenfield --dry-run` が実行計画を表示すること（証跡: MAS リポ `tmp/cmd_2159_verify/`）
