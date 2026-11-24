# NanoGit — instructions for agents

NanoGit is a light git monitor for Windows (Tauri 2 + Svelte 5 + Rust, the same stack as
github.com/hulbo/ServicesDashboard). Its user hands git work (commit, push, branch) to AI agents and
uses NanoGit to **watch** what happened: live working-tree changes, an activity timeline from the
reflog, commits waiting to be pushed, and an enhanced file history. The layout follows SourceTree.
The repository is public (github.com/hulbo/NanoGit): tests, samples and docs use made-up names.

## Working here
- Talk to the user in Korean. UI text, docs and commit messages are Korean too.
- Personal project: when a change is built, tested and checked, commit and push to `origin main`
  without asking. Ask first only for destructive git operations.
- Monitoring comes first. Queries (`git/query.rs`, `git/reflog.rs`) never change the repository and
  run with `GIT_OPTIONAL_LOCKS=0` so they never take `index.lock` from an agent.
- Direct operations (M3) live only in `git/ops.rs` behind the single `git_op` command: only what the
  user picked and confirmed in the UI, refused in read-only mode, one at a time per repository. Files
  are sent to the Recycle Bin before being discarded or overwritten; force push is `--force-with-lease`
  only. Flows (dialogs, confirmations) are in `src/lib/actions.ts`.
- User-supplied revisions go through `git::check_rev` (no leading `-`); paths always follow `--`.

## Layout
- `src-tauri/src/git/`: `mod.rs` runs git (no window, timeouts, CP949 fallback), `parse.rs` pure
  parsers, `query.rs` queries, `reflog.rs` the activity timeline, `ops.rs` direct operations,
  `model.rs` the IPC data.
- `src-tauri/src/watch.rs`: notify watcher, batches changes per repo into `repo://changed`.
- `src/lib/state.svelte.ts`: tabs (`Repo`) and what to refresh on a change; `src/lib/mock.ts` is the
  browser-preview backend (keep it in step with `api.ts`).
- Docs: `README.md` front page, `docs/PLANNING.md` plan and milestones, `docs/DEVELOPMENT.md` build
  and structure. A user-visible change updates README's feature table when it changes the front page.

## Releases
- Only when the user asks. `npm run version:set -- X.Y.Z`, write `docs/releases/vX.Y.Z.md` (Korean),
  commit and push `main`, then push an annotated tag `vX.Y.Z`. CI checks the versions, builds, and
  publishes the GitHub release with the installer (see `docs/DEVELOPMENT.md`).
- In-app updates: CI signs the installer with the `TAURI_SIGNING_PRIVATE_KEY` secret and uploads
  `latest.json` (`scripts/latest-json.mjs`); the app checks `releases/latest`. The private key lives
  outside the repo (`%USERPROFILE%\.tauri\nanogit.key`); never commit it or print it.

## Checks before committing
- `npm run check`, `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml`
- Look at the change in the browser preview (`npm run dev`, mock backend at http://localhost:1421)
  or the app (`npm run tauri dev`).
