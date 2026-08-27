import { z } from "zod"
import { DAPA_CATEGORIES } from "./categories.js"

export const DapaInfoEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  category: z.enum(DAPA_CATEGORIES),
  description: z.string().min(1),
  practicalMeaning: z.string().optional(),
  relatedTerms: z.array(z.string()).default([]),
  relatedOrganizations: z.array(z.string()).default([]),
  relatedLaws: z.array(z.string()).default([]),
  parentOrganization: z.string().optional(),
  mission: z.array(z.string()).default([]),
  source: z.string().min(1),
  sourceUrl: z.url(),
  effectiveDate: z.string().optional(),
  lastVerifiedAt: z.iso.date(),
  verified: z.boolean(),
})

export const DapaInfoFileSchema = z.object({
  items: z.array(DapaInfoEntrySchema),
})

export type DapaInfoEntry = z.infer<typeof DapaInfoEntrySchema>
