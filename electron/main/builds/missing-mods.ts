import fs from "node:fs"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { downloadBuffer } from "./helpers"

/**
 * Модпаки вроде Better MC кладут в сборку мод Missing Mods Checker: он на старте
 * сверяет `config/missing_mods_checker.json` с папками игры и открывает окно с
 * требованием докачать «core»-файлы. В `.mrpack` этих файлов нет — Modrinth их
 * не распространяет, они лежат только на CurseForge (в конфиге ссылки на
 * страницы загрузки). Раньше это выглядело как зависший запуск: игра ждала,
 * пока пользователь закроет окно. Здесь мы докачиваем их сами через CurseForge
 * API, чтобы окно не появлялось.
 */
export type MissingModEntry = {
  displayName?: string
  pattern?: string
  url?: string
  destination?: string
}

/** Идентификатор файла CurseForge из ссылки вида `.../download/7420614`. */
export function parseCurseforgeFileId(url: string | undefined): number | null {
  if (!url) return null
  const match = url.match(/\/download\/(\d+)/)
  return match ? Number(match[1]) : null
}

export function readMissingModsConfig(intentPath: string): MissingModEntry[] {
  try {
    const configPath = path.join(intentPath, "config", "missing_mods_checker.json")
    if (!fs.existsSync(configPath)) return []
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown
    return Array.isArray(parsed) ? (parsed as MissingModEntry[]) : []
  } catch {
    return []
  }
}

function destinationDir(entry: MissingModEntry): "mods" | "resourcepacks" {
  return entry.destination === "resourcepacks" ? "resourcepacks" : "mods"
}

/**
 * Config entries are supplied by modpacks and must never escape the intended
 * mods/resourcepacks directory. Only plain file names are accepted.
 */
function resolveMissingModTarget(intentPath: string, entry: MissingModEntry): string | null {
  const fileName = entry.pattern
  if (!fileName || fileName === "." || fileName === ".." || fileName !== path.basename(fileName)) return null
  if (/[\\/\u0000-\u001F]/.test(fileName) || /[. ]$/.test(fileName)) return null
  const root = path.resolve(intentPath)
  const directory = path.resolve(root, destinationDir(entry))
  const target = path.resolve(directory, fileName)
  if (!directory.startsWith(root + path.sep) || !target.startsWith(directory + path.sep)) return null
  return target
}

/** Файлы из конфига, которых нет в папках сборки. */
export function collectMissingFiles(intentPath: string, entries: MissingModEntry[]): MissingModEntry[] {
  const missing: MissingModEntry[] = []
  for (const entry of entries) {
    if (!entry?.pattern) continue
    const target = resolveMissingModTarget(intentPath, entry)
    if (target && !fs.existsSync(target)) missing.push(entry)
  }
  return missing
}

export type MissingModsResult = {
  total: number
  missing: number
  downloaded: number
  failed: number
  failedNames: string[]
}

/**
 * Докачивает недостающие файлы из CurseForge. Имя сохраняем ровно как в конфиге
 * (`pattern`) — именно по нему мод проверяет наличие файла.
 */
export async function downloadMissingModFiles(
  intentPath: string,
  entries: MissingModEntry[],
  options?: {
    signal?: AbortSignal
    onProgress?: (done: number, total: number, current: string) => void
    loadModsModule?: () => Promise<{
      curseforgeGetFiles: (fileIds: number[]) => Promise<Record<number, { fileName?: string; downloadUrl?: string; fileLength?: number; sha1?: string }>>
    }>
  },
): Promise<MissingModsResult> {
  const total = entries.length
  const result: MissingModsResult = { total, missing: total, downloaded: 0, failed: 0, failedNames: [] }
  if (total === 0) return result

  const loadMods = options?.loadModsModule
  let fileInfos: Record<number, { fileName?: string; downloadUrl?: string; fileLength?: number; sha1?: string }> = {}
  if (loadMods) {
    try {
      const mods = await loadMods()
      const ids = entries.map(entry => parseCurseforgeFileId(entry.url)).filter((id): id is number => id !== null)
      if (ids.length > 0) fileInfos = await mods.curseforgeGetFiles(ids)
    } catch {
      // Без метаданных попробуем прямые ссылки из конфига.
    }
  }

  let done = 0
  for (const entry of entries) {
    const fileName = entry.pattern
    const target = resolveMissingModTarget(intentPath, entry)
    if (!fileName || !target) {
      result.failed++
      result.failedNames.push(entry.displayName || fileName || "Некорректное имя файла")
      done++
      continue
    }
    const dir = path.dirname(target)
    try {
      options?.onProgress?.(done, total, fileName)
      if (fs.existsSync(target)) {
        if (fs.lstatSync(target).isSymbolicLink()) throw new Error("Символическая ссылка вместо файла назначения")
        done++
        result.downloaded++
        continue
      }
      const fileId = parseCurseforgeFileId(entry.url)
      const info = fileId !== null ? fileInfos[fileId] : undefined
      const url = info?.downloadUrl
      if (!url) {
        result.failed++
        result.failedNames.push(entry.displayName || fileName)
        done++
        continue
      }
      fs.mkdirSync(dir, { recursive: true })
      if (fs.lstatSync(dir).isSymbolicLink()) throw new Error("Папка назначения является символической ссылкой")
      const rootReal = fs.realpathSync(path.resolve(intentPath))
      const dirReal = fs.realpathSync(dir)
      if (!dirReal.startsWith(rootReal + path.sep)) throw new Error("Папка назначения выходит за пределы сборки")
      const buffer = await downloadBuffer(url, options?.signal, fileName)
      if (typeof info?.fileLength === "number" && info.fileLength > 0 && buffer.length !== info.fileLength) {
        throw new Error("Размер файла не совпал: ожидалось " + info.fileLength + ", получено " + buffer.length)
      }
      if (info?.sha1) {
        const actualSha1 = createHash("sha1").update(buffer).digest("hex")
        if (actualSha1.toLowerCase() !== info.sha1.toLowerCase()) {
          throw new Error("SHA-1 checksum mismatch")
        }
      }
      const temporary = target + "." + randomUUID() + ".tmp"
      try {
        fs.writeFileSync(temporary, buffer, { flag: "wx" })
        fs.renameSync(temporary, target)
      } finally {
        try { fs.rmSync(temporary, { force: true }) } catch { /* ignore cleanup failure */ }
      }
      result.downloaded++
    } catch {
      result.failed++
      result.failedNames.push(entry.displayName || fileName)
    }
    done++
    options?.onProgress?.(done, total, fileName)
  }

  return result
}
