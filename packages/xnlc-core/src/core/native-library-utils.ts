export function getNativeArtifactClassifier(libraryName: string): string | null {
  const [, artifact = ""] = libraryName.split(":")
  const match = artifact.match(/(?:^|-)natives-(windows|linux|macos|osx)(?:-(arm64|aarch64|x86|x86_64))?$/i)
  return match ? match[0].replace(/^-/, "") : null
}

export function isNativeArtifactLibrary(libraryName: string): boolean {
  return getNativeArtifactClassifier(libraryName) !== null
}
