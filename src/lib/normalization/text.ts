export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "")
}

export function similarityScore(left: string, right: string): number {
  const normalizedLeft = normalizeSearchText(left)
  const normalizedRight = normalizeSearchText(right)
  const longest = Math.max(normalizedLeft.length, normalizedRight.length)
  if (longest === 0) return 1

  const previous = Array.from({ length: normalizedRight.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= normalizedLeft.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= normalizedRight.length; rightIndex += 1) {
      const leftCharacter = normalizedLeft[leftIndex - 1]
      const rightCharacter = normalizedRight[rightIndex - 1]
      const substitutionCost = leftCharacter === rightCharacter ? 0 : 1
      const deletion = (previous[rightIndex] ?? 0) + 1
      const insertion = (current[rightIndex - 1] ?? 0) + 1
      const substitution = (previous[rightIndex - 1] ?? 0) + substitutionCost
      current.push(Math.min(deletion, insertion, substitution))
    }
    previous.splice(0, previous.length, ...current)
  }

  return 1 - (previous[normalizedRight.length] ?? longest) / longest
}
