import type { OpenCodeClient } from "@opencode/client"
import { readFile, stat } from "node:fs/promises"
import { basename, extname } from "node:path"
import { renderTool } from "./render-tool"

type Client = Pick<OpenCodeClient, "session" | "message" | "event" | "skill" | "permission" | "model">

export type RunOptions = {
  directory: string
  prompt: string
  agent?: string
  title?: string
  model?: string
  variant?: string
  thinking?: boolean
  auto?: boolean
  files?: string[]
  signal?: AbortSignal
  write?: (text: string) => void
}

/** Run one CI turn. The caller owns the SDK host and closes it afterwards. */
export async function run(client: Client, options: RunOptions) {
  const write = options.write ?? ((text: string) => process.stdout.write(text))
  const controller = new AbortController()
  const events = client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
  // Subscribe before creating the session: subscriptions are live-only.
  const connected = await events.next()
  if (connected.done) throw new Error("OpenCode event stream disconnected")

  const sessions = new Map<string, { label: string; parentID?: string }>()
  const printed = new Map<string, string>()
  const headings = new Set<string>()
  const renderedTools = new Set<string>()
  const tools = new Map<string, { name: string; input: Record<string, unknown> }>()
  let failure: Error | undefined
  let rootID: string | undefined
  let interrupting: Promise<unknown> | undefined
  const stop = () => {
    if (rootID && !interrupting)
      interrupting = client.session.interrupt({ sessionID: rootID }, { signal: AbortSignal.timeout(5000) }).catch(() => {})
  }
  options.signal?.addEventListener("abort", stop, { once: true })
  const checkCancelled = () => options.signal?.throwIfAborted()

  const print = (sessionID: string, messageID: string, ordinal: number, text: string) => {
    const key = `${messageID}:text:${ordinal}`
    const previous = printed.get(key) ?? ""
    if (previous === text) return
    const delta = text.startsWith(previous) ? text.slice(previous.length) : text
    printed.set(key, text)
    if (!delta.trim()) return
    line(sessionID, `${delta.trim()}\n`)
  }

  const reasoning = (sessionID: string, messageID: string, ordinal: number, text: string) => {
    if (!options.thinking) return
    const key = `${messageID}:reasoning:${ordinal}`
    const previous = printed.get(key) ?? ""
    if (previous === text) return
    const delta = text.startsWith(previous) ? text.slice(previous.length) : text
    printed.set(key, text)
    if (delta.trim()) line(sessionID, `Thinking: ${delta.trim()}\n`)
  }

  const line = (sessionID: string, text: string) => {
    const session = sessions.get(sessionID)
    if (!session?.parentID) return write(text)
    write(text.split("\n").map((row) => row ? `[${session.label}] ${row}` : "").join("\n"))
  }

  const heading = (sessionID: string, messageID: string, agent: string, model: string) => {
    if (headings.has(messageID)) return
    headings.add(messageID)
    line(sessionID, `\n> ${agent} · ${model}\n\n`)
  }

  const toolLine = (sessionID: string, messageID: string, id: string, name: string, input: Record<string, unknown>, content?: ReadonlyArray<{ type: string; text?: string }>, metadata?: Record<string, unknown>, error?: string) => {
    const key = `${messageID}:${id}`
    if (renderedTools.has(key)) return
    renderedTools.add(key)
    line(sessionID, renderTool({ name, input, content, metadata, error, directory: options.directory }))
  }

  const consume = (async () => {
    while (!controller.signal.aborted) {
      const item = await events.next()
      if (item.done) {
        if (!controller.signal.aborted) failure = new Error("OpenCode event stream disconnected")
        return
      }
      const event = item.value
      if (event.type === "session.created" && event.data.parentID && sessions.has(event.data.parentID)) {
        sessions.set(event.data.sessionID, { label: event.data.title ?? event.data.sessionID, parentID: event.data.parentID })
      }
      if (!("sessionID" in event.data) || !sessions.has(event.data.sessionID)) continue
      if (event.type === "session.text.ended") {
        print(event.data.sessionID, event.data.assistantMessageID, event.data.ordinal, event.data.text)
      }
      if (event.type === "session.reasoning.ended") {
        reasoning(event.data.sessionID, event.data.assistantMessageID, event.data.ordinal, event.data.text)
      }
      if (event.type === "session.step.started") {
        heading(event.data.sessionID, event.data.assistantMessageID, event.data.agent, event.data.model.id)
      }
      if (event.type === "session.tool.input.started") {
        tools.set(`${event.data.assistantMessageID}:${event.data.id}`, { name: event.data.name, input: {} })
      }
      if (event.type === "session.tool.called") {
        const key = `${event.data.assistantMessageID}:${event.data.id}`
        tools.set(key, { name: tools.get(key)?.name ?? "tool", input: event.data.input })
      }
      if (event.type === "session.tool.success" || event.type === "session.tool.failed") {
        const key = `${event.data.assistantMessageID}:${event.data.id}`
        const tool = tools.get(key)
        tools.delete(key)
        toolLine(event.data.sessionID, event.data.assistantMessageID, event.data.id, tool?.name ?? "tool", tool?.input ?? {}, event.data.content, event.data.metadata, event.type === "session.tool.failed" ? event.data.error.message : undefined)
      }
      if (event.type === "session.execution.failed") {
        line(event.data.sessionID, `Error: ${event.data.error.message}\n`)
        failure = new Error(event.data.error.message)
      }
      if (event.type === "permission.asked") {
        // CI cannot answer a prompt. Reject it rather than hanging indefinitely.
        await client.permission.reply({ sessionID: event.data.sessionID, requestID: event.data.id, decision: options.auto ? "once" : "reject" })
        if (!options.auto) failure = new Error(`Permission denied: ${event.data.action} (${event.data.resources.join(", ")})`)
      }
    }
  })().catch((error: unknown) => {
    if (!controller.signal.aborted) failure = error instanceof Error ? error : new Error(String(error))
  })

  try {
    checkCancelled()
    const model = resolveModel(options.model, options.variant)
      ?? (options.variant ? await client.model.default({ location: { directory: options.directory } }).then((result) => {
        if (!result.data) throw new Error("Cannot select a variant before selecting a model")
        return { providerID: result.data.providerID, id: result.data.id, variant: options.variant }
      }) : undefined)
    const session = await client.session.create({
      location: { directory: options.directory },
      agent: options.agent,
      model,
      title: options.title,
    }, { signal: options.signal })
    rootID = session.id
    sessions.set(rootID, { label: "main" })
    if (options.signal?.aborted) stop()
    checkCancelled()

    const prepared = await Promise.all((options.files ?? []).map(async (file) => {
      checkCancelled()
      const info = await stat(file).catch(() => { throw new Error(`File not found: ${file}`) })
      if (!info.isFile()) throw new Error(`Not a regular file: ${file}`)
      if (info.size > 10 * 1024 * 1024) throw new Error(`File larger than 10 MiB: ${file}`)
      const bytes = await readFile(file)
      const mime = new Map([
        [".pdf", "application/pdf"], [".png", "image/png"], [".jpg", "image/jpeg"],
        [".jpeg", "image/jpeg"], [".gif", "image/gif"], [".webp", "image/webp"],
        [".svg", "image/svg+xml"], [".avif", "image/avif"], [".bmp", "image/bmp"],
      ]).get(extname(file).toLowerCase()) ?? "text/plain"
      if (mime.startsWith("image/") || mime === "application/pdf") {
        return { attachment: { uri: `data:${mime};base64,${bytes.toString("base64")}`, name: basename(file) } }
      }
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
        if (bytes.includes(0)) throw new Error("binary")
        return { text: `<file name="${basename(file)}">\n${text}\n</file>` }
      } catch {
        throw new Error(`Unsupported binary file: ${file}`)
      }
    }))
    const prompt = [options.prompt.trim(), ...prepared.flatMap((item) => item.text ? [item.text] : [])].join("\n\n")
    const files = prepared.flatMap((item) => item.attachment ? [item.attachment] : [])
    checkCancelled()
    const slash = /^\/([\w.-]+)(?:\s+([\s\S]*))?$/.exec(prompt)
    if (slash) {
      await client.session.command({ sessionID: rootID, name: slash[1]!, text: slash[2] ?? "", files: files.length ? files : undefined }, { signal: options.signal })
    } else {
      const available = await client.skill.list({ location: { directory: options.directory } })
      const names = new Set(available.data.map((skill) => skill.id))
      const skills = [...prompt.matchAll(/(^|\s)@(?:skill:)?([\w.-]+)/g)]
        .filter((match) => names.has(match[2]!))
        .map((match) => ({
          id: match[2]!,
          mention: { start: match.index + match[1]!.length, end: match.index + match[0]!.length, text: match[0]!.trim() },
        }))
      await client.session.prompt({ sessionID: rootID, text: prompt, files: files.length ? files : undefined, skills }, { signal: options.signal })
    }

    checkCancelled()
    await client.session.wait({ sessionID: rootID }, { signal: options.signal })
    checkCancelled()

    // Child sessions are separate streams. Reconcile persisted messages as well as
    // live events so fast children and event-stream gaps do not hide their output.
    const pending = [rootID]
    for (const id of pending) {
      checkCancelled()
      const children = await client.session.list({ parentID: id, limit: 200 }, { signal: options.signal })
      for (const child of children.data) {
        sessions.set(child.id, { label: child.title ?? child.id, parentID: id })
        if (!pending.includes(child.id)) pending.push(child.id)
      }
    }
    for (const id of pending.slice(1)) {
      checkCancelled()
      await client.session.wait({ sessionID: id }, { signal: options.signal })
    }
    for (const id of pending) {
      checkCancelled()
      let cursor: string | undefined
      const messages = [] as Awaited<ReturnType<Client["message"]["list"]>>["data"][number][]
      do {
        const page = await client.message.list({ sessionID: id, order: "desc", limit: 200, cursor }, { signal: options.signal })
        messages.push(...page.data)
        cursor = page.cursor.next ?? undefined
      } while (cursor)
      for (const message of messages.reverse()) {
        if (message.type !== "assistant") continue
        // Match run's step header even when a fast step finished before the live subscription saw it.
        if (message.content.length && !printed.has(`${message.id}:text:0`)) heading(id, message.id, message.agent, message.model.id)
        let ordinal = 0
        let reasoningOrdinal = 0
        for (const content of message.content) {
          if (content.type === "text") print(id, message.id, ordinal++, content.text)
          if (content.type === "reasoning") reasoning(id, message.id, reasoningOrdinal++, content.text)
          if (content.type === "tool" && (content.state.status === "completed" || content.state.status === "error")) {
            toolLine(id, message.id, content.id, content.name, content.state.input, content.state.content, content.state.metadata,
              content.state.status === "error" ? content.state.error.message : undefined)
          }
        }
        if (message.error) failure = new Error(message.error.message)
      }
      const result = await client.session.get({ sessionID: id }, { signal: options.signal })
      if (result.outcome === "failed" || result.outcome === "interrupted")
        failure ??= new Error(`Session ${id} ${result.outcome}`)
    }
    checkCancelled()
    if (failure) throw failure
    return session.id
  } finally {
    options.signal?.removeEventListener("abort", stop)
    controller.abort()
    void events.return?.(undefined).catch(() => {})
    await consume
    await interrupting
  }
}

export function resolveModel(input?: string, variant?: string) {
  if (!input) return undefined
  const match = /^([^/#]+)\/([^#]+)(?:#([^#]+))?$/.exec(input)
  if (!match) throw new Error(`Invalid model reference: ${input} (expected provider/model#variant)`)
  if (variant && match[3] && variant !== match[3]) throw new Error("--variant conflicts with the variant in --model")
  return { providerID: match[1]!, id: match[2]!, variant: variant ?? match[3] }
}
