import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { Xnlc, createLaunchAuth } from "@xnlc/core"
import { getQuickPlayArguments } from "@xnlc/core/game-features"

const root = path.join(process.env.RUNNER_TEMP ?? process.cwd(), "xneon-minecraft-gameplay-smoke")
const serverDir = path.join(root, "server")
const clientDir = path.join(root, "client")
const resourceDir = path.join(root, "shared-resources")
const serverLogPath = path.join(serverDir, "logs", "latest.log")
const clientLogPath = path.join(clientDir, "logs", "latest.log")
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(serverDir, { recursive: true })
await fs.mkdir(clientDir, { recursive: true })

const javaCheck = spawnSync("java", ["-version"], { encoding: "utf8" })
if (javaCheck.status !== 0) throw new Error("Java 17 is not available: " + (javaCheck.stderr || javaCheck.error?.message || "unknown error"))
console.log("Java 17 is available.")

let server = null
let client = null
let serverOutput = ""
let serverClosed = false
let clientClosed = false

function appendServerOutput(chunk) {
  const value = chunk.toString()
  serverOutput = (serverOutput + value).slice(-30000)
  process.stdout.write("[Minecraft server] " + value)
}

function terminate(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" })
  } else {
    child.kill("SIGTERM")
  }
}

async function waitFor(predicate, timeoutMs, description, readLog) {
  const deadline = Date.now() + timeoutMs
  let last = ""
  while (Date.now() < deadline) {
    if (await predicate()) return last
    if (readLog) {
      try { last = await readLog() } catch {}
    }
    await sleep(1500)
  }
  throw new Error(description + "\n" + last.slice(-7000))
}

