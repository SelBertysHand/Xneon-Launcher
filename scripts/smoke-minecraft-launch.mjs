import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { Xnlc, createLaunchAuth } from "@xnlc/core"

const root = path.join(process.env.RUNNER_TEMP ?? process.cwd(), "xneon-minecraft-offline-smoke")
const resourceDir = path.join(root, "shared-resources")
const latestLog = path.join(root, "logs", "latest.log")
await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(root, { recursive: true })

const javaCheck = spawnSync("java", ["-version"], { encoding: "utf8", shell: true })
if (javaCheck.status !== 0) throw new Error("Java 17 is not available on PATH: " + (javaCheck.stderr || javaCheck.error?.message || "unknown error"))
console.log("Java runtime check passed.")

const launcher = new Xnlc({
  gameDir: root,
  resourceDir,
  javaRoot: root,
  customVersionsDir: path.join(resourceDir, "versions"),
  launcherName: "Xneon Reborn Smoke",
  launcherVersion: "1.0.7",
})
launcher.javaRunner.setPipeOutputToConsole(true)

const auth = createLaunchAuth({ type: "offline", username: "XneonSmoke" })
console.log("Preparing and launching vanilla Minecraft 1.20.1 with a disposable offline profile.")

let child = null
let closed = false
let closeInfo = null
let hardTimeout = null

try {
  hardTimeout = setTimeout(() => {
    if (child?.pid) spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" })
    console.error("Minecraft offline smoke test exceeded the 15-minute safety limit.")
    process.exit(1)
  }, 15 * 60 * 1000)

  const launch = await launcher.launch(
    { mcVersion: "1.20.1", loaderType: "vanilla" },
    auth,
    { memoryMin: "512M", memoryMax: "2G", width: 960, height: 540 },
    progress => {
      const phase = progress.installationPhase ?? progress.type ?? "preparing"
      const file = progress.fileName ?? progress.currentFile ?? ""
      if (progress.percent !== undefined) console.log("[Minecraft smoke] " + phase + ": " + progress.percent + "% " + file)
    },
  )

  child = launch?.process
  if (!child?.pid) throw new Error("XNLC did not return a running Minecraft process.")
  child.once("close", (code, signal) => {
    closed = true
    closeInfo = { code, signal }
  })

  console.log("Minecraft Java process started (PID " + child.pid + "); waiting for the client to initialize.")
  const deadline = Date.now() + 120_000
  let clientReady = false
  let lastLog = ""

  while (Date.now() < deadline) {
    if (closed || child.exitCode !== null) {
      throw new Error("Minecraft exited before reaching the client-ready marker: " + JSON.stringify(closeInfo) + "\n" + lastLog.slice(-6000))
    }
    try {
      lastLog = await fs.readFile(latestLog, "utf8")
      if (/Sound engine started|OpenAL initialized on device/i.test(lastLog)) {
        clientReady = true
        break
      }
    } catch {
      // Minecraft has not created latest.log yet.
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  if (!clientReady) {
    throw new Error("Minecraft process stayed alive but did not reach the client-ready marker within 120 seconds.\n" + lastLog.slice(-6000))
  }
  console.log("PASS: vanilla Minecraft 1.20.1 initialized its client and sound engine.")
} finally {
  if (hardTimeout) clearTimeout(hardTimeout)
  if (child?.pid && !closed && child.exitCode === null) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" })
    await Promise.race([
      new Promise(resolve => child.once("close", resolve)),
      new Promise(resolve => setTimeout(resolve, 10_000)),
    ])
  }
}
