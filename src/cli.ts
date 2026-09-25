#!/usr/bin/env bun
import { OpenCode } from "@opencode/sdk"
import { resolve } from "node:path"
import { run } from "./run"

const args = process.argv.slice(2)
const usage = "Usage: opencode-ci [--directory PATH] [--agent NAME] [--title TITLE] [--timeout SECONDS] PROMPT (or pipe stdin)"
const value = (flag: string) => {
  const index = args.indexOf(flag)
  if (index < 0) return undefined
  if (!args[index + 1]) throw new Error(`${flag} requires a value`)
  const result = args[index + 1]
  args.splice(index, 2)
  return result
}

try {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage)
    process.exit(0)
  }
  const directory = resolve(value("--directory") ?? process.cwd())
  const agent = value("--agent")
  const title = value("--title")
  const timeout = Number(value("--timeout") ?? "2700")
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("--timeout must be positive seconds")
  if (args.some((arg) => arg.startsWith("--"))) throw new Error(`Unknown option: ${args.find((arg) => arg.startsWith("--"))}`)
  const prompt = args.join(" ") || (process.stdin.isTTY ? "" : await Bun.stdin.text())
  if (!prompt.trim()) throw new Error(usage)

  await using opencode = await OpenCode.create()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout * 1000)
  try {
    await run(opencode, { directory, agent, title, prompt, signal: controller.signal })
    if (controller.signal.aborted) throw new Error(`Timed out after ${timeout}s`)
  } finally {
    clearTimeout(timer)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
