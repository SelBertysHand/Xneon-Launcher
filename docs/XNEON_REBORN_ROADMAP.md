# Xneon Reborn — migration roadmap

> Working branch: `xneon-reborn`  
> Base: `main`  
> Architecture target: Electron + React + TypeScript. Millida's Tauri runtime will not be embedded in the app.

## Goals

Keep Xneon's launcher, UI, account integrations, content providers and packaging. Bring across useful Millida capabilities by adapting their behavior to Xneon's existing Electron/TypeScript services. Do not copy Millida's Tauri command layer, updater, authentication backend, proprietary service endpoints, credentials, or branding.

## Verified starting point

### Already present in Xneon

- Minecraft launch orchestration in Electron, with a separate worker process.
- Java runtime manager in `packages/xnlc-core/src/core/java-manager.ts`; it checks a configured Java path, a previously downloaded Mojang runtime and system Java, and can download a runtime.
- Mod dependency inspection from JAR metadata in `electron/main/mods-jar-deps.ts`.
- Loader-version requirement checks in `electron/main/mods-loader-requirements.ts`.
- Basic crash detection in `electron/main/crash-detect.ts` (exit code and recent crash-report file).
- Millida profile discovery/import in `electron/main/import/millida.ts`.
- Electron Builder configuration with Windows NSIS and ZIP targets.

### Useful Millida areas identified for a port/adaptation

- `src-tauri/src/engine/game/java.rs`: broader Java discovery and runtime integrity checks.
- `src-tauri/src/engine/game/repair.rs` and `src-tauri/src/engine/game/install.rs`: integrity checking and safe restoration of managed content.
- `src-tauri/src/engine/game/crashcause.rs` and `crashfix.rs`: crash-log classification and actionable diagnostics.
- `src-tauri/src/engine/profiles/backups.rs`: world snapshots and backup rotation.
- `src-tauri/src/engine/content/deps.rs`: dependency planning and version-conflict handling.

## Migration order

1. **Baseline and safety**
   - Preserve `main`; all changes go to `xneon-reborn`.
   - Identify Xneon's existing IPC contracts, profile paths, database schema and UI entry points before changing behavior.
   - Keep destructive operations opt-in and validate all paths against the selected profile.

2. **World backups**
   - Add safe ZIP snapshots for worlds, with atomic completion (temporary file then rename).
   - Add per-world automatic snapshot retention without deleting user-created backups.
   - Trigger a snapshot before risky profile/content updates only when the world has changed since the previous snapshot.
   - Expose progress and errors through typed IPC and the existing UI patterns.

3. **Crash diagnostics**
   - Upgrade the current crash/no-crash detector into a structured report.
   - Classify common causes (missing dependencies, incompatible loader/mod, Java mismatch, out-of-memory, graphics driver, authentication noise, unknown).
   - Redact local paths, account names and tokens before displaying or sharing diagnostics.
   - Offer only reversible, profile-scoped actions and require confirmation before changing files.

4. **Repair and verification**
   - Verify managed files using trusted catalog hashes and/or official manifests.
   - Restore only from trusted Modrinth/CurseForge/Mojang sources and verify hashes after download.
   - Never execute or fetch arbitrary URLs embedded in untrusted profile metadata.
   - Report checked, restored, skipped and refused files separately.

5. **Java runtime hardening**
   - Compare Millida's platform-specific discovery and integrity checks with the existing JavaManager.
   - Add only missing checks; retain Xneon's Mojang runtime support and user-selected Java path.
   - Never modify system Java installations or PATH.

6. **Dependency and compatibility improvements**
   - Compare Millida's range/conflict planner with Xneon's existing JAR metadata inspector and loader requirement checker.
   - Reuse Xneon's current Modrinth/CurseForge clients and caches where possible.
   - Keep unresolved constraints visible rather than silently treating them as compatible.

7. **Verification and packaging**
   - Add unit tests for new logic and IPC validation.
   - Run typecheck/build and platform packaging where the environment permits.
   - If Windows packaging cannot be run in the current environment, use a Windows CI workflow and report its actual result.

## Guardrails

- No changes to `main` from this work.
- No embedding of Tauri inside Electron.
- No copying service secrets, API keys, signing keys, or user data.
- No automatic deletion/quarantine of mods or worlds without explicit confirmation.
- Preserve existing Xneon features and UI; avoid parallel implementations where Xneon already has equivalent functionality.
- Re-check the exact license files and third-party dependency licenses before copying source code. Millida's Cargo manifest declares `GPL-3.0-only`; the Xneon README advertises GPL-3.0. This is a compatibility signal, not a substitute for a full license review.

## Current status

- [x] Fork access verified with repository write permission.
- [x] Created `xneon-reborn` from `main`.
- [x] Initial source audit: Java manager, crash detector, mod dependency checks and Millida import are present in Xneon.
- [x] IPC/UI map for the touched world, launch, preload and log flows; CI baseline established.
- [~] World backups: manual/history restore and pre-delete snapshots implemented; automatic retention/rotation and global recovery after deleting a world remain.
- [x] Structured crash diagnostics: bounded parsing, common cause classification, path/account/token redaction and tests.
- [~] Safe repair/verification: CurseForge missing-file repair now checks API-provided SHA-1/size and publishes atomically; full instance-wide integrity scan remains.
- [~] Java hardening: downloaded Mojang/Azul runtime major versions are checked; full Azul archive hash verification and deeper platform matrix tests remain.
- [~] Dependency/compatibility: Xneon's JAR dependency and loader-range inspectors are retained; a broader Millida-style cross-mod conflict planner remains.
- [~] CI typecheck, diagnostics tests, renderer build and Electron build pass on verified commits; Windows installer packaging and runtime smoke tests remain.


