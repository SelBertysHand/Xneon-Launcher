export function parseExtraJvmArgs(rawArgs?: string): string[] {
  if (!rawArgs) return []
  const tokens: string[] = []
  const regex = /"([^"]*)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(rawArgs)) !== null) {
    if (match[1] !== undefined) {
      if (match[1].trim()) tokens.push(match[1].trim())
    } else if (match[2] !== undefined) {
      tokens.push(match[2])
    }
  }
  return tokens
}

export type LaunchVarContext = {
  instName: string
  instId?: string
  gameDir: string
  javaPath: string
  mcVersion: string
  loaderType: string
  loaderVersion?: string
  javaArgs?: string
  accountName: string
  accountUuid?: string
  accountAccessToken?: string
}

/**
 * Substitutes environment-style placeholders ($VAR / ${VAR}) in
 * pre/post-launch commands, wrapper command and env values.
 * Matches the substitution semantics of the reference launcher:
 * a placeholder is replaced only when the variable has a non-empty value.
 */
export function substituteLaunchVars(command: string, ctx: LaunchVarContext): string {
  const vars: Record<string, string> = {
    INST_NAME: ctx.instName,
    INST_ID: ctx.instId ?? ctx.instName,
    INST_DIR: ctx.gameDir,
    INST_MC_DIR: ctx.gameDir,
    INST_JAVA: ctx.javaPath,
    INST_JAVA_ARGS: ctx.javaArgs ?? "",
    NO_COLOR: "1",
    MINECRAFT_VERSION: ctx.mcVersion,
    MC_VERSION: ctx.mcVersion,
    LOADER_TYPE: ctx.loaderType,
    LOADER_VERSION: ctx.loaderVersion ?? "",
    AUTH_PLAYER_NAME: ctx.accountName,
    AUTH_UUID: ctx.accountUuid ?? "",
    AUTH_ACCESS_TOKEN: ctx.accountAccessToken ?? "",
  }
  return command.replace(/\$\{([A-Za-z0-9_]+)\}|\$([A-Za-z0-9_]+)/g, (match, braceKey, bareKey) => {
    const key = braceKey ?? bareKey
    const value = vars[key]
    return value ? value : match
  })
}

/**
 * Splits a command string into program + arguments, mirroring the
 * Commandline::splitArgs behavior of the reference launcher: whitespace
 * separates tokens, single/double quotes group tokens, backslash escapes
 * the next character inside quotes.
 */
/**
 * Разбор строки команды на аргументы.
 *
 * Обратный слэш — обычный символ пути, а не escape-последовательность: иначе
 * `"C:\path\to\file"` терял разделители и превращался в `C:pathtofile`. Кавычку
 * экранирует только нечётное число слэшей перед ней — как в правилах разбора
 * командной строки Windows.
 */
export function splitCommandLine(input: string): string[] {
  const argv: string[] = []
  let current = ""
  let inQuotes: string | null = null
  let i = 0

  while (i < input.length) {
    const c = input[i]

    if (c === "\\") {
      let slashes = 0
      while (i < input.length && input[i] === "\\") {
        slashes += 1
        i += 1
      }
      const next = input[i]
      if (next === '"' || next === "'") {
        current += "\\".repeat(Math.floor(slashes / 2))
        if (slashes % 2 === 1) {
          current += next
          i += 1
        }
      } else {
        current += "\\".repeat(slashes)
      }
      continue
    }

    if (c === '"' || c === "'") {
      if (inQuotes === c) inQuotes = null
      else if (!inQuotes) inQuotes = c
      else current += c
      i += 1
      continue
    }

    if (!inQuotes && (c === " " || c === "\t")) {
      if (current.length > 0) {
        argv.push(current)
        current = ""
      }
      i += 1
      continue
    }

    current += c
    i += 1
  }

  if (current.length > 0) argv.push(current)
  return argv
}

