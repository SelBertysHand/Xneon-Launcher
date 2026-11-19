import fs from "node:fs/promises"
import path from "node:path"
import { Xnlc, createLaunchAuth } from "@xnlc/core"

const root = path.join(process.env.RUNNER_TEMP ?? process.cwd(), "xneon-minecraft-client-smoke")
const resourceDir = path.join(root, "shared-resources")
const latestLog = path.join(root, "logs", "latest.log")
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(root, { recursive: true })

const launcher = new Xnlc({
  gameDir: root,
  resourceDir,
  javaRoot: root,
  customVersionsDir: path.join(resourceDir, "versions"),
  launcherName: "Xneon Reborn Client Smoke",
  launcherVersion: "1.0.7",
})
launcher.javaRunner.setPipeOutputToConsole(true)

const rawVersion = await launcher.metaClient.fetchVersionJson("1.20.1")
const resolvedVersion = await launcher.versionResolver.resolveVersionFromJson(rawVersion, launcher.osInfo)
const nativeLibraries = launcher.librariesManager.resolveLibraries(resolvedVersion).filter(library => library.isNative)
if (nativeLibraries.length === 0) {
  throw new Error("No platform native libraries were resolved for " + JSON.stringify(launcher.osInfo) + ".")
}
console.log("Resolved " + nativeLibraries.length + " native libraries for " + JSON.stringify(launcher.osInfo) + ".")

const auth = createLaunchAuth({ type: "offline", username: "XneonSmoke" })
console.log("Downloading and launching vanilla Minecraft 1.20.1 with a disposable offline profile.")

let child = null
let closed = false
let closeInfo = null
const hardTimeout = setTimeout(() => {
  if (child && child.exitCode === null) child.kill("SIGKILL")
  console.error("Minecraft client smoke test exceeded the 15-minute safety limit.")
  process.exit(1)
}, 15 * 60 * 1000)

try {
  const launch = await launcher.launch(
    { mcVersion: "1.20.1", loaderType: "vanilla" },
    auth,
    { memoryMin: "512M", memoryMax: "2G", width: 1024, height: 720 },
    progress => {
      if (progress.percent !== undefined && (progress.percent === 100 || progress.percent % 10 === 0)) {
        console.log("[Minecraft client] " + (progress.installationPhase ?? progress.type ?? "preparing") + ": " + progress.percent + "%")
      }
    },
  )

  child = launch?.process
  if (!child?.pid) throw new Error("XNLC did not return a running Minecraft process.")
  child.once("close", (code, signal) => {
    closed = true
    closeInfo = { code, signal }
  })

  console.log("Minecraft Java process started (PID " + child.pid + "); waiting for OpenAL and title-screen initialization.")
  const deadline = Date.now() + 180_000
  let initialized = false
  let lastLog = ""

  while (Date.now() < deadline) {
    if (closed || child.exitCode !== null) {
      throw new Error("Minecraft exited before client initialization: " + JSON.stringify(closeInfo) + "\n" + lastLog.slice(-7000))
    }
    try {
      lastLog = await fs.readFile(latestLog, "utf8")
      if (/Sound engine started|OpenAL initialized on device/i.test(lastLog)) {
        initialized = true
        break
      }
    } catch {
      // Minecraft has not created latest.log yet.
    }
    await sleep(1500)
  }

  if (!initialized) {
    throw new Error("Minecraft did not initialize its sound engine within 180 seconds.\n" + lastLog.slice(-7000))
  }

  // Allow the renderer and title screen to finish loading after sound startup.
  await sleep(15_000)
  if (closed || child.exitCode !== null) {
    throw new Error("Minecraft closed immediately after client initialization: " + JSON.stringify(closeInfo) + "\n" + lastLog.slice(-7000))
  }
  lastLog = await fs.readFile(latestLog, "utf8").catch(() => lastLog)
  if (!/Setting user: XneonSmoke/i.test(lastLog)) {
    throw new Error("Minecraft log did not confirm the disposable test profile.\n" + lastLog.slice(-7000))
  }

  console.log("PASS: Minecraft 1.20.1 initialized LWJGL/OpenAL and remained running under the virtual display.")
} finally {
  clearTimeout(hardTimeout)
  if (child && !closed && child.exitCode === null) {
    child.kill("SIGTERM")
    await Promise.race([
      new Promise(resolve => child.once("close", resolve)),
      sleep(10_000).then(() => {
        if (child.exitCode === null) child.kill("SIGKILL")
      }),
    ])
  }
}
