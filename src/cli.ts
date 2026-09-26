#!/usr/bin/env node
import { OpenCode } from "@opencode/sdk"
import { Command, Option } from "commander"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { text } from "node:stream/consumers"
import packageJSON from "../package.json" with { type: "json" }
import { getAuth, loadAuth, parseAuth, saveAuth, setAuth } from "./auth"
import { run } from "./run"

const collect = (value: string, previous: string[]) => [...previous, value]

type RunFlags = {
  directory?: string
  model?: string
  variant?: string
  agent?: string
  file: string[]
  title?: string
  thinking?: boolean
  auto?: boolean
  timeout: string
  authFile?: string
  authEnv?: string
  authOutput?: string
}

let cancellation: "SIGINT" | "SIGTERM" | "timeout" | undefined
let timeoutSeconds = 2700

async function executeRun(words: string[], options: RunFlags) {
  const directory = resolve(options.directory ?? process.cwd())
  const files = options.file.map((file) => resolve(directory, file))
  timeoutSeconds = Number(options.timeout)
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error("--timeout must be positive seconds")
  const piped = process.stdin.isTTY ? "" : (await text(process.stdin)).trim()
  const prompt = [words.join(" "), piped].filter(Boolean).join("\n")
  if (!prompt.trim()) throw new Error("Provide a prompt or pipe one through stdin")

  const controller = new AbortController()
  const cancel = (reason: "SIGINT" | "SIGTERM" | "timeout") => {
    // A second cancellation is a hard stop if a provider or cleanup is stuck.
    if (cancellation) process.exit(cancellation === "SIGTERM" ? 143 : cancellation === "SIGINT" ? 130 : 124)
    cancellation = reason
    process.exitCode = reason === "SIGINT" ? 130 : reason === "SIGTERM" ? 143 : 124
    controller.abort(new Error(reason))
    // CI may send only one signal; do not leave a stuck provider or request running forever.
    setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref()
  }
  const interrupt = () => cancel("SIGINT")
  const terminate = () => cancel("SIGTERM")
  process.on("SIGINT", interrupt)
  process.on("SIGTERM", terminate)
  const timer = setTimeout(() => cancel("timeout"), timeoutSeconds * 1000)
  try {
    const auth = options.authFile ? await loadAuth(options.authFile) : options.authEnv ? parseAuth(process.env[options.authEnv] ?? "") : undefined
    const temp = await mkdtemp(join(tmpdir(), "opencode-ci-"))
    const db = join(temp, "opencode.db")
    try {
      const opencode = await OpenCode.create({ database: { path: db } })
      try {
        if (auth) setAuth(db, auth)
        controller.signal.throwIfAborted()
        await run(opencode, {
          directory, model: options.model, variant: options.variant, agent: options.agent, files,
          title: options.title, thinking: options.thinking, auto: options.auto, prompt, signal: controller.signal,
        })
      } finally {
        await opencode.close()
        // Save refreshed tokens even if the session failed. Never print secrets to stdout.
        if (options.authOutput && auth) await saveAuth(options.authOutput, getAuth(db, Object.keys(auth)))
      }
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  } finally {
    clearTimeout(timer)
    process.off("SIGINT", interrupt)
    process.off("SIGTERM", terminate)
  }
}

const program = new Command()
  .name("opencode-ci")
  .description("Run OpenCode V2 in CI with subagent output")
  .version(packageJSON.version, "-v, --version")
  .showHelpAfterError()

const command = program.command("run")
  .description("Run a prompt (or pipe one through stdin)")
  .argument("[prompt...]", "prompt text")
  .option("--directory <path>", "project directory (default: current directory)")
  .option("-m, --model <provider/model#variant>", "model and optional variant")
  .option("--variant <name>", "model variant")
  .option("--agent <name>", "agent name")
  .option("-f, --file <path>", "include a file (repeatable)", collect, [])
  .option("--title <title>", "session title")
  .option("--thinking", "print reasoning blocks")
  .option("--auto", "approve permission requests once")
  .option("--timeout <seconds>", "timeout in seconds", "2700")
  .addOption(new Option("--auth-file <path>", "read auth JSON from a file").conflicts("authEnv"))
  .addOption(new Option("--auth-env <name>", "read auth JSON from an environment variable").conflicts("authFile"))
  .option("--auth-output <path>", "save refreshed auth JSON to a file")

command.action(async (words: string[], options: RunFlags) => {
  if (options.authOutput && !options.authFile && !options.authEnv)
    throw new Error("--auth-output requires --auth-file or --auth-env")
  await executeRun(words, options)
})

program.command("auth")
  .description("Manage auth JSON for CI")
  .command("export")
  .description("Export saved credentials from a local OpenCode database")
  .requiredOption("--db <path>", "OpenCode V2 database path")
  .option("--integration <id>", "integration to export (repeatable)", collect, [])
  .requiredOption("--output <path>", "destination JSON file (mode 0600)")
  .action(async (options: { db: string; integration: string[]; output: string }) => {
    if (!options.integration.length) throw new Error("--integration is required")
    const db = resolve(options.db)
    if (!(await stat(db)).isFile()) throw new Error(`Not a database file: ${db}`)
    await saveAuth(resolve(options.output), getAuth(db, options.integration))
    console.log(`Saved credentials for ${options.integration.join(", ")} to ${resolve(options.output)}`)
  })

try {
  await program.parseAsync(process.argv)
} catch (error) {
  if (cancellation === "SIGINT" || cancellation === "SIGTERM") {
    process.exitCode = cancellation === "SIGINT" ? 130 : 143
  } else if (cancellation === "timeout") {
    console.error(`Timed out after ${timeoutSeconds}s`)
    process.exitCode = 124
  } else {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
