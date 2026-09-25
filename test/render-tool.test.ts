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
