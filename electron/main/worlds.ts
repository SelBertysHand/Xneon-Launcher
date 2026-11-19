import { opFailure } from "./errors"
// ============================================================
// Worlds & Screenshots IPC Handlers
// Per-build save management: list/rename/delete/icon/seed,
// datapacks (local + Modrinth/CurseForge downloads),
// and screenshot gallery.
// ============================================================

import { ipcMain, nativeImage } from "electron"
import path from "path"
import fs from "fs/promises"
import { randomUUID } from "node:crypto"
import type { NBTCompound } from "@xnlc/nbt"
import { ensureBuildIntentDir, downloadBuffer, sanitizeFileName } from "./builds/helpers"
import type { WorldInfo, DatapackInfo, ScreenshotInfo } from "@xnlc/types" with { "resolution-mode": "import" }

type OpResult = { success: boolean; error?: string }

// ---------- Helpers ----------

function getGameDir(buildName: string): Promise<string> {
  return ensureBuildIntentDir(buildName)
}

function resolveWorldPath(savesDir: string, folder: string): string | null {
  if (!folder || folder.includes("/") || folder.includes("\\") || folder === "." || folder === "..") return null
  const worldPath = path.resolve(savesDir, folder)
  const normalizedSaves = `${path.resolve(savesDir)}${path.sep}`
  if (!worldPath.startsWith(normalizedSaves)) return null
  return worldPath
}

function resolveChildPath(parentDir: string, fileName: string): string | null {
  const targetPath = path.resolve(parentDir, sanitizeFileName(fileName))
  const normalizedParent = `${path.resolve(parentDir)}${path.sep}`
  if (!targetPath.startsWith(normalizedParent)) return null
  return targetPath
}

async function folderExists(dirPath: string): Promise<boolean> {
  try {
    await fs.access(dirPath)
    return true
  } catch {
    return false
  }
}

async function uniqueFolderPath(savesDir: string, baseName: string): Promise<string> {
  let base = sanitizeFileName(baseName)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 64)
  if (!base || base === "." || base === "..") base = "world"
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base += "_"
  let candidate = base
  let index = 2
  while (await folderExists(path.join(savesDir, candidate))) {
    candidate = base + "_" + index
    index++
  }
  return candidate
}
function resolveRelativeSafe(destRoot: string, relPath: string): string | null {
  const target = path.resolve(destRoot, relPath)
  const rootNorm = `${path.resolve(destRoot)}${path.sep}`
  if (!target.startsWith(rootNorm)) return null
  return target
}

async function updateLevelName(worldPath: string, newName: string): Promise<void> {
  const level = await readLevelNbt(worldPath)
  if (!level) return
  try {
    const nbt = await import("@xnlc/nbt")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (level as any).Data
    if (data?.LevelName) {
      data.LevelName = newName
      await fs.writeFile(path.join(worldPath, "level.dat"), new nbt.NBTWriter().write(level, { compressed: "gzip" }))
    }
  } catch { /* level.dat update is best-effort */ }
}

/**
 * Кэш размеров каталогов.
 *
 * `dirSize` рекурсивно обходит всё дерево (до 200 000 записей) со `stat` на
 * каждый файл, и вызывался для каждого мира при каждом `worlds:list`. Размер
 * меняется только когда игра пишет в мир, поэтому держим результат с TTL и
 * сбрасываем его при изменении mtime самого каталога (создание/удаление файлов).
 */
const DIR_SIZE_TTL_MS = 60_000
const dirSizeCache = new Map<string, { size: number; dirMtimeMs: number; at: number }>()

async function dirSize(dirPath: string, maxEntries = 200000): Promise<number> {
  let dirMtimeMs = 0
  try {
    dirMtimeMs = (await fs.stat(dirPath)).mtimeMs
  } catch {
    return 0
  }

  const cached = dirSizeCache.get(dirPath)
  if (cached && cached.dirMtimeMs === dirMtimeMs && Date.now() - cached.at < DIR_SIZE_TTL_MS) {
    return cached.size
  }

  let total = 0
  let count = 0
  const walk = async (dir: string): Promise<void> => {
    if (count > maxEntries) return
    let entries: string[] = []
    try { entries = await fs.readdir(dir) } catch { return }
    for (const entry of entries) {
      if (count > maxEntries) return
      count++
      const full = path.join(dir, entry)
      try {
        const stat = await fs.stat(full)
        if (stat.isDirectory()) await walk(full)
        else total += stat.size
      } catch { /* ignore */ }
    }
  }
  await walk(dirPath)
  dirSizeCache.set(dirPath, { size: total, dirMtimeMs, at: Date.now() })
  return total
}

