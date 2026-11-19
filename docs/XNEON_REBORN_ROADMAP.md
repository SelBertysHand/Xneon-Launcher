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
- [ ] Full IPC/UI map and test baseline.
- [ ] World backup implementation.
- [ ] Structured crash diagnostics.
- [ ] Safe repair/verification.
- [ ] Java hardening and dependency planner comparison.
- [ ] Build and packaging verification.
