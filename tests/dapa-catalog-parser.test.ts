import { describe, expect, it } from "vitest"
import { parseDapaAdminRulePage, parseDapaLawPage } from "../src/providers/dapa-catalog/parser.js"

describe("DAPA catalog parsers", () => {
  it("parses visible law links with their section category", () => {
    // Given
    const html = `
      <table>
        <caption>방위사업 관련</caption>
        <tbody>
          <tr><th rowspan="2">법령</th><td><a href="https://www.law.go.kr/법령/방위사업법">방위사업법</a></td></tr>
          <tr><td><a href="/dapa/files/02/dapAct.hwp">방위사업법(영문)</a></td></tr>
          <tr><th>시행령</th><td><a href="https://www.law.go.kr/법령/방위사업법시행령">방위사업법 시행령</a></td></tr>
        </tbody>
      </table>`

    // When
    const items = parseDapaLawPage(html, "https://www.dapa.go.kr/dapa/page/selectPage.do")

    // Then
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      kind: "law",
      category: "법령",
      title: "방위사업법",
      lawGoKrUrl:
        "https://www.law.go.kr/%EB%B2%95%EB%A0%B9/%EB%B0%A9%EC%9C%84%EC%82%AC%EC%97%85%EB%B2%95",
    })
    expect(items[1]).toMatchObject({
      kind: "law",
      category: "법령",
      externalFileUrl: "https://www.dapa.go.kr/dapa/files/02/dapAct.hwp",
    })
    expect(items[2]?.category).toBe("시행령")
  })

  it("parses an administrative-rule page and preserves the DAPA registration key", () => {
    // Given
    const html = `
      <p class="total-text">총 : 2,626건</p>
      <p class="page-text">페이지 : 88/88</p>
      <table class="list-table"><tbody>
        <tr>
          <td class="num">16</td>
          <td><button onClick="RlmNttGList('625656')">상세보기</button></td>
          <td class="subject"><a onclick="fn_fileDownload('7825')"> 방위사업청 감사처분요구서 처리지침 </a></td>
          <td>2006-3</td><td>예규</td><td>2006-01-24</td>
        </tr>
      </tbody></table>`

    // When
    const page = parseDapaAdminRulePage(
      html,
      "https://www.dapa.go.kr/dapa/rlm/rllawd/RlmNttList.do?menuSeq=3088",
    )

    // Then
    expect(page.totalCount).toBe(2626)
    expect(page.pageCount).toBe(88)
    expect(page.items[0]).toMatchObject({
      kind: "admin_rule",
      listNumber: 16,
      dapaRegistrationId: "625656",
      title: "방위사업청 감사처분요구서 처리지침",
      category: "예규",
      promulgationNumber: "2006-3",
      promulgationDate: "2006-01-24",
    })
  })
})
