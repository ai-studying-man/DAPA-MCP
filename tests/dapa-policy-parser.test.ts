import { describe, expect, it } from "vitest"
import {
  parseDapaPolicyPage,
  parseDapaWorkPolicyNavigation,
} from "../src/providers/dapa-policy/parser.js"

const SOURCE_URL = "https://www.dapa.go.kr/dapa/page/selectPage.do?menuSeq=4088&pageSeq=4198"

describe("DAPA work-policy parser", () => {
  it("discovers internal side-menu and tab pages without duplicate menu IDs", () => {
    // Given
    const html = `
      <div id="side-manu">
        <ul class="depth2-list">
          <li class="depth2">
            <a class="depth2-anchor">방위사업의 이해</a>
            <ul class="depth3">
              <li><a class="depth3-anchor" href="/dapa/index.do?menuSeq=4086">국방기술 R&amp;D 사업</a></li>
            </ul>
          </li>
          <li class="depth2">
            <a class="depth2-anchor" href="https://www.prism.go.kr">정책연구보고서</a>
          </li>
        </ul>
      </div>
      <div id="tab-menu">
        <a class="tab-btn" href="/dapa/index.do?menuSeq=4087">사업소개</a>
        <a class="tab-btn active" href="/dapa/index.do?menuSeq=4088">핵심기술</a>
        <a class="tab-btn" href="/dapa/index.do?menuSeq=4088">핵심기술 중복</a>
      </div>`

    // When
    const links = parseDapaWorkPolicyNavigation(html, SOURCE_URL)

    // Then
    expect(links).toEqual([
      {
        menuSeq: "4086",
        title: "국방기술 R&D 사업",
        section: "방위사업의 이해",
        url: "https://www.dapa.go.kr/dapa/index.do?menuSeq=4086",
      },
      {
        menuSeq: "4087",
        title: "사업소개",
        section: "방위사업의 이해",
        url: "https://www.dapa.go.kr/dapa/index.do?menuSeq=4087",
      },
      {
        menuSeq: "4088",
        title: "핵심기술",
        section: "방위사업의 이해",
        url: "https://www.dapa.go.kr/dapa/index.do?menuSeq=4088",
      },
    ])
  })

  it("extracts the page hierarchy and readable body while excluding navigation chrome", () => {
    // Given
    const html = `
      <div id="cont">
        <ul class="new_breadcrumbs">
          <li class="breadcrumbs-item home">홈</li>
          <li class="breadcrumbs-item">업무·정책</li>
          <li class="breadcrumbs-item">방위사업의 이해</li>
          <li class="breadcrumbs-item">국방기술 R&amp;D 사업</li>
        </ul>
        <div class="cont-head"><h3 class="head-tit">국방기술 R&amp;D 사업</h3></div>
        <div id="contents">
          <div id="tab-menu">
            <a class="tab-btn" href="/dapa/index.do?menuSeq=4087">사업소개</a>
            <a class="tab-btn active" href="/dapa/index.do?menuSeq=4088">핵심기술<span class="behind">선택됨</span></a>
          </div>
          <h4>핵심기술</h4>
          <p>무기체계에 필요한 기술을 확보하기 위한 연구개발</p>
          <table><tbody><tr><th>과제기획</th><td>방사청과 국기연</td></tr></tbody></table>
          <div id="satisfaction">만족도 조사</div>
        </div>
      </div>
    `

    // When
    const page = parseDapaPolicyPage(html, SOURCE_URL, "2026-08-27T00:00:00.000Z")

    // Then
    expect(page).toMatchObject({
      id: "policy:4088",
      menuSeq: "4088",
      pageSeq: "4198",
      title: "핵심기술",
      breadcrumbs: ["업무·정책", "방위사업의 이해", "국방기술 R&D 사업"],
      section: "방위사업의 이해",
      sourceUrl: SOURCE_URL,
    })
    expect(page.content).toContain("핵심기술")
    expect(page.content).toContain("과제기획 | 방사청과 국기연")
    expect(page.content).not.toContain("사업소개")
    expect(page.content).not.toContain("만족도 조사")
  })

  it("uses the page heading when an active tab is only a list filter", () => {
    // Given
    const html = `
      <div id="cont">
        <ul class="new_breadcrumbs">
          <li class="breadcrumbs-item">업무·정책</li>
          <li class="breadcrumbs-item">업무자료실</li>
          <li class="breadcrumbs-item">업무게시판</li>
        </ul>
        <h3 class="head-tit">업무게시판</h3>
        <div id="contents">
          <div id="tab-menu"><button class="tab-btn active">전체</button></div>
          <p>업무 관련 게시물 목록</p>
        </div>
      </div>`

    // When
    const page = parseDapaPolicyPage(
      html,
      "https://www.dapa.go.kr/dapa/doc/selectDocList.do?menuSeq=3042&bbsSeq=462",
    )

    // Then
    expect(page.title).toBe("업무게시판")
  })
})
