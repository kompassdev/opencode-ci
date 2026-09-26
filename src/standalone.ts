import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"

/** Start a private OpenCode server whose stdin owns its lifetime. */
export async function standalone(signal?: AbortSignal) {
  const password = randomBytes(32).toString("base64url")
  const child = spawn("opencode", ["serve", "--stdio", "--port", "0"], {
    stdio: ["pipe", "pipe", "ignore"],
    env: { ...process.env, OPENCODE_PASSWORD: password },
  })
  child.stdin.on("error", () => {}) // The server may exit before its ownership pipe closes.
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
    child.once("error", () => resolve())
  })
  const waitForExit = (milliseconds: number) => new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), milliseconds)
    void exited.then(() => { clearTimeout(timer); resolve(true) })
  })
  const close = async () => {
    child.stdin.end()
    if (await waitForExit(3000)) return
    child.kill("SIGTERM")
    if (!await waitForExit(3000)) child.kill("SIGKILL")
    await exited
  }
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = ""
      const timer = setTimeout(() => fail(new Error("Timed out starting OpenCode server")), 30_000)
      const cleanup = () => {
        clearTimeout(timer)
        child.stdout.off("data", onData)
        child.off("error", fail)
        child.off("exit", onExit)
        signal?.removeEventListener("abort", onAbort)
      }
      const fail = (error: Error) => { cleanup(); reject(error) }
      const onExit = () => fail(new Error("OpenCode server exited before reporting readiness"))
      const onAbort = () => fail(signal?.reason instanceof Error ? signal.reason : new Error("Aborted"))
      const onData = (chunk: Buffer) => {
        output += chunk.toString("utf8")
        if (output.length > 16_384) return fail(new Error("Invalid OpenCode server response"))
        const newline = output.indexOf("\n")
        if (newline < 0) return
        try {
          const ready = JSON.parse(output.slice(0, newline)) as { url?: unknown }
          if (typeof ready.url !== "string" || !ready.url.startsWith("http://")) throw new Error("Invalid OpenCode server response")
          cleanup()
          child.stdout.resume()
          resolve(ready.url)
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
        }
      }
      child.stdout.on("data", onData)
      child.once("error", fail)
      child.once("exit", onExit)
      signal?.addEventListener("abort", onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
    return {
      url,
      headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}
