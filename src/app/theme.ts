const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Följer systemets ljust/mörkt-läge genom att sätta/ta bort `dark`-klassen på <html>.
 * Manuellt val (ljust/mörkt/system) hör till inställningar i en senare fas.
 * Returnerar en funktion som avregistrerar lyssnaren.
 */
export function applySystemTheme(
  root: HTMLElement = document.documentElement,
  matchMedia: (query: string) => MediaQueryList = window.matchMedia.bind(window),
): () => void {
  const query = matchMedia(DARK_QUERY)
  const apply = (isDark: boolean) => {
    root.classList.toggle('dark', isDark)
    root.style.colorScheme = isDark ? 'dark' : 'light'
  }

  apply(query.matches)
  const onChange = (event: MediaQueryListEvent) => {
    apply(event.matches)
  }
  query.addEventListener('change', onChange)
  return () => {
    query.removeEventListener('change', onChange)
  }
}
