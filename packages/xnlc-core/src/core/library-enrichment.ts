import type { VersionJsonLibrary, VersionJsonDownload } from "../types/index.js"

/**
 * Loader-meta may only carry the primary Maven artifact for a library. Never
 * let that partial record erase Mojang's platform classifier downloads: without
 * natives-windows/natives-linux, LWJGL cannot create the game window.
 */
export function mergeLibraryMetadata(
  mojang: VersionJsonLibrary,
  meta: VersionJsonLibrary,
): VersionJsonLibrary {
  const mergeDownload = (
    original?: VersionJsonDownload,
    replacement?: VersionJsonDownload,
  ): VersionJsonDownload | undefined => original || replacement
    ? { ...(original ?? {}), ...(replacement ?? {}) }
    : undefined

  const originalDownloads = mojang.downloads
  const metaDownloads = meta.downloads
  let downloads = originalDownloads
  if (originalDownloads || metaDownloads) {
    const originalClassifiers = originalDownloads?.classifiers ?? {}
    const metaClassifiers = metaDownloads?.classifiers ?? {}
    const classifierKeys = new Set([...Object.keys(originalClassifiers), ...Object.keys(metaClassifiers)])
    const classifiers: Record<string, VersionJsonDownload> = {}
    for (const key of classifierKeys) {
      const original = originalClassifiers[key]
      const replacement = metaClassifiers[key]
      const merged = mergeDownload(
        original && "url" in original ? original as VersionJsonDownload : undefined,
        replacement && "url" in replacement ? replacement as VersionJsonDownload : undefined,
      )
      if (merged) classifiers[key] = merged
    }
    downloads = {
      ...(originalDownloads ?? {}),
      ...(metaDownloads ?? {}),
      artifact: mergeDownload(originalDownloads?.artifact, metaDownloads?.artifact),
      classifiers: Object.keys(classifiers).length > 0 ? classifiers : undefined,
    }
  }

  const metaNatives = meta.natives
  const hasMetaNatives = !!metaNatives && Object.keys(metaNatives).length > 0
  const metaRules = Array.isArray(meta.rules) && meta.rules.length > 0 ? meta.rules : undefined
  const metaExtract = meta.extract?.exclude?.length ? meta.extract : undefined

  return {
    ...mojang,
    ...meta,
    downloads,
    rules: metaRules ?? mojang.rules,
    natives: hasMetaNatives ? metaNatives : mojang.natives,
    extract: metaExtract ?? mojang.extract,
  }
}
