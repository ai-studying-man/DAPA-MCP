import { describe, expect, it } from "vitest"
import { disclosureContext, validateDisclosureUrl } from "../src/providers/official-disclosure.js"

describe("exchange-hosted issuer context", () => {
  it("accepts the regulator's canonical public filing section address", () => {
    // Given
    const url =
      "https://dart.fss.or.kr/report/viewer.do?rcpNo=20240101000001&dcmNo=1234567&eleId=67&offset=100&length=1000&dtd=dart3.xsd"
    // When / Then
    expect(validateDisclosureUrl(url).hostname).toBe("dart.fss.or.kr")
  })
  it("returns issuer statements around the docket without certifying a court finding", () => {
    // Given
    const html =
      "<p>다른 공시 내용</p><h2>물품대금 2020나12345</h2><p>방위사업청 지체상금에 관하여 회사가 소송을 제기하였다.</p>"
    // When
    const result = disclosureContext(html, "2020나12345")
    // Then
    expect(result.excerpts.join(" ")).toContain("방위사업청")
    expect(result.evidenceKind).toBe("issuer_disclosure")
    expect(result.claimVerification).toBe("not_performed")
  })
  it.each([
    "https://kind.krx.co.kr.attacker.test/external/2024/01/01/000001/20240101000001/10000.htm",
    "http://127.0.0.1/admin",
    "https://kind.krx.co.kr:444/external/x.htm",
    "https://dart.fss.or.kr/report/viewer.do?rcpNo=20240101000001&dcmNo=1234567&eleId=67&offset=100&length=1000&dtd=https://attacker.test/file",
    "https://user:pass@kind.krx.co.kr/external/2024/01/01/000001/20240101000001/10000.htm",
  ])("rejects noncanonical official disclosure address %s", (url) => {
    // Given / When / Then
    expect(() => validateDisclosureUrl(url)).toThrow()
  })
})
