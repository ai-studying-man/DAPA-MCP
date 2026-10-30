import { describe, expect, it } from "vitest"
import { courtPdfIdentity } from "../src/providers/court/pdf.js"

describe("official PDF main docket identity", () => {
  it("reads the main docket from split case-label table cells", () => {
    // Given
    const markdown =
      "<table><tr><td>사</td><td>2020다12345</td><td>물품대금</td><td>건</td></tr><tr><td>원심판결</td><td>2019나99999</td></tr><tr><td>판결선고</td><td>2026.4.30.</td></tr></table>"
    // When
    const identity = courtPdfIdentity(markdown)
    // Then
    expect(identity).toEqual({ caseNumber: "2020다12345", date: "2026-04-30" })
  })

  it("does not certify a referenced docket as the main case", () => {
    // Given
    const markdown =
      "<table><tr><td>원심판결</td><td>2019나99999</td></tr></table> 대법원 2020다12345 참조"
    // When
    const identity = courtPdfIdentity(markdown)
    // Then
    expect(identity.caseNumber).toBeUndefined()
  })
})
