# DevDeck/waypoint 共有 Azure DevOps キャッシュ設計

- 日付: 2026-08-29 (v2: 中立な共有キャッシュ方式に変更)
- 対象リポジトリ: DevDeck (本リポジトリ) と waypoint (`C:\Users\<user>\source\repos\waypoint`、別リポジトリ)
- スコープ: 両アプリが同じ Azure DevOps 組織を独立にポーリングし、API 呼び出しとローカルストレージが重複していた問題を解消する。

## 背景

DevDeck は Tauri アプリで、5 分間隔のバックグラウンドループ (`sync/runner.rs`) が Active PR・
Review PR・Work Item・Commit を SQLite (`azdodeck.sqlite3`) へ同期する。waypoint は Windows
タスクトレイ常駐のランチャーで、Quick Launch の `az` プレフィックスから同じ組織の PR /
Pipeline / Work Item を検索するために、自前で 12 時間ごとのフル同期 + Quick Launch 起動時の
差分同期を行い、別の SQLite (`azure_devops.db`) にキャッシュしていた。同じユーザー・同じ
組織/プロジェクトに対して両アプリが独立にポーリングするため、API 呼び出しが二重になり、
ローカルストレージも同じ情報を二重に持っていた。

## v1 からの変更

最初の設計 (v1) は waypoint が DevDeck の SQLite (`azdodeck.sqlite3`) を読み取り専用で直接
参照する一方向の依存だった。実装コストは低いが、waypoint が DevDeck の**内部スキーマ**
(テーブル名・列名) に直接依存する形になり、「互いのアプリの存在を意識せず、対等に同期する」
という要件を満たさなかった。DevDeck が起動していない間は waypoint 側のデータが更新されない
一方向の依存でもあった。v2 ではどちらの内部スキーマにも属さない中立な第三のキャッシュへ
両アプリが読み書きする形に変更した。

## 決定した設計 (v2)

- **中立な共有キャッシュ**: `%APPDATA%\AzDoSharedCache\cache.db`。DevDeck・waypoint のどちらの
  クレート/型も import しない。スキーマは Azure DevOps の生の事実のみを持ち、`is_mine` の
  ような per-viewer の判断は持たない (各アプリが自分の `authenticated_user_id` と
  `created_by_id` / レビュアー一覧を突き合わせて自分で計算する)。
  ```sql
  pull_requests(organization, project, repository_id, repository_name, pull_request_id,
                title, status, created_by, created_by_id, creation_date,
                source_ref_name, target_ref_name, is_draft, web_url)
  pull_request_reviewers(organization, project, repository_id, pull_request_id,
                          reviewer_id, vote, is_required)
  work_items(organization, project, id, title, work_item_type, state, assigned_to,
             assigned_to_unique_name, changed_date, web_url, tags)
  sync_state(organization, project, kind, synced_at, synced_by, last_error)  -- ヘッダ。エントリ本体とは独立
  cache_meta(key, value)  -- schema_version
  ```
- **鮮度判定は呼び出し側のポリシー**: `sync_state` を見て「直近 (自分でも相手でも) 更新済みか」
  だけを判定する。しきい値は両アプリで揃える必要はなく、各アプリが自分の同期間隔に合わせて
  選ぶ (DevDeck は 2 分、waypoint は 10 分。理由は後述)。
- **Pipeline**: どちらのアプリも元々永続キャッシュしていなかった (DevDeck はオンデマンド API
  呼び出しのみ) ため、共有キャッシュの対象外のまま。waypoint は `az pipeline ` に入るたびに
  明示的な選択 (Enter) をトリガーに Live 検索する (`search_pipelines_live_async`、v1 のまま)。
- **PR の Completed/Abandoned 履歴 (過去 90 日ぶん)**: DevDeck は Active PR しか同期しない
  仕様上の制約があり対象外。waypoint 自身の SQLite キャッシュとして維持する
  (12 時間ごとのバックグラウンド同期は履歴分だけ、v1 のまま)。

### DevDeck 側の変更

