export const DAPA_CATEGORIES = [
  "organization",
  "mission",
  "process",
  "contract",
  "acquisition",
  "r_and_d",
  "export",
  "ipt",
  "audit",
  "policy",
  "institution",
  "terminology",
  "weapon_system",
] as const

export type DapaCategory = (typeof DAPA_CATEGORIES)[number]
