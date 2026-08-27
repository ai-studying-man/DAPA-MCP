import { z } from "zod"

export const DAPA_LAW_CATEGORIES = ["법령", "시행령", "시행규칙"] as const
export const DAPA_ADMIN_RULE_CATEGORIES = [
  "훈령",
  "예규",
  "고시/공고",
  "매뉴얼",
  "기타/회계예규",
] as const

const CatalogBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sourceUrl: z.url(),
  retrievedAt: z.iso.datetime(),
})

export const DapaLawCatalogItemSchema = CatalogBaseSchema.extend({
  kind: z.literal("law"),
  category: z.enum(DAPA_LAW_CATEGORIES),
  lawGoKrUrl: z.url().optional(),
  externalFileUrl: z.url().optional(),
})

export const DapaAdminRuleCatalogItemSchema = CatalogBaseSchema.extend({
  kind: z.literal("admin_rule"),
  category: z.enum(DAPA_ADMIN_RULE_CATEGORIES),
  listNumber: z.number().int().positive(),
  dapaRegistrationId: z.string().min(1),
  promulgationNumber: z.string().min(1),
  promulgationDate: z.iso.date(),
})

export const DapaCatalogItemSchema = z.discriminatedUnion("kind", [
  DapaLawCatalogItemSchema,
  DapaAdminRuleCatalogItemSchema,
])

export const DapaCatalogFileSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  lawSourceUrl: z.url(),
  adminRuleSourceUrl: z.url(),
  pageCount: z.number().int().nonnegative(),
  items: z.array(DapaCatalogItemSchema),
})

export type DapaLawCatalogItem = z.infer<typeof DapaLawCatalogItemSchema>
export type DapaAdminRuleCatalogItem = z.infer<typeof DapaAdminRuleCatalogItemSchema>
export type DapaCatalogItem = z.infer<typeof DapaCatalogItemSchema>
export type DapaCatalogFile = z.infer<typeof DapaCatalogFileSchema>
