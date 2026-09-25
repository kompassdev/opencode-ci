#!/usr/bin/env bun
import { OpenCode } from "@opencode/sdk"
import { resolve } from "node:path"
import { run } from "./run"

const args = process.argv.slice(2)
const usage = "Usage: opencode-ci [--directory PATH] [--model provider/model#variant] [--variant NAME] [--agent NAME] [--file PATH] [--title TITLE] [--thinking] [--auto] [--timeout SECONDS] PROMPT (or pipe stdin)"
const value = (...flags: string[]) => {
  const index = args.findIndex((arg) => flags.includes(arg))
  if (index < 0) return undefined
  if (!args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error(`${args[index]} requires a value`)
  const result = args[index + 1]
  args.splice(index, 2)
  return result
}
const values = (...flags: string[]) => {
  const result: string[] = []
  for (let item = value(...flags); item !== undefined; item = value(...flags)) result.push(item)
  return result
}
const boolean = (flag: string) => {
  const index = args.indexOf(flag)
  if (index < 0) return false
  args.splice(index, 1)
  return true
}

try {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage)
    process.exit(0)
  }
  const directory = resolve(value("--directory") ?? process.cwd())
  const model = value("--model", "-m")
  const variant = value("--variant")
  const agent = value("--agent")
  const files = values("--file", "-f").map((file) => resolve(directory, file))
  const title = value("--title")
  const thinking = boolean("--thinking")
  const auto = boolean("--auto")
  const timeout = Number(value("--timeout") ?? "2700")
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("--timeout must be positive seconds")
  if (args.some((arg) => arg.startsWith("--"))) throw new Error(`Unknown option: ${args.find((arg) => arg.startsWith("--"))}`)
  const piped = process.stdin.isTTY ? "" : (await Bun.stdin.text()).trim()
  const prompt = [args.join(" "), piped].filter(Boolean).join("\n")
  if (!prompt.trim()) throw new Error(usage)

  await using opencode = await OpenCode.create()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout * 1000)
  try {
    await run(opencode, { directory, model, variant, agent, files, title, thinking, auto, prompt, signal: controller.signal })
    if (controller.signal.aborted) throw new Error(`Timed out after ${timeout}s`)
  } finally {
    clearTimeout(timer)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
