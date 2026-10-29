export const BOOKING_MODULES = ['hair', 'spa', 'nails', 'lashes'] as const

export type ModuleKey = (typeof BOOKING_MODULES)[number] | 'products'

export const MODULE_LABELS: Record<string, string> = {
  hair: 'Peluquería',
  spa: 'Spa',
  nails: 'Nails',
  lashes: 'Lashes',
  products: 'Productos',
}

export function hasModule(modules: readonly string[] | undefined, key: string) {
  return modules?.includes(key) ?? false
}

export function hasBookingModules(modules: readonly string[] | undefined) {
  return BOOKING_MODULES.some((key) => hasModule(modules, key))
}

export function hasAnySalonModule(modules: readonly string[] | undefined) {
  return (modules?.length ?? 0) > 0
}