## Progress update — world backups

Implemented on `xneon-reborn`:
- ZIP snapshots stored under each instance's `.xneon-backups/worlds` directory.
- Snapshot creation rejects symbolic links and writes to a temporary archive before atomic rename.
- The instance world panel exposes a manual backup action.
- Latest-backup restore creates a separate restored world folder; it does not overwrite the source world.
- World deletion first requires a successful fresh backup; deletion is cancelled if backup creation fails.
- Backup list/delete IPC methods are available for the upcoming backup manager UI.

Verification status:
- GitHub contents for the changed main/preload/contracts/UI files were re-fetched and checked.
- TypeScript typecheck, automated tests, runtime behavior, and Windows packaging have not yet been executed in this environment.
- Backup restore currently restores the latest snapshot for a selected world; selecting an arbitrary historical snapshot is a follow-up UI task.


## Progress update — backup manager and crash diagnostics

- Added a backup history panel to the world details view with timestamp, archive size, restore, and delete actions.
- Restore now accepts a selected backup filename and always imports it into a separate world folder.
- Added bounded crash-report parsing (1 MiB), basic secret/path redaction, cause classification, likely mod markers, and actionable troubleshooting hints.
- Crash diagnosis is sent through the existing `minecraft:close` event and rendered in the existing Logs page; no raw crash-report body is sent to the renderer.
- Added `.github/workflows/ci.yml` for branch pushes and pull requests. It builds workspace packages, runs TypeScript checks, and builds renderer + Electron.

Verification still pending:
- GitHub files are committed, but CI must run before claiming the branch compiles.
- The CI workflow needs the repository's `FORGEJO_TOKEN` secret to install private workspace packages from `git.xneon.org`; if that secret is unavailable in the fork, dependency installation will fail before compilation.
- Runtime validation on Windows and actual Minecraft crash fixtures are still required.


## Progress update — import safety and first CI feedback

- World ZIP imports now extract into a temporary directory, parse and validate `level.dat`, then publish by same-volume rename. Failed imports clean up the staging directory instead of leaving partial saves.
- World folder names are sanitized and bounded, including Windows reserved device names.
- First CI execution successfully installed dependencies and built all seven workspace packages. TypeScript then found missing declarations for the new backup methods on the composed `ElectronAPI` type and an invalid AdmZip type reference.
- Both issues have been corrected in the latest branch commits. A fresh CI run is required to confirm the fixes and validate the atomic-import change.


## Progress update — repair integrity and Java runtime validation

- CurseForge file metadata now exposes the official SHA-1 hash when available.
- Missing-mod repair validates the catalog file length and SHA-1 before installing, writes to a unique temporary file, then renames atomically.
- Modpack-provided destination names are constrained to plain filenames inside the instance's `mods` or `resourcepacks` directory; symlinked/out-of-root destination directories are refused.
- Mojang and Azul Java downloads now have their detected major version checked against the requested runtime before being accepted. Azul's unverified leftover archive is not reused after a failed extraction.
- Crash diagnostics additionally classify common authentication/session failures and redact account identifiers and macOS/Linux/Windows home-directory usernames.
- Added tests for crash classification and redaction. GitHub Actions has passed TypeScript, diagnostics tests, renderer and Electron builds on earlier commits; the latest backup identity/IPC changes are currently being validated.


## Progress update — backup lifecycle, compatibility ranges and CI

- World backups are now explicitly labeled manual or automatic. Automatic pre-delete snapshots retain the newest 10 copies per world; manual backups are never removed by rotation.
- Backup creation and world deletion are blocked while the selected instance is running, avoiding snapshots of actively changing save files.
- Backup listing and deletion are scoped to the selected world using a collision-resistant identity; a folder shortcut remains available even when no worlds are left, so copies made before deletion can still be imported manually.
- Loader version ranges now handle SemVer caret (`^`) and tilde (`~`) upper bounds plus `||` alternatives; Maven interval support remains.
- Added regression tests for crash diagnosis/privacy and version-range compatibility.
- Latest verified CI run for commit `30e4d390` passed: workspace packages, TypeScript, all tests, renderer build and Electron build.
- Added an opt-in Windows packaging workflow. It runs only when a commit message contains `[package-windows]`, and uploads the NSIS installer plus portable ZIP as a 7-day Actions artifact.

Remaining:
- Windows packaging run and installation smoke test.
- Full in-app runtime testing with real worlds and representative modpacks.
- Global in-app recovery browsing for backups belonging to worlds already deleted; the backup directory shortcut currently provides manual recovery.
- Broader cross-mod conflict planning beyond the existing declared-dependency and loader-range checks.


## Progress update — Windows packaging and fork update channel

- The Windows workflow successfully built the app, generated the NSIS installer and portable ZIP, and uploaded the `Xneon-Reborn-Windows` artifact (about 453 MB total). The artifact is available from the Actions run page and expires after 7 days.
- Package metadata and electron-updater's GitHub publish target now point to `SelBertysHand/Xneon-Launcher`, not the upstream XneonTeam repository. This prevents a Reborn build from following the upstream release feed.
- The first Windows artifact was produced immediately before the fork update-target change. A fresh Windows package is being triggered from the latest branch head so the downloadable build contains the correct update target and the final backup/import safety fixes.
