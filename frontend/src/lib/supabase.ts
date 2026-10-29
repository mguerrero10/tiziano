import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !publishableKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL',
  )
}

export const supabase = createClient(url, publishableKey)