async function readLevelNbt(worldPath: string): Promise<NBTCompound | null> {
  try {
    const nbt = await import("@xnlc/nbt")
    const levelFile = path.join(worldPath, "level.dat")
    const buffer = await fs.readFile(levelFile)
    return new nbt.NBTReader(buffer).read({ compressed: "gzip" })
  } catch {
    return null
  }
}

// ---------- Helpers ----------

function formatBigInt(value: unknown): string {
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "number") return String(Math.trunc(value))
  if (typeof value === "string") return value
  return ""
}

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value) || 0
  return 0
}

function gameModeName(gameType: number): string {
  switch (gameType) {
    case 1: return "Креатив"
    case 2: return "Приключение"
    case 3: return "Наблюдатель"
    default: return "Выживание"
  }
}

function fileToDataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`
}

async function readIconDataUrl(worldPath: string): Promise<string> {
  try {
    const iconPath = path.join(worldPath, "icon.png")
    const buffer = await fs.readFile(iconPath)
    const image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) return ""
    const resized = image.getSize().width > 256 || image.getSize().height > 256 ? image.resize({ width: 256, height: 256 }) : image
    return fileToDataUrl(resized.toPNG(), "image/png")
  } catch {
    return ""
  }
}

function parseWorldFolder(savesDir: string, folder: string): Promise<WorldInfo> {
  return (async () => {
    const worldPath = resolveWorldPath(savesDir, folder)!
    let name = folder
    let seed = ""
    let gameMode = "Выживание"
    let hardcore = false
    let lastPlayed = 0
    let playedTime = 0
    let mcVersion = ""
    let hasLevelData = false

    const level = await readLevelNbt(worldPath)
    if (level) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (level as any).Data
      const levelName = data?.LevelName
      if (typeof levelName === "string" && levelName.trim()) name = levelName
      const randomSeed = data?.WorldGenSettings?.seed ?? data?.RandomSeed
      if (randomSeed !== undefined && randomSeed !== null) seed = formatBigInt(randomSeed)
      const gameType = data?.GameType
      const hardcoreValue = data?.hardcore
      hardcore = hardcoreValue === 1 || hardcoreValue === true
      gameMode = gameModeName(toNumber(gameType))
      lastPlayed = toNumber(data?.LastPlayed)
      const worldTime = data?.Time
      if (worldTime !== undefined) playedTime = Math.max(0, Math.floor(toNumber(worldTime) / 20))
      const versionName = data?.Version
      if (versionName && typeof versionName === "object") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nameValue = (versionName as any)?.Name
        if (typeof nameValue === "string") mcVersion = nameValue
      }
      hasLevelData = true
    }

    if (!seed) {
      try {
        const nbt = await import("@xnlc/nbt")
        const wgsPath = path.join(worldPath, "data", "minecraft", "world_gen_settings.dat")
        const wgsBuffer = await fs.readFile(wgsPath)
        const wgsNbt = new nbt.NBTReader(wgsBuffer).read({ compressed: "gzip" })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wgs = ((wgsNbt as any).data || (wgsNbt as any).Data) as any
        const wgsSeed = wgs?.seed
        if (wgsSeed !== undefined && wgsSeed !== null) seed = formatBigInt(wgsSeed)
      } catch { /* world_gen_settings.dat not found or unreadable */ }
    }

    let sizeBytes = 0
    let lastModified = 0
    let datapackCount = 0
    try {
      const stat = await fs.stat(worldPath)
      lastModified = stat.mtimeMs
      sizeBytes = await dirSize(worldPath)
    } catch { /* ignore */ }

    try {
      const dpDir = path.join(worldPath, "datapacks")
      datapackCount = (await fs.readdir(dpDir).catch(() => [])).length
    } catch { /* ignore */ }

    return {
      folder,
      name,
      seed,
      gameMode,
      hardcore,
      lastPlayed,
      playedTime,
      mcVersion,
      iconDataUrl: await readIconDataUrl(worldPath),
      sizeBytes,
      lastModified,
      path: worldPath,
      datapackCount,
      hasLevelData,
    }
  })()
}

async function listDatapacks(worldPath: string): Promise<DatapackInfo[]> {
  const dpDir = path.join(worldPath, "datapacks")
  let entries: string[] = []
  try { entries = await fs.readdir(dpDir) } catch { return [] }
  const result: DatapackInfo[] = []
  for (const entry of entries) {
    const full = path.join(dpDir, entry)
    try {
      const stat = await fs.stat(full)
      result.push({ name: entry, sizeBytes: stat.size, lastModified: stat.mtimeMs, path: full })
    } catch { /* ignore */ }
  }
  result.sort((a, b) => a.name.localeCompare(b.name))
  return result
}

// ---------- Handlers ----------

async function unpackWorldZip(
  savesDir: string,
  zipBufferOrPath: string | Buffer,
  fallbackName: string,
  newName?: string,
): Promise<OpResult & { folder?: string }> {
  let stagingDir: string | null = null
  let publishedDir: string | null = null
  try {
    const AdmZip = (await import("adm-zip")).default
    const zip = new AdmZip(zipBufferOrPath)
    const entries: Array<{ entryName: string; isDirectory: boolean; getData: () => Buffer }> = zip.getEntries()
    const levelEntry = entries.find(e => !e.isDirectory && e.entryName.replace(/\\/g, "/").split("/").pop() === "level.dat")
    if (!levelEntry) {
      return { success: false, error: "В архиве не найден мир Minecraft (level.dat)" }
    }

    const levelPath = levelEntry.entryName.replace(/\\/g, "/")
    const slashIdx = levelPath.lastIndexOf("/")
    const levelDir = slashIdx === -1 ? "" : levelPath.slice(0, slashIdx)
    const firstSegment = levelDir.split("/").filter(Boolean)[0] ?? ""
    const prefix = firstSegment ? firstSegment + "/" : ""
    const defaultFolderName = firstSegment || fallbackName || "world"
    const trimmedName = newName?.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").slice(0, 64) ?? ""

    await fs.mkdir(savesDir, { recursive: true })
    stagingDir = await fs.mkdtemp(path.join(savesDir, ".xneon-import-"))

    for (const entry of entries) {
      if (entry.isDirectory) continue
      const entryPath = entry.entryName.replace(/\\/g, "/")
      if (prefix && !entryPath.startsWith(prefix)) continue
      const rel = prefix ? entryPath.slice(prefix.length) : entryPath
      const target = resolveRelativeSafe(stagingDir, rel)
      if (!target) continue
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, entry.getData())
    }

    // Validate the extracted save before publishing it into saves/.
    const extractedLevel = await readLevelNbt(stagingDir)
    if (!extractedLevel) {
      await fs.rm(stagingDir, { recursive: true, force: true })
      stagingDir = null
      return { success: false, error: "Архив повреждён: level.dat не удалось прочитать" }
    }

    const destFolder = await uniqueFolderPath(savesDir, (trimmedName || defaultFolderName).replace(/\s+/g, "_"))
    publishedDir = path.join(savesDir, destFolder)
    await fs.rename(stagingDir, publishedDir)
    stagingDir = null

    if (trimmedName) await updateLevelName(publishedDir, trimmedName)
    return { success: true, folder: destFolder }
  } catch (error) {
    if (stagingDir) await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    if (publishedDir) await fs.rm(publishedDir, { recursive: true, force: true }).catch(() => {})
    return opFailure(error)
  }
}

export async function listWorldsForBuild(buildName: string): Promise<WorldInfo[]> {
  try {
    const gameDir = await getGameDir(buildName)
    const savesDir = path.join(gameDir, "saves")
    let folders: string[] = []
    try { folders = (await fs.readdir(savesDir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name) } catch { return [] }
    const worlds = await Promise.all(folders.map(folder => parseWorldFolder(savesDir, folder)))
    worlds.sort((a, b) => b.lastPlayed - a.lastPlayed)
    return worlds
  } catch {
    return []
  }
}


// ---------- World backups ----------

export interface WorldBackupInfo {
  fileName: string
  createdAt: number
  sizeBytes: number
}

function getWorldBackupDir(gameDir: string): string {
  return path.join(gameDir, ".xneon-backups", "worlds")
}

async function collectWorldFiles(root: string, current: string, zip: InstanceType<typeof import("adm-zip").default>): Promise<void> {
  const entries = await fs.readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = path.join(current, entry.name)
    const stat = await fs.lstat(absolute)
    if (stat.isSymbolicLink()) {
      throw new Error(`Резервное копирование остановлено: обнаружена символическая ссылка (${entry.name})`)
    }
    if (stat.isDirectory()) {
      await collectWorldFiles(root, absolute, zip)
      continue
    }
    if (!stat.isFile()) continue
    const relative = path.relative(root, absolute).split(path.sep).join("/")
    zip.addFile(relative, await fs.readFile(absolute))
  }
}

export async function createWorldBackupForBuild(buildName: string, folder: string): Promise<OpResult & { backup?: WorldBackupInfo }> {
  try {
    const gameDir = await getGameDir(buildName)
    const savesDir = path.join(gameDir, "saves")
    const worldPath = resolveWorldPath(savesDir, folder)
    if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }
    const worldStat = await fs.lstat(worldPath)
    if (!worldStat.isDirectory() || worldStat.isSymbolicLink()) {
      return { success: false, error: "Папка мира недоступна для резервного копирования" }
    }

    const backupDir = getWorldBackupDir(gameDir)
    await fs.mkdir(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const safeFolder = sanitizeFileName(folder).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || "world"
    const fileName = `${safeFolder}-${stamp}-${randomUUID().slice(0, 8)}.zip`
    const target = path.join(backupDir, fileName)
    const temporary = `${target}.tmp`

    const AdmZip = (await import("adm-zip")).default
    const zip = new AdmZip()
    await collectWorldFiles(worldPath, worldPath, zip)
    zip.writeZip(temporary)
    await fs.rename(temporary, target)
    const stat = await fs.stat(target)
    return { success: true, backup: { fileName, createdAt: stat.mtimeMs, sizeBytes: stat.size } }
  } catch (error) {
    return opFailure(error)
  }
}

export async function listWorldBackupsForBuild(buildName: string): Promise<WorldBackupInfo[]> {
  try {
    const gameDir = await getGameDir(buildName)
    const backupDir = getWorldBackupDir(gameDir)
    const entries = await fs.readdir(backupDir, { withFileTypes: true }).catch(() => [])
    const backups: WorldBackupInfo[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".zip") || entry.name.includes("..")) continue
      try {
        const stat = await fs.stat(path.join(backupDir, entry.name))
        backups.push({ fileName: entry.name, createdAt: stat.mtimeMs, sizeBytes: stat.size })
      } catch { /* ignore files removed during listing */ }
    }
    return backups.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}


export async function restoreLatestWorldBackupForBuild(buildName: string, folder: string, requestedBackupFileName?: string): Promise<OpResult & { folder?: string; backup?: string }> {
  try {
    const gameDir = await getGameDir(buildName)
    const savesDir = path.join(gameDir, "saves")
    if (!resolveWorldPath(savesDir, folder)) {
      return { success: false, error: "Некорректное имя папки мира" }
    }
    const safeFolder = sanitizeFileName(folder).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || "world"
    const backups = await listWorldBackupsForBuild(buildName)
    const latest = requestedBackupFileName
      ? backups.find(item => item.fileName === requestedBackupFileName && item.fileName.startsWith(`${safeFolder}-`))
      : backups.find(item => item.fileName.startsWith(`${safeFolder}-`))
    if (!latest) {
      return { success: false, error: "Для этого мира пока нет резервных копий" }
    }
    const backupPath = path.join(getWorldBackupDir(gameDir), latest.fileName)
    const restoredName = `${folder}_restored`
    const result = await unpackWorldZip(savesDir, backupPath, restoredName, `${folder} (восстановлено)`)
    if (!result.success) return result
    return { success: true, folder: result.folder, backup: latest.fileName }
  } catch (error) {
    return opFailure(error)
  }
}

export async function deleteWorldBackupForBuild(buildName: string, fileName: string): Promise<OpResult> {
  try {
    if (!fileName || path.basename(fileName) !== fileName || !/^[a-zA-Z0-9_-]+\.zip$/.test(fileName)) {
      return { success: false, error: "Некорректное имя резервной копии" }
    }
    const gameDir = await getGameDir(buildName)
    const backupDir = getWorldBackupDir(gameDir)
    const backupPath = path.resolve(backupDir, fileName)
    if (!backupPath.startsWith(`${path.resolve(backupDir)}${path.sep}`)) {
      return { success: false, error: "Некорректный путь резервной копии" }
    }
    await fs.rm(backupPath, { force: true })
    return { success: true }
  } catch (error) {
    return opFailure(error)
  }
}

export async function renameWorldForBuild(buildName: string, folder: string, newName: string): Promise<OpResult> {
  try {
    const gameDir = await getGameDir(buildName)
    const savesDir = path.join(gameDir, "saves")
    const worldPath = resolveWorldPath(savesDir, folder)
    if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }

    const trimmedName = newName.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").slice(0, 64)
    if (!trimmedName) return { success: false, error: "Введите название мира" }
    if (trimmedName === folder) return { success: true }

    const newFolder = trimmedName.replace(/\s+/g, "_")
    const newWorldPath = path.join(savesDir, newFolder)
    try { await fs.access(newWorldPath) } catch {
      await fs.rename(worldPath, newWorldPath)
    }

    // Update LevelName inside level.dat (keep in-sync display name)
    await updateLevelName(newWorldPath, trimmedName)

    return { success: true }
  } catch (error) {
    return opFailure(error)
  }
}

export async function deleteWorldForBuild(buildName: string, folder: string): Promise<OpResult> {
  try {
    const gameDir = await getGameDir(buildName)
    const savesDir = path.join(gameDir, "saves")
    const worldPath = resolveWorldPath(savesDir, folder)
    if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }
    // Never delete a world unless a fresh backup was written successfully.
    const backupResult = await createWorldBackupForBuild(buildName, folder)
    if (!backupResult.success || !backupResult.backup) {
      return { success: false, error: `Удаление отменено: резервная копия не создана. ${backupResult.error ?? ""}`.trim() }
    }
    await fs.rm(worldPath, { recursive: true, force: true })
    return { success: true }
  } catch (error) {
    return opFailure(error)
  }
}

export function registerWorldsHandlers(): void {
  ipcMain.handle("worlds:list", async (_event, buildName: string): Promise<WorldInfo[]> => {
    return listWorldsForBuild(buildName)
  })


  ipcMain.handle("worlds:backup-create", async (_event, buildName: string, folder: string) => {
    return createWorldBackupForBuild(buildName, folder)
  })

  ipcMain.handle("worlds:backups-list", async (_event, buildName: string): Promise<WorldBackupInfo[]> => {
    return listWorldBackupsForBuild(buildName)
  })


  ipcMain.handle("worlds:backup-restore-latest", async (_event, buildName: string, folder: string, backupFileName?: string) => {
    return restoreLatestWorldBackupForBuild(buildName, folder, backupFileName)
  })

  ipcMain.handle("worlds:backup-delete", async (_event, buildName: string, fileName: string): Promise<OpResult> => {
    return deleteWorldBackupForBuild(buildName, fileName)
  })

  ipcMain.handle("worlds:rename", async (_event, buildName: string, folder: string, newName: string): Promise<OpResult> => {
    return renameWorldForBuild(buildName, folder, newName)
  })

  ipcMain.handle("worlds:delete", async (_event, buildName: string, folder: string): Promise<OpResult> => {
    return deleteWorldForBuild(buildName, folder)
  })

  ipcMain.handle("worlds:set-icon", async (_event, buildName: string, folder: string, dataUrl: string): Promise<OpResult> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }

      const image = nativeImage.createFromDataURL(dataUrl)
      if (image.isEmpty()) return { success: false, error: "Не удалось прочитать изображение" }
      const resized = image.resize({ width: 256, height: 256 })
      await fs.writeFile(path.join(worldPath, "icon.png"), resized.toPNG())
      return { success: true }
    } catch (error) {
      return opFailure(error)
    }
  })

  ipcMain.handle("worlds:reset-icon", async (_event, buildName: string, folder: string): Promise<OpResult> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }
      await fs.rm(path.join(worldPath, "icon.png"), { force: true })
      return { success: true }
    } catch (error) {
      return opFailure(error)
    }
  })

  ipcMain.handle("worlds:copy", async (_event, buildName: string, folder: string, newName: string): Promise<OpResult & { folder?: string }> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }

      const trimmedName = newName.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").slice(0, 64)
      if (!trimmedName) return { success: false, error: "Введите название мира" }

      const newFolder = await uniqueFolderPath(savesDir, trimmedName.replace(/\s+/g, "_"))
      const newWorldPath = path.join(savesDir, newFolder)
      await fs.cp(worldPath, newWorldPath, { recursive: true })
      await updateLevelName(newWorldPath, trimmedName)
      return { success: true, folder: newFolder }
    } catch (error) {
      return opFailure(error)
    }
  })

  ipcMain.handle("worlds:import-zip", async (_event, buildName: string, localFilePath: string, newName?: string): Promise<OpResult & { folder?: string }> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const fallbackName = path.basename(localFilePath, path.extname(localFilePath))
      return await unpackWorldZip(savesDir, localFilePath, fallbackName, newName)
    } catch (error) {
      return opFailure(error)
    }
  })

  ipcMain.handle("worlds:import-remote", async (_event, buildName: string, url: string, preferredName?: string): Promise<OpResult & { folder?: string }> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const safeFileName = sanitizeFileName((preferredName || "world").replace(/\s+/g, "_") + ".zip")
      const buffer = await downloadBuffer(url, undefined, safeFileName)
      const fallbackName = (preferredName || "imported_map").trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
      return await unpackWorldZip(savesDir, buffer, fallbackName, preferredName)
    } catch (error) {
      return opFailure(error)
    }
  })

  ipcMain.handle("worlds:list-datapacks", async (_event, buildName: string, folder: string): Promise<DatapackInfo[]> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return []
      return await listDatapacks(worldPath)
    } catch {
      return []
    }
  })

  ipcMain.handle("worlds:install-datapack-remote", async (_event, buildName: string, folder: string, url: string, fileName: string): Promise<OpResult & { path?: string }> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }
      const dpDir = path.join(worldPath, "datapacks")
      await fs.mkdir(dpDir, { recursive: true }).catch(() => {})
      const safeName = sanitizeFileName(fileName)
      const filePath = resolveChildPath(dpDir, safeName)
      if (!filePath) return { success: false, error: "Некорректное имя файла" }
      const buffer = await downloadBuffer(url)
      if (buffer.length < 4) return { success: false, error: "Файл пуст" }
      try { await fs.access(filePath) } catch {
        await fs.writeFile(filePath, buffer)
      }
      return { success: true, path: filePath }
    } catch (error) {
      return opFailure(error)
    }
  })

  ipcMain.handle("worlds:install-datapack-local", async (_event, buildName: string, folder: string, localFilePath: string): Promise<OpResult & { path?: string }> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }
      const dpDir = path.join(worldPath, "datapacks")
      await fs.mkdir(dpDir, { recursive: true }).catch(() => {})
      const destPath = resolveChildPath(dpDir, path.basename(localFilePath))
      if (!destPath) return { success: false, error: "Некорректное имя файла" }
      try { await fs.access(destPath) } catch {
        await fs.copyFile(localFilePath, destPath)
      }
      return { success: true, path: destPath }
    } catch (error) {
      return opFailure(error)
    }
  })

  ipcMain.handle("worlds:delete-datapack", async (_event, buildName: string, folder: string, fileName: string): Promise<OpResult> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }
      const dpDir = path.join(worldPath, "datapacks")
      const filePath = resolveChildPath(dpDir, fileName)
      if (!filePath) return { success: false, error: "Некорректное имя файла" }
      await fs.rm(filePath, { recursive: true, force: true })
      return { success: true }
    } catch (error) {
      return opFailure(error)
    }
  })

  // ---------- Screenshots ----------

  /**
   * Кэш миниатюр скриншотов.
   *
   * Раньше `screenshots:list` читал КАЖДЫЙ файл целиком, декодировал его и
   * пересобирал PNG-миниатюру при каждом открытии вкладки. Теперь миниатюра
   * сохраняется рядом (`<shots>/.thumbs/<name>.png`) и пересобирается только
   * если исходник новее; в памяти держим последний результат на сессию.
   * Ключ — путь к исходнику, инвалидация по mtime+size.
   */
  const thumbCache = new Map<string, { mtime: number; size: number; dataUrl: string }>()

  const listScreenshots = async (buildName: string): Promise<ScreenshotInfo[]> => {
    const gameDir = await getGameDir(buildName)
    const shotsDir = path.join(gameDir, "screenshots")
    let entries: string[] = []
    try { entries = await fs.readdir(shotsDir) } catch { return [] }
    const thumbsDir = path.join(shotsDir, ".thumbs")
    const result: ScreenshotInfo[] = []
    for (const entry of entries) {
      if (!/\.(png|jpe?g|webp|bmp)$/i.test(entry)) continue
      const full = path.join(shotsDir, entry)
      try {
        const stat = await fs.stat(full)
        if (!stat.isFile()) continue

        const cached = thumbCache.get(full)
        let dataUrl: string | undefined
        if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) {
          dataUrl = cached.dataUrl
        }

        if (!dataUrl) {
          const thumbPath = path.join(thumbsDir, `${entry}.png`)
          // Дисковый кэш: если миниатюра не старше исходника — берём её,
          // декодирование полноразмерного скриншота не нужно.
          try {
            const thumbStat = await fs.stat(thumbPath)
            if (thumbStat.mtimeMs >= stat.mtimeMs) {
              dataUrl = fileToDataUrl(await fs.readFile(thumbPath), "image/png")
            }
          } catch { /* миниатюры ещё нет */ }
        }

        if (!dataUrl) {
          const buffer = await fs.readFile(full)
          const image = nativeImage.createFromBuffer(buffer)
          if (image.isEmpty()) continue
          const size = image.getSize()
          const maxDim = Math.max(size.width, size.height)
          const thumb = maxDim > 480 ? image.resize({ width: Math.round(size.width * 480 / maxDim) }) : image
          const png = thumb.toPNG()
          dataUrl = fileToDataUrl(png, "image/png")
          try {
            await fs.mkdir(thumbsDir, { recursive: true })
            await fs.writeFile(path.join(thumbsDir, `${entry}.png`), png)
          } catch { /* дисковый кэш необязателен */ }
        }

        thumbCache.set(full, { mtime: stat.mtimeMs, size: stat.size, dataUrl })
        result.push({
          name: entry,
          sizeBytes: stat.size,
          lastModified: stat.mtimeMs,
          thumbDataUrl: dataUrl,
          path: full,
        })
      } catch { /* ignore */ }
    }
    result.sort((a, b) => b.lastModified - a.lastModified)
    return result
  }

  ipcMain.handle("screenshots:list", async (_event, buildName: string): Promise<ScreenshotInfo[]> => {
    try {
      return await listScreenshots(buildName)
    } catch {
      return []
    }
  })

  ipcMain.handle("screenshots:get", async (_event, buildName: string, fileName: string): Promise<string | null> => {
    try {
      const gameDir = await getGameDir(buildName)
      const shotsDir = path.join(gameDir, "screenshots")
      const filePath = resolveChildPath(shotsDir, fileName)
      if (!filePath) return null
      const buffer = await fs.readFile(filePath)
      // JPEG отдаём как есть: раньше PNG-перекодирование раздувало payload и
      // тратило время на декодирование/кодирование без выигрыша в качестве.
      const ext = path.extname(filePath).toLowerCase()
      if (ext === ".jpg" || ext === ".jpeg") {
        return fileToDataUrl(buffer, "image/jpeg")
      }
      const image = nativeImage.createFromBuffer(buffer)
      if (image.isEmpty()) return null
      return fileToDataUrl(image.toPNG(), "image/png")
    } catch {
      return null
    }
  })

  ipcMain.handle("screenshots:delete", async (_event, buildName: string, fileName: string): Promise<OpResult> => {
    try {
      const gameDir = await getGameDir(buildName)
      const shotsDir = path.join(gameDir, "screenshots")
      const filePath = resolveChildPath(shotsDir, fileName)
      if (!filePath) return { success: false, error: "Некорректное имя файла" }
      await fs.rm(filePath, { force: true })
      return { success: true }
    } catch (error) {
      return opFailure(error)
    }
  })

  ipcMain.handle("screenshots:rename", async (_event, buildName: string, fileName: string, newName: string): Promise<OpResult> => {
    try {
      const gameDir = await getGameDir(buildName)
      const shotsDir = path.join(gameDir, "screenshots")
      const src = resolveChildPath(shotsDir, fileName)
      if (!src) return { success: false, error: "Некорректное имя файла" }

      let clean = (newName ?? "").trim()
      if (!clean) return { success: false, error: "Пустое имя файла" }
      const ext = path.extname(fileName)
      if (!path.extname(clean)) clean += ext

      const dest = resolveChildPath(shotsDir, clean)
      if (!dest) return { success: false, error: "Некорректное имя файла" }
      if (path.normalize(dest) === path.normalize(src)) return { success: true }
      if (await fs.access(dest).then(() => true).catch(() => false)) {
        return { success: false, error: "Файл с таким именем уже существует" }
      }
      await fs.rename(src, dest)
      return { success: true }
    } catch (error) {
      return opFailure(error)
    }
  })
}
