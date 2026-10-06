import { z } from "zod"

export const LEGAL_SOURCE_TYPES = [
  "law",
  "administrative_rule",
  "local_ordinance",
  "precedent",
  "constitutional_case",
  "interpretation",
  "administrative_appeal",
  "committee_decision",
] as const

export const GetLegalDetailSchema = {
  documentId: z.string().min(1).describe("검색 결과의 documentId"),
  sourceType: z.enum(LEGAL_SOURCE_TYPES),
  forceRefresh: z.boolean().default(false),
  currentOnly: z
    .boolean()
    .default(true)
    .describe("오늘 시행 중인 문서가 기본이며 연혁 본문은 false로 요청합니다."),
  asOfDate: z.iso.date().optional(),
}
