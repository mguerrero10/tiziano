import { supabase } from './supabase'

const bucket = 'salon-products'
const maxBytes = 2 * 1024 * 1024
const allowedExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export async function uploadProductImage(
  salonId: string,
  productId: string,
  file: File,
): Promise<string> {
  const extension = file.name.includes('.')
    ? file.name.split('.').pop()!.toLowerCase()
    : 'png'

  if (!allowedExtensions.has(extension) || (file.type && !allowedTypes.has(file.type))) {
    throw new Error('Usa una imagen PNG, JPG, WEBP o GIF.')
  }

  if (file.size > maxBytes) {
    throw new Error('La imagen no puede superar 2 MB.')
  }

  const path = `${salonId}/${productId}.${extension}`
  const contentType = file.type || (extension === 'jpg' ? 'image/jpeg' : `image/${extension}`)

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType,
  })

  if (error) {
    throw new Error(error.message)
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}
