import { z } from "zod"
import type { ListPageCoverage } from "../../types/results.js"

const CountedRootSchema = z
  .object({
    totalCnt: z.coerce.number().int().nonnegative(),
    upstreamFetchedCount: z.coerce.number().int().nonnegative().optional(),
    returnedCount: z.coerce.number().int().nonnegative().optional(),
    upstreamTotalCounts: z.array(z.coerce.number().int().nonnegative()).optional(),
  })
  .catchall(z.unknown())
const RecordSchema = z.record(z.string(), z.unknown())

export function extractListCoverage(
  data: Readonly<Record<string, unknown>>,
  page: number,
  pageSize: number,
): ListPageCoverage | undefined {
  const root = [data, ...Object.values(data)]
    .map((value) => CountedRootSchema.safeParse(value))
    .find((parsed) => parsed.success)
  if (root === undefined || !root.success) return undefined
  const fetchedCount =
    root.data.upstreamFetchedCount ??
    root.data.returnedCount ??
    Object.values(root.data).reduce<number>(
      (count, value) =>
        count +
        (Array.isArray(value) ? value.length : RecordSchema.safeParse(value).success ? 1 : 0),
      0,
    )
  const hasMore = (root.data.upstreamTotalCounts ?? [root.data.totalCnt]).some(
    (count) => page * pageSize < count,
  )
  return {
    page,
    pageSize,
    totalCount: root.data.totalCnt,
    fetchedCount,
    hasMore,
    ...(hasMore ? { nextPage: page + 1 } : {}),
  }
}
