import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { loadDapaCatalogProvider } from "../src/providers/dapa-catalog/provider.js"

const CATALOG_PATH = resolve(process.cwd(), "DAPA_info/legal/catalog.json")

describe("DapaCatalogProvider", () => {
  it("loads the synchronized DAPA catalog and finds an administrative rule", async () => {
    // Given
    const provider = await loadDapaCatalogProvider(CATALOG_PATH)

    // When
    const response = provider.search({ query: "방위사업관리규정", kind: "admin_rule" })

    // Then
    expect(response.status).toBe("OK")
    expect(response.results.some((item) => item.title === "방위사업관리규정")).toBe(true)
    expect(provider.status()).toMatchObject({
      state: "healthy",
      totalCount: 2673,
      adminRuleCount: 2626,
    })
  })

  it("reports an unavailable state when the snapshot is missing", async () => {
    // Given
    const provider = await loadDapaCatalogProvider(resolve(process.cwd(), "missing-catalog.json"))

    // When
    const response = provider.search({ query: "방위사업법" })

    // Then
    expect(response.status).toBe("SOURCE_UNAVAILABLE")
    expect(provider.status().state).toBe("unavailable")
  })
})
