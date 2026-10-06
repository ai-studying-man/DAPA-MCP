import { TtlCache } from "../../lib/cache/ttl-cache.js"
import { DapaError } from "../../lib/errors/dapa-error.js"
import { resolveAdministrativeEffective } from "./law-administrative-effective.js"
import { getLawApiConfig } from "./law-api-catalog.js"
import { parseLawApiResponse } from "./law-api-response.js"
import { koreaToday, type TemporalInput, temporalRequest } from "./law-api-temporal.js"
import type { LawHttpClient } from "./law-http.js"
import {
  activeOn,
  filterOfficialList,
  mergeOfficialLists,
  type OfficialVersion,
  officialBasicInfo,
  officialList,
  scalar,
  type TemporalCategory,
  versionOf,
} from "./law-temporal-data.js"
import {
  confirmTemporalDetail,
  LawVersionBodyCache,
  type TemporalDetail,
} from "./law-version-body-cache.js"

export type { TemporalDetail } from "./law-version-body-cache.js"
export type TemporalAccessInput = TemporalInput & {
  readonly deadlineAt?: number
  readonly forceRefresh?: boolean
}

export class LawTemporalAccess {
  private readonly versions: TtlCache<OfficialVersion>
  private readonly bodies: LawVersionBodyCache
  constructor(
    private readonly http: LawHttpClient,
    ttlMs: number,
    bodyTtlMs = 21_600_000,
  ) {
    this.versions = new TtlCache(Math.min(ttlMs, 300_000), 500)
    this.bodies = new LawVersionBodyCache(http, bodyTtlMs)
  }

  async search(
    params: Readonly<Record<string, string>>,
    input: TemporalAccessInput,
  ): Promise<string> {
    const category = categoryFor(params["target"])
    if (category === undefined) return this.http.get("lawSearch.do", params, input.deadlineAt)
    const temporal = temporalRequest(
      { categoryId: category, target: params["target"] ?? "" },
      input,
    )
    const request = { ...params, target: temporal.target, ...temporal.parameters }
    let data = await this.readList(request, input)
    if (category === "administrative_rule" && input.currentOnly === false) {
      data = mergeOfficialLists(data, await this.readList({ ...request, nw: "2" }, input), category)
    } else if (category === "administrative_rule" && input.asOfDate === undefined) {
      data = await resolveAdministrativeEffective(data, (page) =>
        this.readList(
          { ...request, nw: "2", display: "100", page: String(page), sort: "efdes" },
          input,
        ),
      )
    }
    data = filterOfficialList(data, category, input)
    if (input.currentOnly !== false && input.asOfDate === undefined) {
      for (const item of officialList(data, category).items) {
        const version = versionOf(item, category)
        this.versions.set(this.key(category, version.documentId), version)
      }
    }
    return JSON.stringify(data)
  }

  async detail(
    params: Readonly<Record<string, string>>,
    input: TemporalAccessInput,
  ): Promise<TemporalDetail> {
    const category = categoryFor(params["target"])
    const documentId = params["MST"] ?? params["ID"] ?? ""
    if (category === undefined || (input.currentOnly === false && input.asOfDate === undefined)) {
      const request = { ...params, target: category === "law" ? "law" : (params["target"] ?? "") }
      const text =
        category === undefined
          ? await this.http.get("lawService.do", request, input.deadlineAt)
          : await this.bodies.read(request, input)
      return { text, documentId, status: "unknown" }
    }
    if (category === "administrative_rule" && input.asOfDate !== undefined)
      throw new DapaError(
        "INVALID_ARGUMENT",
        "행정규칙의 기준일 조회는 공식 API에서 지원되지 않습니다",
      )
    const known =
      input.forceRefresh === true || input.asOfDate !== undefined
        ? undefined
        : this.versions.get(this.key(category, documentId))
    if (known !== undefined) return this.readVersion(params, known, input)
    const identityText = await this.bodies.read(
      { ...params, target: category === "law" ? "law" : "admrul" },
      input,
    )
    const identity = parseLawApiResponse(
      identityText,
      getLawApiConfig(category === "law" ? "law.detail" : "administrative_rule.detail"),
    ).data
    const basic = officialBasicInfo(identity, category)
    const title = scalar(basic["법령명_한글"] ?? basic["행정규칙명"])
    const stableId = scalar(basic["법령ID"] ?? basic["행정규칙ID"])
    if (title === undefined || stableId === undefined)
      throw new DapaError(
        "SOURCE_UNAVAILABLE",
        "공식 본문에서 현행 버전 확인에 필요한 문서 식별자를 확인할 수 없습니다",
      )
    const version = await this.resolveVersion(
      params,
      { category, documentId, title, stableId, status: "unknown" },
      input,
    )
    if (version === undefined)
      throw new DapaError(
        "SOURCE_UNAVAILABLE",
        "기준일에 시행 중인 공식 문서 버전을 확인할 수 없습니다",
      )
    if (input.asOfDate === undefined) this.versions.set(this.key(category, documentId), version)
    if (category === "administrative_rule" && version.documentId === documentId) {
      return confirmTemporalDetail(identityText, version, input)
    }
    return this.readVersion(params, version, input)
  }

