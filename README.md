# OpenCode CI

Run [OpenCode V2](https://opencode.ai/v2/docs/) in CI with logs that look like `opencode run`.

## What it adds to `opencode run`

- **Subagent output:** `run` shows the subagent tool call, but not the child's transcript. This client prints the child's steps, tools, and text with a dim-colored subagent name prefix in terminals and GitHub Actions (plain text in other redirected logs).
- **Slash commands:** A prompt starting with `/review` runs the project's `review` command instead of sending `/review` as plain text.
- **Skill mentions:** `@review` or `@skill:review` attaches the `review` skill when it exists in the project. `run` sends those mentions as plain text.

## Run it

Run it with `npx` and provide a model provider API key through the environment, or use an existing OpenAI OAuth credential (below):

```sh
OPENAI_API_KEY=... npx @kompassdev/opencode-ci run --model openai/gpt-6-luna 'Review this repository'
```

`npx` downloads the package and its SDK dependency when needed; it does not require a global installation. Prefer Bun? `bunx @kompassdev/opencode-ci run 'Review this repository'` works too. The packaged client runs on **Node.js 24+** either way; `bunx` also needs Bun.

Commands are `run`, `auth export`, and `--version`.

`opencode-ci` embeds OpenCode with `@opencode/sdk`: no OpenCode CLI, running service, or network server is required. It reads your global and project configuration and plugins, but uses a fresh, isolated credential database for each invocation. Supply supported provider API-key environment variables or an auth JSON file; it does **not** use your locally saved OpenCode logins. The SDK dependency is pinned because OpenCode does not yet expose a public credential import API.

When the main agent calls a subagent, the log can look like this:

```text
> build · gpt-6-sol
→ Read src/app.ts
reviewer > reviewer · gpt-6-sol
reviewer → Read src/app.test.ts
reviewer Found a missing assertion in src/app.test.ts.
reviewer ✓ Reviewer Agent
The review found one issue.
```

Use a project command or skill in the prompt:

```sh
npx @kompassdev/opencode-ci run '/review the changed tests'
npx @kompassdev/opencode-ci run 'Use @review to inspect the changes'
```

The command or skill must exist in the project. You can also pipe a multiline prompt through stdin.

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
        run: npx @kompassdev/opencode-ci run --model openrouter/anthropic/claude-sonnet-4 --directory "$GITHUB_WORKSPACE" --timeout 2400 'Review this repository for correctness and missing tests'
        timeout-minutes: 45
```

Add `OPENROUTER_API_KEY` as a repository secret, or replace the model and secret with your provider's setup. Pin npm package versions in a production workflow. Keep secrets out of logs; GitHub does not provide repository secrets to workflows triggered by pull requests from forks.

### Auth JSON

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

#### Export your local OpenCode login

After signing in with the OpenCode V2 CLI, export the preferred credential for `openai` (or another integration) from its local database:

```sh
npx @kompassdev/opencode-ci auth export \
  --db "$(opencode debug paths db)" \
  --integration openai \
  --output auth.json
```

The export **reads the database without changing it** and writes `auth.json` with owner-only permissions (0600). Repeat `--integration ID` to include more than one integration. It selects the active credential, or the newest when none is marked active. Only saved key and OAuth credentials can be exported; environment-based connections have no stored credential. If OpenCode is installed under a different command name or you know the database location, pass its path to `--db` directly. The output is sensitive: do not commit or print it. Add `auth.json` to your project's `.gitignore`. For a repository you control, upload it with `gh secret set OPENCODE2_AUTH < auth.json`, then delete your local copy when no longer needed.

Pass the JSON through `--auth-file PATH` or `--auth-env NAME`; do not put secrets directly in CLI arguments. `--auth-output PATH` writes the current credentials to a mode-0600 file after the run, including refreshed OAuth tokens, even when the session fails. The output contains only the integrations supplied on input.

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
| `--auth-env NAME` | Read auth JSON from an environment variable |
| `--auth-file PATH` | Read auth JSON from a file (instead of `--auth-env`) |
| `--auth-output PATH` | Save the potentially refreshed auth JSON to a file after the run |

The client starts a new session each time. Without `--auto`, it rejects permission requests rather than waiting for input. A failed session fails the job; SIGINT and SIGTERM interrupt active work. Session continuation, forking, and JSON output aren't supported yet.

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
