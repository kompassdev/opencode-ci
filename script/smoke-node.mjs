import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

const help = spawnSync(process.execPath, ["dist/cli.js", "--help"], { encoding: "utf8" })
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /Usage: opencode-ci/)

// Invalid model syntax fails after starting the private server, before a model request.
const startup = spawnSync(process.execPath, ["dist/cli.js", "--model", "invalid", "Hello"], {
  encoding: "utf8",
  timeout: 60_000,
  env: { ...process.env, OPENCODE_DB: ":memory:" },
})
assert.equal(startup.status, 1, startup.error?.message ?? startup.stderr)
assert.match(startup.stderr, /Invalid model reference/)
console.log("Node CLI and private OpenCode server smoke test passed")
