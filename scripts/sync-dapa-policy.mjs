import { open, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { syncDapaPolicy, writeDapaPolicy } from "../dist/providers/dapa-policy/sync.js"

const destination = resolve(
  process.cwd(),
  process.env["DAPA_POLICY_PATH"] ?? "DAPA_info/policy/catalog.json",
)
const lockPath = `${destination}.lock`

let lock
try {
  lock = await open(lockPath, "wx")
  const catalog = await syncDapaPolicy()
  await writeDapaPolicy(destination, catalog)
  process.stdout.write(
    `DAPA work-policy snapshot written: ${destination} (${catalog.pages.length} pages)\n`,
  )
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const isRunning = error instanceof Error && "code" in error && error.code === "EEXIST"
  process.stderr.write(
    isRunning
      ? `DAPA work-policy sync is already running: ${lockPath}\n`
      : `DAPA work-policy sync failed: ${message}\n`,
  )
  process.exitCode = 1
} finally {
  await lock?.close()
  if (lock !== undefined) await rm(lockPath, { force: true })
}
