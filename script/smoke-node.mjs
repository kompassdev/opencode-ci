import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

const help = spawnSync(process.execPath, ["dist/cli.js", "--help"], { encoding: "utf8" })
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /Usage: opencode-ci/)

// Verify the embedded host itself, not just the CLI's argument parser.
process.env.OPENCODE_DB = ":memory:"
const { OpenCode } = await import("@opencode/sdk")
const host = await OpenCode.create()
const controller = new AbortController()
try {
  const events = host.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
  assert.equal((await events.next()).value.type, "server.connected")
  const session = await host.session.create({ location: { directory: process.cwd() } })
  assert.match(session.id, /^ses_/)
} finally {
  controller.abort()
  await host.close()
}
console.log("Node CLI and embedded SDK smoke test passed")
