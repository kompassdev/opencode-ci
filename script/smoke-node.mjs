import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { OpenCode } from "@opencode/sdk"
import packageJSON from "../package.json" with { type: "json" }

const help = spawnSync(process.execPath, ["dist/cli.js", "--help"], { encoding: "utf8" })
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /Usage: opencode-ci/)
const version = spawnSync(process.execPath, ["dist/cli.js", "--version"], { encoding: "utf8" })
assert.equal(version.status, 0, version.stderr)
assert.equal(version.stdout.trim(), packageJSON.version)
const missingCommand = spawnSync(process.execPath, ["dist/cli.js", "Hello"], { encoding: "utf8" })
assert.equal(missingCommand.status, 1, missingCommand.stderr)
assert.match(missingCommand.stderr, /Usage: opencode-ci run/)

const invalid = spawnSync(process.execPath, ["dist/cli.js", "run", "--model", "invalid", "Hello"], {
  encoding: "utf8", timeout: 60_000,
})
assert.equal(invalid.status, 1, invalid.error?.message ?? invalid.stderr)
assert.match(invalid.stderr, /Invalid model reference/)

const temp = mkdtempSync(join(tmpdir(), "opencode-ci-smoke-"))
try {
  const auth = {
    openai: { type: "oauth", methodID: "chatgpt-browser", access: "test-access", refresh: "test-refresh", expires: 123456, metadata: { accountID: "test-account" } },
    anthropic: { type: "key", key: "test-key" },
  }
  const output = join(temp, "refreshed.json")
  const failed = spawnSync(process.execPath, ["dist/cli.js", "run", "--auth-env", "TEST_AUTH", "--auth-output", output, "--model", "invalid", "Hello"], {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, TEST_AUTH: JSON.stringify(auth) },
  })
  assert.equal(failed.status, 1, failed.error?.message ?? failed.stderr)
  assert.match(failed.stderr, /Invalid model reference/)
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), auth)
  assert.equal(statSync(output).mode & 0o777, 0o600)

  const dbPath = join(temp, "opencode.db")
  const host = await OpenCode.create({ database: { path: dbPath } })
  await host.close()
  const db = new DatabaseSync(dbPath)
  try {
    db.prepare(`INSERT INTO credential (id, integration_id, label, value, active, time_created, time_updated)
      VALUES (?, ?, ?, ?, 1, ?, ?)`).run("cred_test", "openai", "OAuth", JSON.stringify(auth.openai), Date.now(), Date.now())
  } finally { db.close() }
  const exported = join(temp, "export.json")
  const result = spawnSync(process.execPath, ["dist/cli.js", "auth", "export", "--db", dbPath, "--integration", "openai", "--output", exported], { encoding: "utf8" })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  assert.deepEqual(JSON.parse(readFileSync(exported, "utf8")), { openai: auth.openai })
  assert.equal(statSync(exported).mode & 0o777, 0o600)
} finally { rmSync(temp, { recursive: true, force: true }) }
console.log("Node CLI and embedded OpenCode SDK smoke test passed")
