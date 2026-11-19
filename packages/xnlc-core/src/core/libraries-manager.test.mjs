import { test } from "node:test"
import assert from "node:assert/strict"
import { LibrariesManager } from "../../lib/core/libraries-manager.js"

const libraries = [
  {
    name: "org.lwjgl:lwjgl:3.3.1",
    downloads: { artifact: { url: "https://libraries.minecraft.net/lwjgl.jar", path: "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar", sha1: "core", size: 100 } },
  },
  {
    name: "org.lwjgl:lwjgl-natives-linux:3.3.1",
    downloads: { artifact: { url: "https://libraries.minecraft.net/lwjgl-linux.jar", path: "org/lwjgl/lwjgl-natives-linux/3.3.1/lwjgl-natives-linux-3.3.1.jar", sha1: "linux", size: 200 } },
    rules: [{ action: "allow", os: { name: "linux" } }],
  },
  {
    name: "org.lwjgl:lwjgl-natives-windows:3.3.1",
    downloads: { artifact: { url: "https://libraries.minecraft.net/lwjgl-windows.jar", path: "org/lwjgl/lwjgl-natives-windows/3.3.1/lwjgl-natives-windows-3.3.1.jar", sha1: "windows", size: 220 } },
    rules: [{ action: "allow", os: { name: "windows" } }],
  },
]

test("resolves Linux native LWJGL artifact as extract-only, not classpath", () => {
  const manager = new LibrariesManager("/tmp/xneon-game", { os: "linux", arch: "x64" })
  const resolved = manager.resolveLibraries({ id: "1.20.1", libraries })
  const natives = resolved.filter(item => item.isNative)
  assert.equal(natives.length, 1)
  assert.equal(natives[0].name, "org.lwjgl:lwjgl-natives-linux:3.3.1")
  assert.equal(natives[0].classifier, "natives-linux")
  assert.equal(natives[0].includeInClasspath, false)
  assert.equal(resolved.some(item => item.name === "org.lwjgl:lwjgl:3.3.1" && !item.isNative), true)
  assert.equal(resolved.some(item => item.name.includes("natives-windows")), false)
})

test("resolves Windows native LWJGL artifact for Windows", () => {
  const manager = new LibrariesManager("C:\\xneon-game", { os: "windows", arch: "x64" })
  const resolved = manager.resolveLibraries({ id: "1.20.1", libraries })
  const natives = resolved.filter(item => item.isNative)
  assert.equal(natives.length, 1)
  assert.equal(natives[0].name, "org.lwjgl:lwjgl-natives-windows:3.3.1")
  assert.equal(natives[0].includeInClasspath, false)
})
