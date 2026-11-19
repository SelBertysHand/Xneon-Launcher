import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { Xnlc, createLaunchAuth } from "@xnlc/core"

const root = path.join(process.env.RUNNER_TEMP ?? process.cwd(), "xneon-minecraft-client-smoke")
const resourceDir = path.join(root, "shared-resources")
const latestLog = path.join(root, "logs", "latest.log")
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const screenshotsDir = path.join(root, "screenshots")
await fs.mkdir(screenshotsDir, { recursive: true })

function readScreenText() {
  const screenshot = path.join(screenshotsDir, "current.png")
  const capture = spawnSync("scrot", [screenshot], { encoding: "utf8" })
  if (capture.status !== 0) throw new Error("Could not capture the virtual Minecraft screen: " + capture.stderr)
  const ocr = spawnSync("tesseract", [screenshot, "stdout", "--psm", "6", "tsv"], { encoding: "utf8" })
  if (ocr.status !== 0) throw new Error("Could not OCR the Minecraft screen: " + ocr.stderr)
  const groups = new Map()
  for (const row of ocr.stdout.split(/\\r?\\n/).slice(1)) {
    const fields = row.split("\\t")
    if (fields.length < 12 || fields[0] !== "5" || !fields[11]?.trim()) continue
    const key = fields.slice(2, 5).join(":")
    const left = Number(fields[6]), top = Number(fields[7])
    const width = Number(fields[8]), height = Number(fields[9])
    const current = groups.get(key) ?? { left, top, right: left + width, bottom: top + height, words: [] }
    current.left = Math.min(current.left, left)
    current.top = Math.min(current.top, top)
    current.right = Math.max(current.right, left + width)
    current.bottom = Math.max(current.bottom, top + height)
    current.words.push(fields[11].trim())
    groups.set(key, current)
  }
  return [...groups.values()].map(group => ({
    ...group,
    text: group.words.join(" "),
    normalized: group.words.join("").toLowerCase().replace(/[^a-z0-9]/g, ""),
  }))
}

async function clickScreenText(phrase, minimumY = 0, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let lastText = []
  while (Date.now() < deadline) {
    lastText = readScreenText()
    const match = lastText
      .filter(line => line.normalized.includes(phrase) && (line.top + line.bottom) / 2 >= minimumY)
      .sort((a, b) => a.top - b.top)[0]
    if (match) {
      const x = Math.round((match.left + match.right) / 2)
      const y = Math.round((match.top + match.bottom) / 2)
      const click = spawnSync("xdotool", ["mousemove", String(x), String(y), "click", "1"], { encoding: "utf8" })
      if (click.status !== 0) throw new Error("Could not click Minecraft UI text " + phrase + ": " + click.stderr)
      console.log("Clicked Minecraft UI: " + match.text + " at " + x + "," + y)
      await sleep(1800)
      return
    }
    await sleep(1200)
  }
  throw new Error("Could not find Minecraft UI text " + phrase + ". OCR saw: " + lastText.map(line => line.text).join(" | "))
}

await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(root, { recursive: true })
await fs.writeFile(path.join(root, "options.txt"), [
  "renderDistance:2",
  "simulationDistance:2",
  "graphicsMode:0",
  "clouds:0",
  "particles:2",
].join("\\n") + "\\n")

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

  console.log("Minecraft reached the title screen. Creating a disposable singleplayer world.")
  await clickScreenText("singleplayer")
  await clickScreenText("createnewworld", 450)
  await clickScreenText("createnewworld", 450)

  console.log("Waiting for Minecraft to generate and enter the singleplayer world.")
  const worldDeadline = Date.now() + 180_000
  let worldDirectory = null
  while (Date.now() < worldDeadline) {
    if (closed || child.exitCode !== null) {
      throw new Error("Minecraft closed while creating the test world: " + JSON.stringify(closeInfo))
    }
    const savesDir = path.join(root, "saves")
    const worlds = await fs.readdir(savesDir, { withFileTypes: true }).catch(() => [])
    const latest = await fs.readFile(latestLog, "utf8").catch(() => "")
    const spawnReady = /Preparing spawn area: 100%|Loaded \\d+ advancements/i.test(latest)
    for (const entry of worlds) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(savesDir, entry.name)
      const level = await fs.stat(path.join(candidate, "level.dat")).catch(() => null)
      const session = await fs.stat(path.join(candidate, "session.lock")).catch(() => null)
      const regionFiles = await fs.readdir(path.join(candidate, "region")).catch(() => [])
      if (level?.isFile() && session?.isFile() && (spawnReady || regionFiles.some(file => file.endsWith(".mca")))) {
        worldDirectory = candidate
        break
      }
    }
    if (worldDirectory) break
    await sleep(2000)
  }

  if (!worldDirectory) {
    const latest = await fs.readFile(latestLog, "utf8").catch(() => "")
    throw new Error("Minecraft did not create a playable singleplayer world within 180 seconds. " + latest.slice(-7000))
  }
  await sleep(15_000)
  if (closed || child.exitCode !== null) {
    throw new Error("Minecraft closed after creating the singleplayer world: " + JSON.stringify(closeInfo))
  }
  console.log("PASS: Minecraft 1.20.1 created and entered a singleplayer world: " + path.basename(worldDirectory))
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
