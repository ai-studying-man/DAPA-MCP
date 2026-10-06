import { DapaError } from "../../lib/errors/dapa-error.js"
import { koreaToday } from "./law-api-temporal.js"
import { activeOn, officialList, versionOf } from "./law-temporal-data.js"

export async function resolveAdministrativeEffective(
  data: Readonly<Record<string, unknown>>,
  loadHistory: (page: number) => Promise<Readonly<Record<string, unknown>>>,
): Promise<Readonly<Record<string, unknown>>> {
  const list = officialList(data, "administrative_rule")
  const future = list.items
    .map((item) => versionOf(item, "administrative_rule"))
    .filter(
      (version) => version.effectiveDate !== undefined && version.effectiveDate > koreaToday(),
    )
  if (future.length === 0) return data
  if (future.some((version) => version.stableId === undefined))
    throw new DapaError(
      "SOURCE_UNAVAILABLE",
      "시행예정 행정규칙의 공식 ID가 없어 현재 시행 버전을 확인할 수 없습니다",
    )
  const replacements = new Map<string, Record<string, unknown>>()
  for (let page = 1; page <= 100; page += 1) {
    const history = officialList(await loadHistory(page), "administrative_rule")
    for (const item of history.items) {
      const version = versionOf(item, "administrative_rule")
      const identity = future.find((entry) => entry.stableId === version.stableId)
      if (
        identity === undefined ||
        !activeOn(version, koreaToday()) ||
        version.effectiveDate === undefined
      )
        continue
      const prior = replacements.get(identity.documentId)
      if (
        prior === undefined ||
        version.effectiveDate > (versionOf(prior, "administrative_rule").effectiveDate ?? "")
      )
        replacements.set(identity.documentId, {
          ...item,
          effectiveStatus: "current",
          effectiveAsOfDate: koreaToday(),
        })
    }
    if (page * 100 >= Number(history.root["totalCnt"])) break
    if (page === 100)
      throw new DapaError(
        "SOURCE_UNAVAILABLE",
        "행정규칙 연혁 조회 한도를 초과해 시행 중인 버전을 확인할 수 없습니다",
      )
  }
  return {
    ...data,
    [list.rootKey]: {
      ...list.root,
      [list.itemKey]: list.items.map(
        (item) => replacements.get(versionOf(item, "administrative_rule").documentId) ?? item,
      ),
    },
  }
}
