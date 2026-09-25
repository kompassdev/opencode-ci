import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveModel, run } from "../src/run"

function fixture(input: { prompt: string; children?: boolean; childFailed?: boolean; tool?: boolean; model?: string; variant?: string; thinking?: boolean; auto?: boolean; files?: string[] }) {
  const calls: { create?: unknown; command?: unknown; prompt?: unknown } = {}
  const output: string[] = []
  const client = {
    event: {
      subscribe: async function* (options: { signal: AbortSignal }) {
        yield { type: "server.connected", data: {} }
        await new Promise<void>((resolve) => options.signal.addEventListener("abort", () => resolve(), { once: true }))
      },
    },
    session: {
      create: async (value: unknown) => { calls.create = value; return { id: "root" } },
      command: async (value: unknown) => { calls.command = value },
      prompt: async (value: unknown) => { calls.prompt = value },
      wait: async () => {},
      list: async ({ parentID }: { parentID: string }) => ({
        data: input.children && parentID === "root" ? [{ id: "child", title: "reviewer" }] : [],
      }),
      get: async ({ sessionID }: { sessionID: string }) => ({ outcome: sessionID === "child" && input.childFailed ? "failed" : "succeeded" }),
      interrupt: async () => {},
    },
    skill: { list: async () => ({ data: [{ id: "review" }] }) },
    model: { default: async () => ({ data: { providerID: "openai", id: "gpt-6-sol" } }) },
    permission: { reply: async () => {} },
    message: {
      list: async ({ sessionID }: { sessionID: string }) => ({
        data: sessionID === "child"
          ? [{ id: "msg_child", type: "assistant", agent: "reviewer", model: { id: "gpt-6-sol" }, content: [{ type: "text", text: "child findings" }] }]
          : [{ id: "msg_root", type: "assistant", agent: "build", model: { id: "gpt-6-sol" }, content: [
            ...(input.tool ? [{ type: "tool", id: "tool_1", name: "read", state: { status: "completed", input: { path: "/workspace/src/app.ts" }, content: [{ type: "text", text: "contents" }] } }] : []),
            ...(input.thinking ? [{ type: "reasoning", text: "checking changes" }] : []),
            { type: "text", text: "summary" },
          ] }],
        cursor: { next: null },
      }),
    },
  }
  const execute = () => run(client as unknown as Parameters<typeof run>[0], {
    directory: "/workspace", prompt: input.prompt, model: input.model, variant: input.variant,
    thinking: input.thinking, auto: input.auto, files: input.files, write: (text) => output.push(text),
  })
  return { execute, calls, output }
}

test("dispatches slash commands to the command API", async () => {
  const test = fixture({ prompt: "/review important changes" })
  await test.execute()
  expect(test.calls.command).toEqual({ sessionID: "root", name: "review", text: "important changes" })
  expect(test.calls.prompt).toBeUndefined()
})

test("attaches skill mentions and includes child session output", async () => {
  const test = fixture({ prompt: "Please @review this", children: true })
  await test.execute()
  expect(test.calls.prompt).toEqual({ sessionID: "root", text: "Please @review this", skills: [
    { id: "review", mention: { start: 7, end: 14, text: "@review" } },
  ] })
  expect(test.output.join("")).toContain("[reviewer] child findings")
  expect(test.output.join("")).toContain("summary")
})

test("exits with an error when a child fails", async () => {
  const test = fixture({ prompt: "review", children: true, childFailed: true })
  expect(test.execute()).rejects.toThrow("Session child failed")
})

test("renders run-style step and tool lines with only child output prefixed", async () => {
  const test = fixture({ prompt: "review", children: true, tool: true })
  await test.execute()
  expect(test.output.join("")).toContain("> build · gpt-6-sol")
  expect(test.output.join("")).toContain("→ Read src/app.ts")
  expect(test.output.join("")).toContain("[reviewer] > reviewer · gpt-6-sol")
  expect(test.output.join("")).not.toContain("::group::")
})

test("selects a model and prints reasoning only when requested", async () => {
  const test = fixture({ prompt: "review", model: "openai/gpt-6-sol#high", thinking: true })
  await test.execute()
  expect(test.calls.create).toMatchObject({ model: { providerID: "openai", id: "gpt-6-sol", variant: "high" } })
  expect(test.output.join("")).toContain("Thinking: checking changes")
})

test("variant alone selects the default model", async () => {
  const test = fixture({ prompt: "review", variant: "high" })
  await test.execute()
  expect(test.calls.create).toMatchObject({ model: { providerID: "openai", id: "gpt-6-sol", variant: "high" } })
})

test("rejects invalid or conflicting model variants", () => {
  expect(() => resolveModel("not-a-model")).toThrow("Invalid model reference")
  expect(() => resolveModel("openai/gpt-6-sol#high", "low")).toThrow("conflicts")
})

test("includes text files with the prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-ci-"))
  try {
    const file = join(directory, "notes.txt")
    await writeFile(file, "Check the tests")
    const test = fixture({ prompt: "Review", files: [file] })
    await test.execute()
    expect(test.calls.prompt).toMatchObject({ text: 'Review\n\n<file name="notes.txt">\nCheck the tests\n</file>' })
  } finally {
    await rm(directory, { recursive: true })
  }
})
