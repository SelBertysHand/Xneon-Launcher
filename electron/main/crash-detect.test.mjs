import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { diagnoseMinecraftCrash, findRecentCrashReport } from "./crash-detect.ts"

function withReport(contents, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xneon-crash-test-"))
  const reports = path.join(root, "crash-reports")
  fs.mkdirSync(reports)
  const report = path.join(reports, "crash-test.txt")
  fs.writeFileSync(report, contents, "utf8")
  try {
    return run(root, report)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test("diagnoses Java heap exhaustion", () => {
  withReport("java.lang.OutOfMemoryError: Java heap space\n", (_root, report) => {
    const result = diagnoseMinecraftCrash(report, 1)
    assert.equal(result.category, "memory")
    assert.match(result.title, /оперативной памяти/i)
    assert.ok(result.advice.length > 0)
  })
})

test("identifies Mixin failures and extracts mod identifiers", () => {
  withReport("Mixin apply failed\nMod ID: sample_mod\n", (_root, report) => {
    const result = diagnoseMinecraftCrash(report, 1)
    assert.equal(result.category, "mixin")
    assert.deepEqual(result.suspectedMods, ["sample_mod"])
  })
})

test("does not return raw secrets or report contents", () => {
  withReport("java.lang.IllegalStateException: test failure\naccess_token=super-secret-value\n", (_root, report) => {
    const result = diagnoseMinecraftCrash(report, 1)
    const serialized = JSON.stringify(result)
    assert.equal(serialized.includes("super-secret-value"), false)
    assert.equal(serialized.includes("access_token="), false)
  })
})

test("finds only crash reports newer than the launch timestamp", () => {
  withReport("java.lang.RuntimeException: failure\n", (root, report) => {
    assert.equal(findRecentCrashReport(root, Date.now() - 10_000), report)
    assert.equal(findRecentCrashReport(root, Date.now() + 60_000), null)
  })
})

test("handles missing crash reports without throwing", () => {
  const result = diagnoseMinecraftCrash(null, 17)
  assert.equal(result.category, "unknown")
  assert.match(result.summary, /17/)
})

test("redacts account identifiers and local home paths", () => {
  withReport("username=alex email=alex@example.test\\n/home/alex/.minecraft/crash-reports/test.txt\\n", (_root, report) => {
    const result = diagnoseMinecraftCrash(report, 1)
    const serialized = JSON.stringify(result)
    assert.equal(serialized.includes("alex@example.test"), false)
    assert.equal(serialized.includes("username=alex"), false)
  })
})
