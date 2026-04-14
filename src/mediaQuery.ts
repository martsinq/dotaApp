/**
 * Safari ≤13 / старый iOS: у MediaQueryList нет addEventListener, только addListener
 * (и колбэк не получает MediaQueryListEvent — только актуальное состояние через .matches).
 */
export function addMediaQueryChangeListener(
  query: string,
  onChange: (matches: boolean) => void
): () => void {
  const mql = window.matchMedia(query);
  const handler = () => onChange(mql.matches);
  if (typeof mql.addEventListener === "function") {
    const wrapped = (e: MediaQueryListEvent) => onChange(e.matches);
    mql.addEventListener("change", wrapped);
    return () => mql.removeEventListener("change", wrapped);
  }
  mql.addListener(handler);
  return () => mql.removeListener(handler);
}
