# OpenCode CI

Run [OpenCode V2](https://opencode.ai/v2/docs/) in CI with:

- **Subagent output** — see child agents' steps and responses in the log.
- **`/commands`** — run project commands from a prompt.
- **`@skills`** — attach project skills by mentioning them.
- **OAuth via `auth.json`** — use a ChatGPT Plus/Pro (Codex) login in CI instead of an API key.

## Quick start

Sign in to OpenCode with `opencode auth login openai` and choose **ChatGPT Pro/Plus (headless)**, then [export that login to `auth.json`](#export-your-local-opencode-login). Run the client without a global installation:

### Subagent output

```sh
npx @kompassdev/opencode-ci run --auth-file=auth.json --model openai/gpt-6-luna 'Have a subagent review the tests, then summarize its findings'
```

When the agent calls a subagent, its steps and text appear in the log (unlike `opencode run`, which shows only the tool call):

```text
> build · gpt-6-sol
→ Read src/app.ts
Review tests > general · gpt-6-sol
Review tests → Read src/app.test.ts
Review tests Found a missing assertion in src/app.test.ts.
Review tests ✓ General Agent
The review found one issue.
```

Child output streams as events arrive, including events from overlapping subagents. Recovering missed child messages does not pause the live event stream; saved messages are printed before that subagent's completion line.

### `/command`

Run a command defined in your OpenCode project:

```sh
npx @kompassdev/opencode-ci run --auth-file=auth.json '/review the changed tests'
```

### `@skill`

Attach a skill defined in your OpenCode project. This example uses `bunx` instead of `npx`:

```sh
bunx @kompassdev/opencode-ci run --auth-file=auth.json 'Use @review to inspect the changes'
```

`@skill:review` also works. The command or skill must exist in the project.

### `auth.json`

Use your exported OAuth login without putting tokens in command arguments:

```sh
npx @kompassdev/opencode-ci run --auth-file=auth.json --model openai/gpt-6-luna 'Review this repository'
```

See [exporting your login](#export-your-local-opencode-login) and [saving refreshed tokens](#auth-json-format-and-token-refresh) below. Keep `auth.json` out of version control.

`npx` downloads the package and its SDK dependency when needed. The packaged client requires **Node.js 24+** even when launched with `bunx` (which also requires Bun). You can pipe a multiline prompt through stdin. `opencode-ci` embeds OpenCode with `@opencode/sdk`, so it needs no installed OpenCode CLI or running service. It reads your global and project configuration and plugins, but uses an isolated credential database per invocation: it does **not** automatically use your locally saved OpenCode logins.

## GitHub Actions

This manual workflow runs `opencode-ci` with `npx` and a provider key. It does not need to install OpenCode or this client globally:

```yaml
name: Review with OpenCode
on: workflow_dispatch

permissions:
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - name: Review
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        run: npx @kompassdev/opencode-ci run --model openrouter/anthropic/claude-sonnet-4 'Review this repository for correctness and missing tests'
        timeout-minutes: 45
```

Add `OPENROUTER_API_KEY` as a repository secret, or replace the model and secret with your provider's setup. Pin npm package versions in a production workflow. Keep secrets out of logs; GitHub does not provide repository secrets to workflows triggered by pull requests from forks.

## Command options

Commands are `run`, `auth export`, and `--version`. For example:

```sh
npx @kompassdev/opencode-ci run --auth-file=auth.json --model openai/gpt-6-luna --agent build 'Review the changed files'
```

| `run` flag | What it does |
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
| `--auth-env NAME` | Read auth JSON from an environment variable |
| `--auth-file PATH` | Read auth JSON from a file (instead of `--auth-env`) |
| `--auth-output PATH` | Save the potentially refreshed auth JSON to a file after the run |

The client starts a new session each time. Without `--auto`, it rejects permission requests rather than waiting for input. A failed session fails the job; SIGINT and SIGTERM interrupt active work. Session continuation, forking, and JSON output aren't supported yet.

## Auth JSON format and token refresh

Use a single JSON object keyed by OpenCode **integration ID**, with one active credential per integration. The two supported credential types are `oauth` and `key`:

```json
{
  "openai": {
    "type": "oauth",
    "methodID": "chatgpt-browser",
    "access": "...",
    "refresh": "...",
    "expires": 1234567890000,
    "metadata": { "accountID": "..." }
  },
  "anthropic": { "type": "key", "key": "..." }
}
```

`expires` is a Unix timestamp in milliseconds. OAuth `methodID` and provider-specific `metadata` must match the integration's authentication method; `metadata` is optional. Key credentials can also have `metadata` and `configuration` objects where the integration needs them. For common API-key providers, their native environment variable (such as `ANTHROPIC_API_KEY`) is simpler than including a key in this file. The legacy OpenAI `{ "openai": { "type": "oauth", "access": "...", "refresh": "...", "expires": 1234567890000, "accountId": "..." } }` format is accepted on input and converted to the new format on output.

### Export your local OpenCode login

After signing in with the OpenCode V2 CLI, export the preferred credential for `openai` (or another integration) from its local database:

```sh
npx @kompassdev/opencode-ci auth export \
  --db "$(opencode debug paths db)" \
  --integration openai \
  --output auth.json
```

The export **reads the database without changing it** and writes `auth.json` with owner-only permissions (0600). Repeat `--integration ID` to include more than one integration. It selects the active credential, or the newest when none is marked active. Only saved key and OAuth credentials can be exported; environment-based connections have no stored credential. If OpenCode is installed under a different command name or you know the database location, pass its path to `--db` directly. The output is sensitive: do not commit or print it. Add `auth.json` to your project's `.gitignore`. For a repository you control, upload it with `gh secret set OPENCODE2_AUTH < auth.json`, then delete your local copy when no longer needed.

Pass the JSON through `--auth-file PATH` or `--auth-env NAME`; do not put secrets directly in CLI arguments. `--auth-output PATH` writes the current credentials to a mode-0600 file after the run, including refreshed OAuth tokens, even when the session fails. The output contains only the integrations supplied on input.

### GitHub Actions with OAuth

For example, store the **entire JSON object** as a repository secret named `OPENCODE2_AUTH`, then use this workflow. It does not need OpenCode installed; `npx` fetches the client and SDK. `PAT_TOKEN` must be allowed to update repository Actions secrets:

```yaml
name: Review with ChatGPT OAuth
on: workflow_dispatch

permissions:
  contents: read

concurrency:
  group: opencode-oauth-${{ github.repository }}
  cancel-in-progress: false

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - name: Review
        id: review
        env:
          OPENCODE2_AUTH: ${{ secrets.OPENCODE2_AUTH }}
        run: npx @kompassdev/opencode-ci run --auth-env OPENCODE2_AUTH --auth-output "$RUNNER_TEMP/opencode-auth.json" --model openai/gpt-6-luna 'Review this repository'
      - name: Save refreshed OAuth tokens
        if: always() && steps.review.outcome != 'skipped'
        env:
          GH_TOKEN: ${{ secrets.PAT_TOKEN }}
        run: |
          if [ -s "$RUNNER_TEMP/opencode-auth.json" ]; then
            gh secret set OPENCODE2_AUTH --repo "$GITHUB_REPOSITORY" < "$RUNNER_TEMP/opencode-auth.json"
            rm -f "$RUNNER_TEMP/opencode-auth.json"
          fi
```

For a local file instead, run `npx @kompassdev/opencode-ci run --auth-file auth.json --auth-output auth.json --model openai/gpt-6-luna 'Reply OK'`. Keep `auth.json` out of version control. The credential bundle is never printed by the CLI. The credentials are isolated to each invocation; a later run must provide the updated bundle. Pin the `npx` package version for production CI.

**Use a secret, not Actions cache, for OAuth tokens.** Cache entries can be read by workflows in their cache scope, are immutable and subject to eviction, and are not designed for rotating credentials. GitHub's default `GITHUB_TOKEN` cannot update Actions secrets; use a suitably scoped PAT or GitHub App token for the save step. Do not expose the secret or the save token to untrusted pull requests. Runs that share a refresh token must not overlap: use the same concurrency group across those workflows, or a central credential store. If a provider invalidates idle refresh tokens, add a scheduled keep-alive run that loads and saves the same secret.

## Working on this project

The CLI runs on Node without an installed OpenCode CLI. Building this repository still uses Bun:

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run smoke:node
npm pack --dry-run
```

`npm publish` builds the package automatically through `prepack`. It requires publish access to `@kompassdev`.