  private async resolveVersion(
    params: Readonly<Record<string, string>>,
    identity: OfficialVersion,
    input: TemporalAccessInput,
  ): Promise<OfficialVersion | undefined> {
    const category = identity.category
    let best: OfficialVersion | undefined
    for (let page = 1; page <= 100; page += 1) {
      const text = await this.search(
        {
          OC: params["OC"] ?? "",
          target: category === "law" ? "eflaw" : "admrul",
          type: "JSON",
          query: category === "law" ? " " : identity.title,
          ...(category === "law" ? { LID: identity.stableId ?? "" } : {}),
          display: "100",
          page: String(page),
        },
        input,
      )
      const data = parseLawApiResponse(
        text,
        getLawApiConfig(category === "law" ? "law.list" : "administrative_rule.list"),
      ).data
      const list = officialList(data, category)
      for (const item of list.items) {
        const version = versionOf(item, category)
        const same = version.stableId === identity.stableId
        if (
          same &&
          activeOn(version, input.asOfDate ?? koreaToday()) &&
          (best === undefined || (version.effectiveDate ?? "") > (best.effectiveDate ?? ""))
        )
          best = version
      }
      if (page * 100 >= Number(list.root["upstreamTotalCnt"] ?? list.root["totalCnt"])) break
      if (page === 100)
        throw new DapaError(
          "SOURCE_UNAVAILABLE",
          "공식 버전 목록의 조회 한도를 초과해 현행 버전을 확인할 수 없습니다",
        )
    }
    return best
  }

  private async readVersion(
    params: Readonly<Record<string, string>>,
    version: OfficialVersion,
    input: TemporalAccessInput,
  ): Promise<TemporalDetail> {
    const category = version.category
    if (category === "law" && version.effectiveDate === undefined)
      throw new DapaError(
        "SOURCE_UNAVAILABLE",
        "시행일 기준 법령 본문을 조회할 시행일자가 없습니다",
      )
    const request =
      category === "law"
        ? {
            ...params,
            target: "eflaw",
            MST: version.documentId,
            efYd: version.effectiveDate?.replaceAll("-", "") ?? "",
          }
        : { ...params, target: "admrul", ID: version.documentId }
    const text = await this.bodies.read(request, input)
    return confirmTemporalDetail(text, version, input)
  }

  private async readList(params: Readonly<Record<string, string>>, input: TemporalAccessInput) {
    const category = params["target"] === "admrul" ? "administrative_rule" : "law"
    const text = await this.http.get("lawSearch.do", params, input.deadlineAt)
    return parseLawApiResponse(
      text,
      getLawApiConfig(category === "law" ? "law.list" : "administrative_rule.list"),
    ).data
  }

  private key(category: TemporalCategory, documentId: string): string {
    return `${koreaToday()}:${category}:${documentId}`
  }
}

function categoryFor(target: string | undefined): TemporalCategory | undefined {
  if (target === "law" || target === "eflaw") return "law"
  if (target === "admrul") return "administrative_rule"
  return undefined
}
