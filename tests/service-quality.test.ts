import { describe, expect, it } from "vitest"
import { parseCitation } from "../src/lib/citation/parser.js"
import { selectMatchingDetail } from "../src/providers/law/content-search-evidence.js"
import { planContentSearch } from "../src/providers/law/content-search-plan.js"
import { sanitizeUrlString } from "../src/providers/law/law-api-sanitize.js"
import { parseLegalDocumentDetail } from "../src/providers/law/legal-document.js"

describe("official evidence preservation", () => {
  it("preserves nested paragraph, item and subitem text in order", () => {
    // Given
    const root = {
      조문: {
        조문단위: [
          {
            조문번호: "3",
            조문내용: "제3조(정의)",
            항: {
              항내용: "① 정의는 다음과 같다.",
              호: [{ 호내용: "1. 획득", 목: [{ 목내용: "가. 구매" }, { 목내용: "나. 연구개발" }] }],
            },
          },
        ],
      },
    }
    // When
    const result = parseLegalDocumentDetail(root)
    // Then
    expect(result.articles[0]?.text).toBe(
      "제3조(정의)\n① 정의는 다음과 같다.\n1. 획득\n가. 구매\n나. 연구개발",
    )
  })

  it("does not turn chapter headings into articles", () => {
    // Given
    const root = {
      조문: { 조문단위: [{ 조문번호: "11", 조문여부: "전문", 조문내용: "제3장 방위력개선사업" }] },
    }
    // When
    const result = parseLegalDocumentDetail(root)
    // Then
    expect(result.articles).toEqual([])
  })

  it("selects an explicitly requested article ahead of keyword matches", () => {
    // Given
    const detail = parseLegalDocumentDetail({
      조문: {
        조문단위: [
          { 조문번호: "1", 조문내용: "방위력개선사업 목적" },
          { 조문번호: "3", 조문내용: "방위력개선사업 정의" },
        ],
      },
    })
    // When
    const result = selectMatchingDetail(detail, ["방위사업법 제3조", "방위력개선사업"])
    // Then
    expect(result?.articles.map((a) => a.articleNumber)).toEqual(["3"])
  })
})

describe("question and citation routing", () => {
  it("searches both comparison concepts before conversational filler", () => {
    // Given
    const query = "선행연구와 사업타당성조사는 어떻게 다른가요?"
    // When
    const result = planContentSearch(query)
    // Then
    expect(new Set(result.searchQueries.slice(0, 2))).toEqual(
      new Set(["선행연구", "사업타당성조사"]),
    )
  })

  it.each([
    "선행연구 수행지침 제2조",
    "방위사업법 제3조 제1호",
    "방위사업관리규정 제22조의2",
    "헌법재판소 89헌가104",
  ])("recognizes official reference %s", (citation) => {
    // Given / When
    const result = parseCitation(citation)
    // Then
    expect(result.kind).not.toBe("unknown")
  })

  it("preserves the query delimiter when stripping a leading credential", () => {
    // Given
    const url = "https://www.law.go.kr/DRF/lawService.do?OC=private&target=eflaw&MST=1"
    // When
    const result = sanitizeUrlString(url)
    // Then
    expect(result).toBe("https://www.law.go.kr/DRF/lawService.do?target=eflaw&MST=1")
  })
})
