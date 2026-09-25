import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveModel, run } from "../src/run"

function fixture(input: { prompt: string; children?: boolean; childFailed?: boolean; tool?: boolean; subagent?: boolean; model?: string; variant?: string; thinking?: boolean; auto?: boolean; files?: string[]; signal?: AbortSignal; waitForAbort?: boolean; paginated?: boolean }) {
  const calls: { create?: unknown; command?: unknown; prompt?: unknown; interrupted?: string; messages: unknown[] } = { messages: [] }
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
      wait: async (_: unknown, options?: { signal?: AbortSignal }) => {
        if (!input.waitForAbort) return
        await new Promise<void>((_, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true }))
      },
      list: async ({ parentID }: { parentID: string }) => ({
        data: input.children && parentID === "root" ? [{ id: "child", title: "reviewer" }] : [],
      }),
      get: async ({ sessionID }: { sessionID: string }) => ({ outcome: sessionID === "child" && input.childFailed ? "failed" : "succeeded" }),
      interrupt: async ({ sessionID }: { sessionID: string }) => { calls.interrupted = sessionID },
    },
    skill: { list: async () => ({ data: [{ id: "review" }] }) },
    model: { default: async () => ({ data: { providerID: "openai", id: "gpt-6-sol" } }) },
    permission: { reply: async () => {} },
    message: {
      list: async (params: { sessionID: string; cursor?: string; order?: string }) => {
        calls.messages.push(params)
        if (params.cursor && params.order) throw new Error("Cursor cannot be combined with order")
        return {
          data: params.sessionID === "child"
            ? [{ id: "msg_child", type: "assistant", agent: "reviewer", model: { id: "gpt-6-sol" }, content: [{ type: "text", text: "child findings" }] }]
            : [{ id: "msg_root", type: "assistant", agent: "build", model: { id: "gpt-6-sol" }, content: [
              ...(input.tool ? [{ type: "tool", id: "tool_1", name: "read", state: { status: "completed", input: { path: "/workspace/src/app.ts" }, content: [{ type: "text", text: "contents" }] } }] : []),
              ...(input.subagent ? [{ type: "tool", id: "tool_2", name: "subagent", state: { status: "completed", input: { agent: "general", description: "reviewer" }, content: [] } }] : []),
              ...(input.thinking ? [{ type: "reasoning", text: "checking changes" }] : []),
              { type: "text", text: "summary" },
            ] }],
          cursor: { next: input.paginated && !params.cursor ? "next-page" : null },
        }
      },
    },
  }
  const execute = () => run(client as unknown as Parameters<typeof run>[0], {
    directory: "/workspace", prompt: input.prompt, model: input.model, variant: input.variant,
    thinking: input.thinking, auto: input.auto, files: input.files, signal: input.signal, write: (text) => output.push(text),
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
  expect(test.output.join("")).toContain("reviewer child findings")
  expect(test.output.join("")).toContain("summary")
})

test("uses a dim subagent name prefix in terminals", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
  const noColor = process.env.NO_COLOR
  try {
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
    delete process.env.NO_COLOR
    const test = fixture({ prompt: "Say hi", children: true })
    await test.execute()
    expect(test.output.join("")).toContain("\x1b[90mreviewer\x1b[0m child findings")
    expect(test.output.join("")).not.toContain("\n\n\n")
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor)
    else Reflect.deleteProperty(process.stdout, "isTTY")
    if (noColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = noColor
  }
})

test("prefixes the subagent finish without repeating its name", async () => {
  const test = fixture({ prompt: "Ask reviewer", children: true, subagent: true })
  await test.execute()
  const output = test.output.join("")
  expect(output).toContain("reviewer > reviewer · gpt-6-sol")
  expect(output).toContain("reviewer ✓ General Agent")
  expect(output).not.toContain("✓ reviewer")
  expect(output).not.toContain("\n\n")
})

test("uses the colored prefix in GitHub Actions unless NO_COLOR is set", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
  const github = process.env.GITHUB_ACTIONS
  const noColor = process.env.NO_COLOR
  try {
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false })
    process.env.GITHUB_ACTIONS = "true"
    delete process.env.NO_COLOR
    const colored = fixture({ prompt: "Say hi", children: true })
    await colored.execute()
    expect(colored.output.join("")).toContain("\x1b[90mreviewer\x1b[0m child findings")

    process.env.NO_COLOR = "1"
    const plain = fixture({ prompt: "Say hi", children: true })
    await plain.execute()
    expect(plain.output.join("")).toContain("reviewer child findings")
    expect(plain.output.join("")).not.toContain("\x1b[")
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor)
    else Reflect.deleteProperty(process.stdout, "isTTY")
    if (github === undefined) delete process.env.GITHUB_ACTIONS
    else process.env.GITHUB_ACTIONS = github
    if (noColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = noColor
  }
})

test("paginates messages without combining cursor and order", async () => {
  const test = fixture({ prompt: "Hello there", paginated: true })
  await test.execute()
  expect(test.calls.messages).toEqual([
    { sessionID: "root", limit: 200, order: "desc" },
    { sessionID: "root", limit: 200, cursor: "next-page" },
  ])
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
  expect(test.output.join("")).toContain("reviewer > reviewer · gpt-6-sol")
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

test("aborting a run interrupts the active session and cancels its wait", async () => {
  const controller = new AbortController()
  const test = fixture({ prompt: "review", signal: controller.signal, waitForAbort: true })
  const pending = test.execute()
  setTimeout(() => controller.abort(new Error("SIGTERM")), 5)
  await expect(pending).rejects.toThrow("SIGTERM")
  expect(test.calls.interrupted).toBe("root")
})
