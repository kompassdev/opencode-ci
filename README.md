# OpenCode CI

Run OpenCode V2 in CI with readable logs for the main agent **and subagents**. It uses the [embedded SDK](https://opencode.ai/v2/docs/build/sdk), so you don't need to start an OpenCode server.

## Quick start

After `0.1.1` is published, use either command from a project with OpenCode credentials configured:

```sh
npx @kompassdev/opencode-ci 'Review this repository'
# or
bunx @kompassdev/opencode-ci 'Review this repository'
```

The published CLI requires **Node.js 24+**. `bunx` also requires Bun to launch it. No global install is needed. Pipe a multiline prompt on stdin if you prefer.

## In CI

After checkout, Node setup, and OpenCode authentication:

```yaml
- name: Review
  run: npx @kompassdev/opencode-ci@0.1.1 --directory "$GITHUB_WORKSPACE" --timeout 2400 '/review'
  timeout-minutes: 45
```

Pin `@0.1.1` in CI for reproducibility; omit the version to use the current release. This pins the **CI client**, not its OpenCode SDK dependency (`^2.0.16`). The job needs access to your model credentials and project configuration; don't print credentials in logs.

Output resembles `opencode run`, with a prefix for child sessions:

```text
> build · gpt-6-sol
→ Read src/app.ts
[reviewer] > reviewer · gpt-6-sol
[reviewer] Found a missing assertion in src/app.test.ts.
The review found one issue.
```

A failed session fails the job. SIGINT/SIGTERM interrupt the session; timeout defaults to 2700 seconds. Interactive permission requests are rejected by default rather than left waiting.

## Options

| Option | Purpose |
| --- | --- |
| `--directory PATH` | Project directory (default: current directory) |
| `--model provider/model#variant`, `-m` | Select a model and optional variant |
| `--variant NAME` | Select a variant of the chosen or default model |
| `--agent NAME` | Select an agent |
| `--file PATH`, `-f` | Attach a file (repeatable; up to 10 MiB each) |
| `--thinking` | Show reasoning blocks when available |
| `--auto` | Approve permission requests once |
| `--title TITLE` | Set the session title |
| `--timeout SECONDS` | Set the timeout (default: 2700) |

A leading `/command` runs a project command. `@review` or `@skill:review` attaches the skill named `review` when it exists in the project. The client creates a new session for each invocation; session continuation, forking, and JSON output are not implemented yet.

## Development

The published CLI runs on Node. Building it from this source checkout currently requires Bun:

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run smoke:node
npm pack --dry-run
```

`npm publish` builds the package automatically through `prepack` and requires publish access to `@kompassdev`.