try {
  console.log("Fetching official Minecraft 1.20.1 server metadata.")
  const manifestResponse = await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
  if (!manifestResponse.ok) throw new Error("Mojang version manifest HTTP " + manifestResponse.status)
  const manifest = await manifestResponse.json()
  const versionEntry = manifest.versions.find(entry => entry.id === "1.20.1")
  if (!versionEntry) throw new Error("Minecraft 1.20.1 is missing from the Mojang manifest.")
  const versionResponse = await fetch(versionEntry.url)
  if (!versionResponse.ok) throw new Error("Minecraft version metadata HTTP " + versionResponse.status)
  const versionJson = await versionResponse.json()
  const serverDownload = versionJson.downloads?.server
  if (!serverDownload?.url || !serverDownload?.sha1) throw new Error("Official server download metadata is incomplete.")

  const serverJar = path.join(serverDir, "server.jar")
  const serverResponse = await fetch(serverDownload.url)
  if (!serverResponse.ok) throw new Error("Minecraft server download HTTP " + serverResponse.status)
  const serverBytes = Buffer.from(await serverResponse.arrayBuffer())
  const serverSha1 = crypto.createHash("sha1").update(serverBytes).digest("hex")
  if (serverSha1 !== serverDownload.sha1) throw new Error("Minecraft server JAR SHA-1 mismatch.")
  await fs.writeFile(serverJar, serverBytes)
  await fs.writeFile(path.join(serverDir, "eula.txt"), "eula=true\n")
  await fs.writeFile(path.join(serverDir, "server.properties"), [
    "server-ip=127.0.0.1",
    "server-port=25565",
    "online-mode=false",
    "enforce-secure-profile=false",
    "max-players=2",
    "motd=Xneon Reborn automated gameplay test",
    "level-name=world",
    "spawn-protection=0",
    "view-distance=4",
    "simulation-distance=4",
    "enable-command-block=false",
    "allow-flight=true",
  ].join("\n") + "\n")

  console.log("Starting a disposable local offline-mode Minecraft server.")
  server = spawn("java", ["-Xms512M", "-Xmx1G", "-jar", serverJar, "nogui"], {
    cwd: serverDir,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, JAVA_TOOL_OPTIONS: "" },
  })
  server.stdout.on("data", appendServerOutput)
  server.stderr.on("data", appendServerOutput)
  server.once("close", (code, signal) => { serverClosed = true; console.log("[Minecraft server] closed", code, signal) })
  server.once("error", error => { serverClosed = true; console.error("[Minecraft server] process error", error) })

  await waitFor(
    () => /Done \([^)]+\)! For help, type "help"/i.test(serverOutput),
    180_000,
    "Minecraft test server did not become ready.",
    async () => serverOutput,
  )
  console.log("PASS: local Minecraft server is ready.")

  const launcher = new Xnlc({
    gameDir: clientDir,
    resourceDir,
    javaRoot: root,
    customVersionsDir: path.join(resourceDir, "versions"),
    launcherName: "Xneon Reborn Gameplay Smoke",
    launcherVersion: "1.0.7",
  })
  launcher.javaRunner.setPipeOutputToConsole(true)

  const rawVersion = await launcher.metaClient.fetchVersionJson("1.20.1")
  const resolvedVersion = await launcher.versionResolver.resolveVersionFromJson(rawVersion, launcher.osInfo)
  const nativeLibraries = launcher.librariesManager.resolveLibraries(resolvedVersion).filter(library => library.isNative)
  if (nativeLibraries.length === 0) {
    throw new Error("No Linux native libraries were resolved; LWJGL cannot initialize.")
  }
  console.log("Resolved " + nativeLibraries.length + " Linux native libraries.")

  const quickPlayArgs = getQuickPlayArguments("1.20.1", {
    path: path.join(clientDir, "logs", "quick_play"),
    multiplayer: "127.0.0.1:25565",
  })
  if (!quickPlayArgs.some(arg => arg === "--quickPlayMultiplayer")) {
    throw new Error("Quick Play multiplayer arguments were not generated for Minecraft 1.20.1.")
  }

  console.log("Launching Minecraft client with an offline profile and Quick Play to the local server.")
  const launch = await launcher.launch(
    { mcVersion: "1.20.1", loaderType: "vanilla" },
    createLaunchAuth({ type: "offline", username: "XneonSmoke" }),
    { memoryMin: "512M", memoryMax: "2G", width: 1024, height: 720, gameArgs: quickPlayArgs },
    progress => {
      if (progress.percent !== undefined && (progress.percent === 100 || progress.percent % 10 === 0)) {
        console.log("[Minecraft client] " + (progress.installationPhase ?? progress.type ?? "preparing") + ": " + progress.percent + "%")
      }
    },
  )
  client = launch?.process
  if (!client?.pid) throw new Error("XNLC did not return a Minecraft client process.")
  client.once("close", (code, signal) => { clientClosed = true; console.log("[Minecraft client] closed", code, signal) })

  await waitFor(
    async () => {
      if (clientClosed || client.exitCode !== null) throw new Error("Minecraft client exited before joining the test server.\n" + serverOutput.slice(-7000))
      const serverLog = await fs.readFile(serverLogPath, "utf8").catch(() => serverOutput)
      return /XneonSmoke joined the game|XneonSmoke\[\/.*logged in with entity id/i.test(serverLog)
    },
    180_000,
    "Minecraft client did not join the local server within 180 seconds.",
    async () => {
      const serverLog = await fs.readFile(serverLogPath, "utf8").catch(() => serverOutput)
      const clientLog = await fs.readFile(clientLogPath, "utf8").catch(() => "")
      return "SERVER:\n" + serverLog + "\nCLIENT:\n" + clientLog
    },
  )
  console.log("PASS: XneonSmoke joined the local Minecraft 1.20.1 server.")
  await sleep(5000)
  if (clientClosed || client.exitCode !== null) throw new Error("Minecraft client closed immediately after joining the test server.")
} finally {
  terminate(client)
  terminate(server)
  await Promise.race([
    Promise.all([
      client && !clientClosed ? new Promise(resolve => client.once("close", resolve)) : Promise.resolve(),
      server && !serverClosed ? new Promise(resolve => server.once("close", resolve)) : Promise.resolve(),
    ]),
    sleep(12_000),
  ])
}
