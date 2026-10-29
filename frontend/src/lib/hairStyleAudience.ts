export type HairStyleAudience = 'Masculino' | 'Femenino' | null

const MASCULINE_CATALOG_KEYS = new Set([
  'corte_caballero',
  'barba',
  'corte_jubilado',
])

const FEMININE_CATALOG_KEYS = new Set([
  'corte_dama',
  'color',
  'mechas',
  'brushing',
  'tratamiento_capilar',
])

export function resolveHairStyleAudience(input: {
  catalogKey?: string | null
  name?: string | null
  moduleKey?: string | null
}): HairStyleAudience {
  if (input.moduleKey && input.moduleKey !== 'hair') {
    return null
  }

  const catalogKey = input.catalogKey?.trim().toLowerCase()
  if (catalogKey) {
    if (MASCULINE_CATALOG_KEYS.has(catalogKey)) {
      return 'Masculino'
    }
    if (FEMININE_CATALOG_KEYS.has(catalogKey)) {
      return 'Femenino'
    }
    if (catalogKey === 'corte_nino') {
      return null
    }
  }

  const name = input.name?.trim().toLowerCase() ?? ''
  if (
    name.includes('caballero')
    || name.includes('barba')
    || name.includes('masculin')
    || name.includes('hombre')
  ) {
    return 'Masculino'
  }

  if (
    name.includes('dama')
    || name.includes('mujer')
    || name.includes('femenin')
    || name.includes('color')
    || name.includes('mecha')
    || name.includes('brushing')
    || name.includes('tratamiento')
  ) {
    return 'Femenino'
  }

  return null
}

export function filterHairStylesByAudience<T extends { group: string }>(
  styles: T[],
  audience: HairStyleAudience,
): T[] {
  if (!audience) {
    return styles
  }

  return styles.filter((style) => style.group === audience)
}
