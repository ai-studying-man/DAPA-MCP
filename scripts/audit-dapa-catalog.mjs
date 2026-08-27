import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { z } from "zod"
import { auditDapaCatalogCoverage } from "../dist/providers/dapa-catalog/audit.js"
import { DapaCatalogFileSchema } from "../dist/providers/dapa-catalog/schemas.js"
import { LawProvider } from "../dist/providers/law/law-provider.js"

const environment = z
  .object({
    LAW_API_OC: z.string().min(1),
    DAPA_CATALOG_PATH: z.string().min(1).default("DAPA_info/legal/catalog.json"),
    DAPA_COVERAGE_REPORT_PATH: z.string().min(1).default("DAPA_info/legal/coverage-report.json"),
    DAPA_AUDIT_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(4),
  })
  .parse(process.env)

try {
  const catalogText = await readFile(resolve(process.cwd(), environment.DAPA_CATALOG_PATH), "utf8")
  const catalog = DapaCatalogFileSchema.parse(JSON.parse(catalogText))
  const report = await auditDapaCatalogCoverage(
    catalog,
    new LawProvider({ apiKey: environment.LAW_API_OC }),
    { concurrency: environment.DAPA_AUDIT_CONCURRENCY },
  )
  const reportPath = resolve(process.cwd(), environment.DAPA_COVERAGE_REPORT_PATH)
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  process.stdout.write(`${JSON.stringify({ reportPath, totals: report.totals })}\n`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`DAPA catalog audit failed: ${message}\n`)
  process.exitCode = 1
}
