import { z } from "zod"

export const DapaPolicyPageSchema = z.object({
  id: z.string().min(1),
  menuSeq: z.string().regex(/^\d+$/),
  pageSeq: z.string().regex(/^\d+$/).optional(),
  title: z.string().min(1),
  section: z.string().min(1),
  breadcrumbs: z.array(z.string().min(1)).min(1),
  content: z.string().min(1),
  sourceUrl: z.url(),
  retrievedAt: z.iso.datetime(),
})

export const DapaPolicyFileSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  seedUrl: z.url(),
  pages: z.array(DapaPolicyPageSchema),
})

export type DapaPolicyPage = z.infer<typeof DapaPolicyPageSchema>
export type DapaPolicyFile = z.infer<typeof DapaPolicyFileSchema>
