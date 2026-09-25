# OpenCode CI

Run [OpenCode V2](https://opencode.ai/v2/docs/) in CI with logs that look like `opencode run`.

## What it adds to `opencode run`

- **Subagent output:** `run` shows the subagent tool call, but not the child's transcript. This client prints the child's steps, tools, and text with a `[subagent name]` prefix.
- **Slash commands:** A prompt starting with `/review` runs the project's `review` command instead of sending `/review` as plain text.
- **Skill mentions:** `@review` or `@skill:review` attaches the `review` skill when it exists in the project. `run` sends those mentions as plain text.

## Run it

From a project with OpenCode credentials configured:

```sh
npx @kompassdev/opencode-ci@0.1.2 'Review this repository'
```

Prefer Bun? `bunx @kompassdev/opencode-ci@0.1.2 'Review this repository'` works too. The packaged CLI runs on **Node.js 24+** either way; `bunx` also needs Bun.

When the main agent calls a subagent, the log can look like this:

```text
> build · gpt-6-sol
→ Read src/app.ts
[reviewer] > reviewer · gpt-6-sol
[reviewer] → Read src/app.test.ts
[reviewer] Found a missing assertion in src/app.test.ts.
The review found one issue.
```

Use a project command or skill in the prompt:

```sh
npx @kompassdev/opencode-ci@0.1.2 '/review the changed tests'
npx @kompassdev/opencode-ci@0.1.2 'Use @review to inspect the changes'
```

The command or skill must exist in the project. You can also pipe a multiline prompt through stdin.

## GitHub Actions

After checkout, Node setup, and OpenCode authentication:

```yaml
- name: Review
  run: npx @kompassdev/opencode-ci@0.1.2 --directory "$GITHUB_WORKSPACE" --timeout 2400 '/review'
  timeout-minutes: 45
```

The job needs your model credentials and project configuration. Keep secrets out of the logs. Pin the CLI version in CI so a new release doesn't change the job unexpectedly; omit `@0.1.2` to use the latest published version. The CLI accepts compatible OpenCode SDK 2.x versions (`^2.0.16`).

## Options

| Flag | What it does |
| --- | --- |
| `--directory PATH` | Work in a project directory (default: current directory) |
| `--model provider/model#variant`, `-m` | Choose a model and optional variant |
| `--variant NAME` | Use a variant of the chosen or default model |
| `--agent NAME` | Choose an agent |
| `--file PATH`, `-f` | Include a file, up to 10 MiB; repeat for multiple files |
| `--thinking` | Print reasoning blocks when available |
| `--auto` | Approve each permission request once |
| `--title TITLE` | Set the session title |
| `--timeout SECONDS` | Stop after this many seconds (default: 2700) |

The client starts a new session each time. Without `--auto`, it rejects permission requests rather than waiting for input. A failed session fails the job; SIGINT and SIGTERM interrupt active work. Session continuation, forking, and JSON output aren't supported yet.

## Working on this project

The published CLI runs on Node. Building this repository still uses Bun:

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run smoke:node
npm pack --dry-run
```

`npm publish` builds the package automatically through `prepack`. It requires publish access to `@kompassdev`.