- 新規 `src-tauri/src/shared_cache/` (`mod.rs` / `pull_requests.rs` / `work_items.rs`):
  上記スキーマの読み書きヘルパー。DevDeck は Active PR について読み書き両方、Work Item は
  書き込みのみ実装する (理由は下記「非対称にした理由」)。
- `prs/sync_fetch.rs::fetch_active_prs_for_project`: 呼び出しの先頭で共有キャッシュの鮮度を
  確認し、直近 2 分以内に更新済みなら Azure DevOps API を叩かずそこから読んだ内容を
  `CachedPr` へ変換して返す。古ければ従来通り取得し、成功後に結果 (と `reviewers` 配列から
  抽出したレビュアー一覧) を共有キャッシュへも書く。
- `work_items/sync.rs::fetch_project_work_items`: 「全件」取得結果を毎回共有キャッシュへ
  書き込む (読み取りゲートなし)。フル同期なら `write_work_items` (全置換)、差分同期なら
  `upsert_work_items` (差分件だけ upsert、既存行を消さない) を使い分ける
  (`was_full_sync` を `do_sync_work_items` から渡す)。
- `pull_requests.created_by_id` (SCHEMA_VERSION 20 で追加した列) はそのまま DevDeck 内部で
  使う。共有キャッシュへ書く際のソースになるだけで、直接公開されるわけではない。

### waypoint 側の変更

- `azure_devops/devdeck_cache.rs` を削除し、`azure_devops/shared_cache/` (`mod.rs` /
  `pull_requests.rs` / `work_items.rs`) に置き換え。DevDeck 側と同じスキーマに対する
  読み書きヘルパー (waypoint は PR も Work Item も読み書き両方実装)。
- `cache.rs` に `identity` テーブルを追加。`cached_candidates` はネットワークに触れない
  同期経路 (Quick Launch のキー入力経路) なので、is_mine 判定に要る「自分の
  `authenticated_user_id`」をその場で解決できない。`api.rs::refresh_project` が
  (PR/Work Item 取得の成否・スキップに関わらず毎回) `current_user_id` を解決してこの
  テーブルへ書いておき、`cached_candidates` はここを同期的に読む。
- `api.rs::refresh_project`: PR の Completed/Abandoned 履歴は従来通り取得・
  `replace_project_cache` へ保存。Active PR と Work Item は共有キャッシュの鮮度を見て
  スキップ判定し、取得した場合は共有キャッシュにだけ書く (waypoint 自身の DB には複製
  しない)。
- `mod.rs::cached_candidates` / `cached_work_item_candidates`: 共有キャッシュを直接読み、
  is_mine は `created_by_id` / レビュアー一覧と `cache::read_identity` を突き合わせて計算する。

### 非対称にした理由 (DevDeck の Work Item は書き込みのみ)

DevDeck の Work Item 同期はフル/差分の 2 モードと「全件」「自分の担当分」の 2 系統が絡み合う
既存ロジックで、読み取りスキップを安全に組み込むには "フル相当として扱うか差分として
upsert するか" の判断をプロジェクト単位で持ち回る必要があり、リスクに見合わないと判断した。
DevDeck 自身の同期間隔 (5分) が waypoint (10分しきい値で判定) より確実に新しいため、
書き込みのみでも実用上の効果はほぼ変わらない。PR 側は同期ロジックがシンプルなので
双方向にした。

## 既知の制約 (非対応)

DevDeck は「複数組織のうち 1 つだけがアクティブ同期対象」という制約がある
(`active_organization_id`)。実行環境では組織が 1 つ (`aksh0402`) しかないため問題にならないが、
将来 DevDeck で 2 つ目の組織を追加した場合、waypoint がそちらのプロジェクトも監視していると
同期されず空になる。今回のスコープ外として明記する。

## 検証

- DevDeck: `cargo test --workspace` (231 + 154 + 6 件、全パス)、
  `cargo clippy --workspace --all-targets -- -D warnings`、`cargo fmt` (変更ファイルのみ)。
- waypoint: `cargo test` (lib 138 件 + 各統合テストバイナリ、全パス)、
  `cargo clippy --all-targets -- -D warnings`、`cargo fmt` (変更ファイルのみ)。
