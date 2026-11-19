import { test } from "node:test"
import assert from "node:assert/strict"
import { parseExtraJvmArgs, splitCommandLine, substituteLaunchVars } from "./launch-args.ts"

test("parses quoted JVM arguments with spaces", () => {
  assert.deepEqual(parseExtraJvmArgs('-Xmx4G -Dname="value with spaces" -XX:+UseG1GC'), [
    "-Xmx4G", "-Dname=value with spaces", "-XX:+UseG1GC",
  ])
})

test("preserves Windows backslashes in quoted executable paths", () => {
  assert.deepEqual(splitCommandLine('"C:\\Program Files\\Java\\bin\\java.exe" -version'), [
    "C:\\Program Files\\Java\\bin\\java.exe", "-version",
  ])
})

test("splits quoted arguments and preserves escaped quotes", () => {
  assert.deepEqual(splitCommandLine('tool.exe "one two" "say \\"hello\\""'), [
    "tool.exe", "one two", 'say "hello"',
  ])
})

test("substitutes known launch variables without erasing unknown placeholders", () => {
  const context = {
    instName: "My Pack", instId: "pack-1", gameDir: "C:\\Games\\My Pack",
    javaPath: "C:\\Java\\bin\\java.exe", mcVersion: "1.20.1",
    loaderType: "fabric", loaderVersion: "0.16.10", javaArgs: "-Xmx4G",
    accountName: "Player", accountUuid: "uuid-1", accountAccessToken: "secret-token",
  }
  assert.equal(substituteLaunchVars('$INST_NAME $MC_VERSION $UNKNOWN $AUTH_PLAYER_NAME', context),
    "My Pack 1.20.1 $UNKNOWN Player")
  assert.equal(substituteLaunchVars('${INST_JAVA} ${INST_JAVA_ARGS}', context),
    'C:\\Java\\bin\\java.exe -Xmx4G')
})
