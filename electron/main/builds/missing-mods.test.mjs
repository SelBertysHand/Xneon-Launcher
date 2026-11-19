import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { collectMissingFiles, parseCurseforgeFileId } from "./missing-mods-utils.ts"

test("parses CurseForge file ids only from download URLs", () => {
  assert.equal(parseCurseforgeFileId("https://www.curseforge.com/minecraft/mc-mods/example/download/7420614"), 7420614)
  assert.equal(parseCurseforgeFileId("https://example.invalid/file/7420614"), null)
  assert.equal(parseCurseforgeFileId(undefined), null)
})

test("collects missing pack files and ignores traversal patterns", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xneon-missing-mods-"))
  try {
    fs.mkdirSync(path.join(root, "mods"), { recursive: true })
    fs.writeFileSync(path.join(root, "mods", "present.jar"), "test")
    const entries = [
      { displayName: "Present", pattern: "present.jar", destination: "mods" },
      { displayName: "Missing", pattern: "missing.jar", destination: "mods" },
      { displayName: "Traversal", pattern: "..\\outside.jar", destination: "mods" },
      { displayName: "Absolute", pattern: path.join(root, "outside.jar"), destination: "mods" },
    ]
    assert.deepEqual(collectMissingFiles(root, entries).map(item => item.pattern), ["missing.jar"])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
