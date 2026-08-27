import { resolve } from "node:path"
import { syncDapaCatalog, writeDapaCatalog } from "../dist/providers/dapa-catalog/sync.js"

const destination = resolve(
  process.cwd(),
  process.env["DAPA_CATALOG_PATH"] ?? "DAPA_info/legal/catalog.json",
)

try {
  const catalog = await syncDapaCatalog()
  await writeDapaCatalog(destination, catalog)
  process.stdout.write(
    `DAPA catalog written: ${destination} (${catalog.items.length} items, ${catalog.pageCount} pages)\n`,
  )
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`DAPA catalog sync failed: ${message}\n`)
  process.exitCode = 1
}
