import path from "node:path"

function getWorldBackupSourceLabel(fileName: string): string {
  const current = fileName.match(/^(?:manual|automatic)-(.+)-[a-f0-9]{10}-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}\.zip$/i)
  if (current?.[1]) return current[1].replace(/_/g, " ")
  const legacy = fileName.match(/^(.+)-\d{4}-\d{2}-\d{2}T.*-[a-f0-9]{8}\.zip$/i)
  return legacy?.[1]?.replace(/_/g, " ") || "Сохранённый мир"
}

function isSafeBackupFileName(fileName: string): boolean {
  return !!fileName && path.basename(fileName) === fileName && /^[a-zA-Z0-9_-]+\.zip$/.test(fileName)
}
