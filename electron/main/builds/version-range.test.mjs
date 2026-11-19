import { test } from "node:test"
import assert from "node:assert/strict"
import { satisfiesLoaderRange, satisfiesLoaderRequirement } from "./version-range.ts"

test("caret ranges enforce the semver upper bound", () => {
  assert.equal(satisfiesLoaderRange("1.9.9", "^1.2.3"), true)
  assert.equal(satisfiesLoaderRange("2.0.0", "^1.2.3"), false)
  assert.equal(satisfiesLoaderRange("1.2.2", "^1.2.3"), false)
})

test("caret ranges handle zero-major compatibility", () => {
  assert.equal(satisfiesLoaderRange("0.2.9", "^0.2.3"), true)
  assert.equal(satisfiesLoaderRange("0.3.0", "^0.2.3"), false)
  assert.equal(satisfiesLoaderRange("0.0.4", "^0.0.3"), false)
})

test("tilde ranges stay within the requested minor version", () => {
  assert.equal(satisfiesLoaderRange("1.2.99", "~1.2.3"), true)
  assert.equal(satisfiesLoaderRange("1.3.0", "~1.2.3"), false)
  assert.equal(satisfiesLoaderRange("1.2.2", "~1.2.3"), false)
})

test("OR alternatives are evaluated independently", () => {
  const range = ">=1.0.0 || <0.5.0"
  assert.equal(satisfiesLoaderRange("1.4.0", range), true)
  assert.equal(satisfiesLoaderRange("0.4.9", range), true)
  assert.equal(satisfiesLoaderRange("0.8.0", range), false)
})

test("Maven inclusive and exclusive intervals remain supported", () => {
  assert.equal(satisfiesLoaderRange("47.2.0", "[47,48)"), true)
  assert.equal(satisfiesLoaderRange("48.0.0", "[47,48)"), false)
  assert.equal(satisfiesLoaderRange("47.0.0", "(47,48]"), false)
})

test("array requirements remain alternatives", () => {
  assert.equal(satisfiesLoaderRequirement("0.16.2", [">=0.16.0", ">=0.17.0"]), true)
  assert.equal(satisfiesLoaderRequirement("0.15.9", [">=0.16.0", ">=0.17.0"]), false)
})
