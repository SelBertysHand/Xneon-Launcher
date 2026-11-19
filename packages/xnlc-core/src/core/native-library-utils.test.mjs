import { test } from "node:test"
import assert from "node:assert/strict"
import { getNativeArtifactClassifier, isNativeArtifactLibrary } from "./native-library-utils.ts"
import { mergeLwjglComponentLibraries } from "./library-enrichment.ts"

test("recognizes modern LWJGL native Maven artifacts", () => {
  assert.equal(getNativeArtifactClassifier("org.lwjgl:lwjgl-natives-linux:3.3.1"), "natives-linux")
  assert.equal(getNativeArtifactClassifier("org.lwjgl:lwjgl-glfw-natives-windows-arm64:3.3.1"), "natives-windows-arm64")
  assert.equal(getNativeArtifactClassifier("org.lwjgl:lwjgl-natives-macos-arm64:3.3.1"), "natives-macos-arm64")
  assert.equal(isNativeArtifactLibrary("org.lwjgl:lwjgl:3.3.1"), false)
  assert.equal(isNativeArtifactLibrary("org.lwjgl:lwjgl-glfw:3.3.1"), false)
})

test("replaces old LWJGL artifacts with the platform-aware component without duplicating them", () => {
  const merged = mergeLwjglComponentLibraries(
    [
      { name: "org.lwjgl:lwjgl:3.3.1" },
      { name: "org.lwjgl:lwjgl-glfw:3.3.1" },
      { name: "com.mojang:authlib:4.0.43" },
    ],
    [
      { name: "org.lwjgl:lwjgl:3.3.1" },
      { name: "org.lwjgl:lwjgl-natives-linux:3.3.1" },
    ],
  )
  assert.deepEqual(merged.map(item => item.name), [
    "com.mojang:authlib:4.0.43",
    "org.lwjgl:lwjgl:3.3.1",
    "org.lwjgl:lwjgl-natives-linux:3.3.1",
  ])
})
