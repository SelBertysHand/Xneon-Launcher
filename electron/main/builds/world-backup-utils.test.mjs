import { test } from "node:test"
import assert from "node:assert/strict"
import { getWorldBackupSourceLabel, isSafeBackupFileName } from "./world-backup-utils.ts"

test("recognizes current automatic and manual backup filenames", () => {
  const stamp = "2026-11-19T20-05-23-000Z"
  assert.equal(getWorldBackupSourceLabel(`manual-My_World-0123456789-${stamp}-abcdef12.zip`), "My World")
  assert.equal(getWorldBackupSourceLabel(`automatic-My_World-0123456789-${stamp}-abcdef12.zip`), "My World")
})

test("recognizes legacy backup filenames", () => {
  assert.equal(getWorldBackupSourceLabel("Old_World-2026-11-19T20-05-23-000Z-abcdef12.zip"), "Old World")
})

test("rejects traversal and non-zip backup paths", () => {
  assert.equal(isSafeBackupFileName("../world.zip"), false)
  assert.equal(isSafeBackupFileName("..\\world.zip"), false)
  assert.equal(isSafeBackupFileName("world.txt"), false)
  assert.equal(isSafeBackupFileName("world.zip"), true)
})
