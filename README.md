# OpenCode CI client

A small, noninteractive V2 client built on [`@opencode/sdk`](https://opencode.ai/v2/docs/build/sdk). The SDK embeds OpenCode in the CI process; it does not need a separately managed HTTP service. Output follows `opencode run`'s step headings, completed text, and compact tool lines. Child-session output uses the same format with a `[subagent title]` prefix. The client reconciles persisted messages after execution and fails the job when any session fails. It rejects interactive permission requests rather than waiting forever.

Requires Bun and OpenCode V2 credentials. Once published, run without cloning this repository:

```sh
bunx @kompassdev/opencode-ci@0.1.0 --directory "$GITHUB_WORKSPACE" --timeout 2400 'Review this pull request'
```

You can also pipe a multiline prompt on stdin. Use `--agent NAME` to select an agent and `--title TITLE` to name the session. The checkout must have the OpenCode credentials and project configuration it needs; do not print credentials in CI logs.

Examples of V2 input routing:

```sh
bunx @kompassdev/opencode-ci@0.1.0 '/review the changed tests'  # session.command: executes /review
bunx @kompassdev/opencode-ci@0.1.0 'Use @review to inspect the changes'  # skill attachment
bunx @kompassdev/opencode-ci@0.1.0 'Use @skill:review to inspect the changes'  # explicit skill syntax
```

Slash commands are recognized at the beginning of the input. Skill mentions must match IDs returned by the project's skill list. Other `@` mentions remain normal text. Commands and skills are resolved by OpenCode in the selected directory; this client does not read or interpolate their files itself.

Example GitHub Actions step after checkout, Bun setup, and authentication (pin the version in CI):

```yaml
- name: Review
  run: bunx @kompassdev/opencode-ci@0.1.0 --directory "$GITHUB_WORKSPACE" --timeout 2400 '/review'
  timeout-minutes: 45
```

For example, the log can include `> build · gpt-6-sol`, `→ Read src/app.ts`, `$ bun test`, and `[reviewer] → Read src/app.test.ts`. It shows completed text blocks rather than token-by-token deltas. Live subscriptions have no replay, so the client also reads messages after the run without repeating text already printed. For an isolated CI environment, use the SDK rather than connecting to a user's shared background service. See [V2 build options](https://opencode.ai/v2/docs/build/), [SDK](https://opencode.ai/v2/docs/build/sdk), and [HTTP client](https://opencode.ai/v2/docs/build/client).

## Development and release

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
npm pack --dry-run   # runs prepack/build and shows the published file list
npm publish          # requires publish access to @kompassdev; public scoped package
```

The npm package ships a Bun executable in `dist/` and declares `@opencode/sdk` as a runtime dependency. The source checkout can be run with `bun start -- 'Review this repository'`. Publishing is a manual step; `prepack` builds the executable for both `npm pack` and `npm publish`.
