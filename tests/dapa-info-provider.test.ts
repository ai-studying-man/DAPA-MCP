import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { loadDapaInfoProvider } from "../src/providers/dapa-info/dapa-info-provider.js"

const DAPA_INFO_ROOT = resolve(process.cwd(), "DAPA_info")

describe("DapaInfoProvider", () => {
  it("finds IPT by its English abbreviation", async () => {
    // Given
    const provider = await loadDapaInfoProvider(DAPA_INFO_ROOT)

    // When
    const response = provider.search({ query: "IPT", limit: 5 })

    // Then
    expect(response.status).toBe("OK")
    expect(response.results[0]?.title).toBe("통합사업관리팀")
    expect(response.results[0]?.verified).toBe(true)
  })

  it("finds an organization through a Korean alias", async () => {
    // Given
    const provider = await loadDapaInfoProvider(DAPA_INFO_ROOT)

    // When
    const result = provider.getOrganization("방사청")

    // Then
    expect(result?.title).toBe("방위사업청")
  })

  it("returns NOT_FOUND only after a healthy local search", async () => {
    // Given
    const provider = await loadDapaInfoProvider(DAPA_INFO_ROOT)

    // When
    const response = provider.search({ query: "존재하지않는임의용어" })

    // Then
    expect(response.status).toBe("NOT_FOUND")
    expect(response.errors).toEqual([])
  })
})
