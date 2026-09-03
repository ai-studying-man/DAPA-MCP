import type { SourceType } from "../../types/results.js"

export type LawTargetConfig = {
  readonly sourceType: SourceType
  readonly target: string
  readonly rootKey: string
  readonly itemKey: string
  readonly idKeys: readonly string[]
  readonly titleKeys: readonly string[]
  readonly organizationKeys: readonly string[]
  readonly dateKeys: readonly string[]
  readonly effectiveDateKeys: readonly string[]
  readonly linkKeys: readonly string[]
  readonly referenceKeys: readonly string[]
}

const configs = [
  [
    "law",
    "law",
    "LawSearch",
    "law",
    ["법령일련번호"],
    ["법령명한글"],
    ["소관부처명"],
    ["공포일자"],
    ["시행일자"],
    ["법령상세링크"],
    ["법령ID"],
  ],
  [
    "administrative_rule",
    "admrul",
    "AdmRulSearch",
    "admrul",
    ["행정규칙일련번호"],
    ["행정규칙명"],
    ["소관부처명"],
    ["발령일자"],
    ["시행일자"],
    ["행정규칙상세링크"],
    ["발령번호"],
  ],
  [
    "precedent",
    "prec",
    "PrecSearch",
    "prec",
    ["판례일련번호"],
    ["사건명"],
    ["법원명"],
    ["선고일자"],
    [],
    ["판례상세링크"],
    ["사건번호"],
  ],
  [
    "constitutional_case",
    "detc",
    "DetcSearch",
    "detc",
    ["헌재결정례일련번호"],
    ["사건명"],
    ["헌법재판소"],
    ["종국일자", "선고일자"],
    [],
    ["헌재결정례상세링크"],
    ["사건번호"],
  ],
  [
    "interpretation",
    "expc",
    "Expc",
    "expc",
    ["법령해석례일련번호"],
    ["안건명"],
    ["해석기관명"],
    ["회신일자"],
    [],
    ["법령해석례상세링크"],
    ["법령해석례번호"],
  ],
  [
    "administrative_appeal",
    "decc",
    "Decc",
    "decc",
    ["행정심판재결례일련번호"],
    ["사건명"],
    ["재결청"],
    ["의결일자"],
    [],
    ["행정심판례상세링크"],
    ["사건번호"],
  ],
] as const

const TARGETS = new Map<SourceType, LawTargetConfig>(
  configs.map((config) => [
    config[0],
    {
      sourceType: config[0],
      target: config[1],
      rootKey: config[2],
      itemKey: config[3],
      idKeys: config[4],
      titleKeys: config[5],
      organizationKeys: config[6],
      dateKeys: config[7],
      effectiveDateKeys: config[8],
      linkKeys: config[9],
      referenceKeys: config[10],
    },
  ]),
)

export function getTargetConfig(sourceType: SourceType): LawTargetConfig | undefined {
  return TARGETS.get(sourceType)
}
