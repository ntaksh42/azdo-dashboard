# DevDeck/waypoint 共有 Azure DevOps キャッシュ設計

- 日付: 2026-08-29
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

## 決定した設計

- **Active PR・Work Item**: DevDeck の SQLite (`%APPDATA%\com.azdodeck.app\azdodeck.sqlite3`)
  を唯一の情報源にする。waypoint はこれを読み取り専用で直接参照し (`azure_devops::devdeck_cache`)、
  自前のバックグラウンド同期を廃止した。DevDeck 側は waypoint の存在を意識しない一方向の依存。
- **Pipeline**: DevDeck 側に元々キャッシュが無い (オンデマンド API 呼び出しのみ) ため、
  waypoint 側も永続キャッシュを廃止し、`az pipeline ` に入るたびに明示的な選択 (Enter) を
  トリガーに Live 検索する形に変更した (`search_pipelines_live_async`)。
- **PR の Completed/Abandoned 履歴 (過去 90 日ぶん)**: DevDeck は Active PR しか同期しない
  仕様上の制約があるため対象外。waypoint 自身の SQLite キャッシュとしてそのまま維持する
  (12 時間ごとのバックグラウンド同期は履歴分だけに縮小)。

### DevDeck 側の変更

- `SCHEMA_VERSION` 19 → 20。`pull_requests` に `created_by_id TEXT` 列を追加するマイグレーション
  ステップを追加 (`db/migrate.rs`)。waypoint の is_mine 判定 (作成者 GUID との一致) に必要。
  既存の PR 取得コードは元々 `createdBy.id` を取得していたが破棄していたため、新規 API 呼び出しは
  不要 (`prs/sync_fetch.rs`)。
- `db/prs.rs` の `CachedPr` / INSERT・SELECT 文に `created_by_id` を追加。
- `docs/spec-overview.md` にスキーマの「外部消費者」節を追加し、`AGENTS.md` にも
  `pull_requests` / `work_items` / `review_pull_requests` / `organizations` が waypoint との
  契約になっている旨を注記した。

### waypoint 側の変更

- 新規 `azure_devops/devdeck_cache.rs`: DevDeck の DB を `SQLITE_OPEN_READ_ONLY` で開き、
  `pull_requests` (Active) と `work_items` を `organizations` と JOIN して Quick Launch の
  `Candidate` へ変換する。is_mine は `created_by_id = organizations.authenticated_user_id`
  OR `review_pull_requests` に該当行が存在するか、で判定する。`created_by_id` 列が無い
  古い DevDeck の DB (マイグレーション未適用) では `prepare` が失敗するので、その場合は
  レビュアー判定のみのクエリへフォールグレードする。DevDeck の DB が無い/開けない場合は
  空リストを返して継続する。
- `azure_devops::api::fetch_pull_requests` → `fetch_pull_request_history` に縮小し、Active の
  取得を削除 (Completed/Abandoned のみ)。`refresh_project` から Pipeline・Work Item の取得を
  削除し、PR 履歴の同期だけを行う。
- `azure_devops::sync::refresh_work_items_delta_async` を削除 (DevDeck が Work Item の鮮度を
  担うため不要)。新規 `search_pipelines_live_async` / `PipelineFilter` (旧 `quick_launch::azure`
  から `azure_devops` へ移設) を追加。
- Quick Launch 側 (`quick_launch_window`) に Pipeline 用のライブ検索状態・`Action::AzureLivePipelineSearch`
  を、既存の PR/Work Item ライブ検索と同じ形で追加。
- `docs/spec.md` の FR-9.18.1 / FR-9.18.3 を更新。

## 既知の制約 (非対応)

DevDeck は「複数組織のうち 1 つだけがアクティブ同期対象」という制約がある
(`active_organization_id`)。実行環境では組織が 1 つ (`aksh0402`) しかないため問題にならないが、
将来 DevDeck で 2 つ目の組織を追加した場合、waypoint がそちらのプロジェクトも監視していると
同期されず空になる。今回のスコープ外として明記する。

## 検証

- DevDeck: `cargo test --workspace` (222 + 154 + 6 件、全パス)、
  `cargo clippy --workspace --all-targets -- -D warnings`、`cargo fmt`。
- waypoint: `cargo test` (lib 136 件 + 各統合テストバイナリ、全パス)、
  `cargo clippy --all-targets -- -D warnings`、`cargo fmt`。
