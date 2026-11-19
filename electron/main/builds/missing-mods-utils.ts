import fs from "node:fs"
import path from "node:path"

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
