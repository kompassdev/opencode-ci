type Tool = {
  name: string
  input: Record<string, unknown>
  content?: ReadonlyArray<{ type: string; text?: string }>
  metadata?: Record<string, unknown>
  error?: string
  directory: string
  prefixed?: boolean
}

// The SDK exposes tool data, not @opencode/tui's private toolInlineInfo renderer.
// Keep the common run-style display rules here without depending on TUI internals.
export function renderTool(tool: Tool) {
  const input = tool.input
  const text = (value: unknown) => typeof value === "string" ? value : ""
  const path = text(input.path) || text(input.filePath)
  const file = path.startsWith(tool.directory + "/") ? path.slice(tool.directory.length + 1) : path
  const output = tool.content?.find((item) => item.type === "text")?.text?.trim() ?? ""
  const count = (value: unknown, label: string) => typeof value === "number" ? ` · ${value} ${label}${value === 1 ? "" : "es"}` : ""
  const label = (() => {
    if (tool.name === "shell") return { icon: "$", title: text(input.command), body: output }
    if (tool.name === "read") return { icon: "→", title: `Read ${file}` }
    if (tool.name === "list") return { icon: "→", title: `List ${file}` }
    if (tool.name === "write") return { icon: "←", title: `Write ${file}`, body: output }
    if (tool.name === "edit") return { icon: "←", title: `Edit ${file}`, body: text(tool.metadata?.diff) }
    if (tool.name === "glob" || tool.name === "grep") {
      const name = tool.name === "glob" ? "Glob" : "Grep"
      const matches = tool.name === "glob" ? tool.metadata?.count : tool.metadata?.matches
      return { icon: "✱", title: `${name} "${text(input.pattern)}"${file ? ` in ${file}` : ""}${count(matches, "match")}` }
    }
    if (tool.name === "subagent") {
      const agent = (text(input.agent) || text(input.subagent_type) || "unknown").replace(/\b\w/g, (letter) => letter.toUpperCase())
      return { icon: "✓", title: tool.prefixed ? `${agent} Agent` : `${text(input.description) || `${agent} Subagent`}${input.description ? ` · ${agent} Agent` : ""}` }
    }
    if (tool.name === "skill") return { icon: "→", title: `Skill "${text(tool.metadata?.name) || text(input.id)}"` }
    if (tool.name === "webfetch") return { icon: "%", title: `WebFetch ${text(input.url)}` }
    if (tool.name === "websearch") return { icon: "◈", title: `WebSearch "${text(input.query)}"` }
    if (tool.name === "patch") {
      const files = Array.isArray(tool.metadata?.files) ? tool.metadata.files.length : 0
      return { icon: "%", title: files ? `Patch ${files} file${files === 1 ? "" : "s"}` : "Patch" }
    }
    if (tool.name === "question") {
      const questions = Array.isArray(input.questions) ? input.questions.length : 0
      return { icon: "→", title: `Asked ${questions} question${questions === 1 ? "" : "s"}` }
    }
    return { icon: "⚙", title: `${tool.name} ${Object.keys(input).length ? JSON.stringify(input) : "Unknown"}` }
  })()

  const title = `${tool.error ? "✗" : label.icon} ${label.title}${tool.error ? " failed" : ""}`
  const block = "body" in label && label.body?.trim() && !tool.error
  return `${block ? "\n" : ""}${title}\n${block ? `${label.body!.trim()}\n\n` : ""}${tool.error ? `${tool.error}\n` : ""}`
}
