import { describe, expect, it } from "vitest"
import { extractMatchingExcerpts } from "../src/providers/law/content-search-evidence.js"

describe("extractMatchingExcerpts", () => {
  it("rejects an official API menu placeholder as body evidence", () => {
    // Given
    const rawContent = JSON.stringify({
      AdmRulService: {
        조문내용:
          '「절충교역 지침」의 자세한 내용은 상단 메뉴 "<img id="40425753"></img>"버튼을 이용하십시오.',
      },
    })

    // When
    const excerpts = extractMatchingExcerpts(rawContent, ["절충교역"])

    // Then
    expect(excerpts).toEqual([])
  })
})
