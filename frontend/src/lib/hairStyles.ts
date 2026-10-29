export type HairStyleOption = {
  id: number
  name: string
  group: string
  thumbUrl?: string | null
  category?: string | null
}

export async function loadHairStyles(
  fetchStyles: () => Promise<HairStyleOption[]>,
): Promise<HairStyleOption[]> {
  let lastError: unknown

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const styles = await fetchStyles()
      if (styles.length > 0) {
        return styles
      }
    } catch (error) {
      lastError = error
      if (attempt < 2) {
        await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)))
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('No se pudo cargar el catálogo de cortes.')
}
