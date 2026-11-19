import { test } from "node:test"
import assert from "node:assert/strict"
import { mergeLibraryMetadata } from "./library-enrichment.ts"

test("keeps Mojang native classifiers when loader meta only has a main artifact", () => {
  const merged = mergeLibraryMetadata(
    {
      name: "org.lwjgl:lwjgl:3.3.1",
      natives: { windows: "natives-windows" },
      downloads: {
        artifact: { url: "https://libraries.minecraft.net/lwjgl.jar", size: 100 },
        classifiers: {
          "natives-windows": { url: "https://libraries.minecraft.net/lwjgl-natives-windows.jar", size: 200 },
        },
      },
    },
    {
      name: "org.lwjgl:lwjgl:3.3.1",
      natives: {},
      downloads: { artifact: { url: "https://meta.example/lwjgl.jar" } },
      rules: [],
    },
  )
  assert.equal(merged.natives?.windows, "natives-windows")
  assert.equal(merged.downloads?.classifiers?.["natives-windows"]?.url, "https://libraries.minecraft.net/lwjgl-natives-windows.jar")
  assert.equal(merged.downloads?.artifact?.url, "https://meta.example/lwjgl.jar")
  assert.equal(merged.downloads?.artifact?.size, 100)
})

test("merges meta classifiers without dropping existing platform classifiers", () => {
  const merged = mergeLibraryMetadata(
    { name: "example:lib:1", downloads: { classifiers: { "natives-windows": { url: "https://a/win.jar" } } } },
    { name: "example:lib:1", downloads: { classifiers: { "natives-linux": { url: "https://a/linux.jar" } } } },
  )
  assert.equal(merged.downloads?.classifiers?.["natives-windows"]?.url, "https://a/win.jar")
  assert.equal(merged.downloads?.classifiers?.["natives-linux"]?.url, "https://a/linux.jar")
})
