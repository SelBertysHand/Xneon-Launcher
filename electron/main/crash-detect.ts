import fs from "fs"
import path from "path"

/**
 * Свежий crash-report в папке игры: Minecraft пишет его перед падением.
 *
 * `since` — момент запуска игры. Файлы прошлых сессий отсекаются по mtime,
 * иначе после любого нормального выхода игра «выглядела бы упавшей».
 */
export function findRecentCrashReport(gameDir: string, since: number): string | null {
  try {
    const dir = path.join(gameDir, "crash-reports")
    let newest: { file: string; mtimeMs: number } | null = null
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".txt")) continue
      const full = path.join(dir, entry.name)
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      if (stat.mtimeMs < since) continue
      if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { file: full, mtimeMs: stat.mtimeMs }
    }
    return newest?.file ?? null
  } catch {
    return null
  }
}

/**
 * Упала ли игра. Ненулевой код выхода — краш; нулевой код с свежим
 * crash-report — тоже краш (Java-исключение: игра пишет отчёт и выходит штатно).
 */
export function detectMinecraftCrash(
  gameDir: string,
  launchStartedAt: number,
  exitCode: number,
): { crashed: boolean; crashReport: string | null } {
  const crashReport = findRecentCrashReport(gameDir, launchStartedAt)
  return { crashed: exitCode !== 0 || crashReport !== null, crashReport }
}

export type MinecraftCrashDiagnosis = {
  category: "memory" | "mixin" | "missing-class" | "binary-incompatibility" | "java-version" | "graphics" | "dependency" | "mod-loading" | "unknown"
  title: string
  summary: string
  advice: string[]
  suspectedMods: string[]
}

/**
 * Read only a bounded crash-report prefix and produce actionable, redacted
 * diagnostics. Never return raw report contents or authentication values.
 */
export function diagnoseMinecraftCrash(crashReportPath: string | null, exitCode: number): MinecraftCrashDiagnosis {
  let report = ""
  if (crashReportPath) {
    try {
      const fd = fs.openSync(crashReportPath, "r")
      try {
        const buffer = Buffer.alloc(1024 * 1024)
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0)
        report = buffer.toString("utf8", 0, bytes)
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      // Crash reports can disappear if the user cleans the game directory.
    }
  }

  const safe = report
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/gi, "$1[USER]")
    .replace(/(\\/home\\/)[^/\\s]+/g, "$1[USER]")
    .replace(/((?:access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password)\\s*[:=]\\s*)[^\\s,;]+/gi, "$1[REDACTED]")
  const lines = safe.split(/\\r?\\n/)
  const modSet = new Set<string>()
  for (const line of lines) {
    const match = line.match(/(?:Mod ID|modid|Mod File|mod file)\\s*[:=]\\s*([a-zA-Z0-9_.-]{2,80})/i)
    if (match) modSet.add(match[1])
    const header = line.match(/^\\s*--\\s*([a-zA-Z0-9_.-]{2,80})\\s*--/)
    if (header) modSet.add(header[1])
    if (modSet.size >= 8) break
  }
  const suspectedMods = [...modSet].slice(0, 5)
  const has = (pattern: RegExp) => pattern.test(safe)
  const firstError = lines.find(line => /(?:Exception|Error):/.test(line) && line.trim().length > 0)
  let category: MinecraftCrashDiagnosis["category"] = "unknown"
  let title = "Не удалось точно определить причину вылета"
  let summary = firstError?.trim().slice(0, 240) ?? `Minecraft завершился с кодом ${exitCode} без распознанной причины.`
  let advice = ["Откройте полный лог и проверьте последние строки перед завершением игры.", "Если проблема появилась после установки модов, временно отключите последние добавленные моды."]
  if (has(/OutOfMemoryError|Java heap space|GC overhead limit exceeded/i)) {
    category = "memory"; title = "Недостаточно оперативной памяти"
    summary = "Java исчерпала доступную память во время работы Minecraft."
    advice = ["Проверьте выделенную игре память и оставьте запас для Windows.", "Закройте тяжёлые приложения; не выделяйте игре всю физическую RAM."]
  } else if (has(/Mixin apply failed|MixinApplyError|InjectionError/i)) {
    category = "mixin"; title = "Конфликт модов или несовместимый Mixin"
    summary = "Один из модов не смог применить изменение кода Minecraft или другого мода."
    advice = ["Проверьте совместимость версий модов и загрузчика.", "Начните проверку с модов, названных рядом с сообщением Mixin."]
  } else if (has(/NoClassDefFoundError|ClassNotFoundException/i)) {
    category = "missing-class"; title = "Не найден класс или библиотека"
    summary = "Моду или загрузчику не хватает класса из зависимости либо установлен несовместимый файл."
    advice = ["Проверьте обязательные зависимости модов.", "Убедитесь, что все моды предназначены для этой версии Minecraft и загрузчика."]
  } else if (has(/NoSuchMethodError|NoSuchFieldError|AbstractMethodError/i)) {
    category = "binary-incompatibility"; title = "Несовместимые версии модов"
    summary = "Компоненты используют разные версии API или библиотек."
    advice = ["Обновите или откатите связанные моды согласованным набором.", "Не смешивайте сборки для Forge, NeoForge и Fabric."]
  } else if (has(/UnsupportedClassVersionError|class file version .* newer|requires Java [0-9]+/i)) {
    category = "java-version"; title = "Неподходящая версия Java"
    summary = "Версия Java не соответствует требованиям Minecraft, загрузчика или мода."
    advice = ["Проверьте требуемую Java для этой версии Minecraft.", "Выберите совместимую 64-битную Java в настройках сборки."]
  } else if (has(/org\\.lwjgl|GLFW|OpenGL|GLXBadFBConfig|Failed to create.*context/i)) {
    category = "graphics"; title = "Ошибка графики или OpenGL"
    summary = "Minecraft не смог создать графический контекст или инициализировать драйвер."
    advice = ["Обновите драйвер видеокарты с сайта производителя.", "Отключите шейдеры и графические моды для проверки."]
  } else if (has(/requires .* dependency|Missing or unsupported mandatory dependencies|Mod .* requires/i)) {
    category = "dependency"; title = "Отсутствует обязательная зависимость"
    summary = "Загрузчик сообщает о недостающей или несовместимой зависимости мода."
    advice = ["Установите указанную зависимость подходящей версии.", "Проверьте, что зависимость предназначена для того же загрузчика."]
  } else if (has(/ModLoadingException|Failed to load mod|Error loading mods|Errors during loading/i)) {
    category = "mod-loading"; title = "Ошибка загрузки модов"
    summary = "Один или несколько модов завершили загрузку с ошибкой."
    advice = ["Откройте раздел модов и проверьте последние установленные файлы.", "Сверьте версии модов, Minecraft и загрузчика."]
  }
  return { category, title, summary, advice, suspectedMods }
}

