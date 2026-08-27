import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { loadDapaPolicyProvider } from "../src/providers/dapa-policy/provider.js"

describe("DapaPolicyProvider", () => {
  it("searches page content and returns the complete page by ID", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "dapa-policy-provider-"))
    const path = join(directory, "pages.json")
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: "2026-08-27T00:00:00.000Z",
        seedUrl: "https://www.dapa.go.kr/dapa/page/selectPage.do?menuSeq=4088&pageSeq=4198",
        pages: [
          {
            id: "policy:4088",
            menuSeq: "4088",
            pageSeq: "4198",
            title: "핵심기술",
            section: "방위사업의 이해",
            breadcrumbs: ["업무·정책", "방위사업의 이해", "국방기술 R&D 사업"],
            content: "국방기술개발은 무기체계 연구개발과 국방기술 연구개발로 구분한다.",
            sourceUrl: "https://www.dapa.go.kr/dapa/page/selectPage.do?menuSeq=4088&pageSeq=4198",
            retrievedAt: "2026-08-27T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    )
    const provider = await loadDapaPolicyProvider(path)

    // When
    const search = provider.search({ query: "무기체계 연구개발" })
    const detail = provider.get("policy:4088")

    // Then
    expect(search.status).toBe("OK")
    expect(search.results[0]).toMatchObject({ id: "policy:4088", title: "핵심기술" })
    expect(search.results[0]?.content).toBeUndefined()
    expect(detail?.content).toContain("국방기술 연구개발")
    expect(provider.status()).toMatchObject({ state: "healthy", totalCount: 1 })
  })
})
