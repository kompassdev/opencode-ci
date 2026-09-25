import { expect, test } from "bun:test"
import { renderTool } from "../src/render-tool"

const directory = "/workspace"

test("renders common tools like run, including shell output", () => {
  expect(renderTool({ directory, name: "grep", input: { pattern: "TODO", path: "/workspace/src" }, metadata: { matches: 2 } }))
    .toBe('✱ Grep "TODO" in src · 2 matches\n')
  expect(renderTool({ directory, name: "shell", input: { command: "bun test" }, content: [{ type: "text", text: "4 pass" }] }))
    .toBe("\n$ bun test\n4 pass\n\n")
  expect(renderTool({ directory, name: "edit", input: { path: "/workspace/src/a.ts" }, metadata: { diff: "-a\n+b" } }))
    .toBe("\n← Edit src/a.ts\n-a\n+b\n\n")
})

test("renders subagent completion labels like opencode run", () => {
  expect(renderTool({ directory, name: "subagent", input: { agent: "general", description: "Say hi from subagent one" } }))
    .toBe("✓ Say hi from subagent one · General Agent\n")
  expect(renderTool({ directory, name: "subagent", input: { agent: "code-review" } }))
    .toBe("✓ Code-Review Subagent\n")
  expect(renderTool({ directory, name: "subagent", input: { agent: "general", description: "reviewer" }, prefixed: true }))
    .toBe("✓ General Agent\n")
})
