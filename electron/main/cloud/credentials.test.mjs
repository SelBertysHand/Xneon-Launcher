import { test } from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_MICROSOFT_DEVICE_CLIENT_ID, resolveMicrosoftDeviceClientId } from "./credentials.ts"

test("uses the official public Microsoft device-flow client id when no custom id is configured", () => {
  assert.equal(resolveMicrosoftDeviceClientId(undefined), "00000000402b5328")
  assert.equal(resolveMicrosoftDeviceClientId(""), DEFAULT_MICROSOFT_DEVICE_CLIENT_ID)
  assert.equal(resolveMicrosoftDeviceClientId("   "), DEFAULT_MICROSOFT_DEVICE_CLIENT_ID)
})

test("preserves a configured Microsoft device-flow client id", () => {
  assert.equal(resolveMicrosoftDeviceClientId(" custom-client-id "), "custom-client-id")
})
