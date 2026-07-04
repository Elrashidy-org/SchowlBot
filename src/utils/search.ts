// Strip characters that have special meaning in a PostgREST filter string so
// user input can't break out of an `ilike` pattern or inject extra conditions
// (e.g. a comma starts a new OR clause, parentheses group them).
export function sanitizeSearchTerm(value: string, maxLength = 60): string {
  return value
    .replace(/[,()%*\\:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
