import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://jxwgxowweitostjqeiis.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_J8K7lq3eA9msy85pD84sAg_Ct8fJBRd'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Administración de usuarios (solo admin) — funciones SQL protegidas en la base
export async function adminUsuarios(b) {
  let r
  if (b.action === 'crear') {
    r = await supabase.rpc('admin_crear_usuario', {
      p_email: b.email, p_password: b.password, p_nombre: b.nombre, p_rol: b.rol, p_sueldo: b.sueldo_fijo,
    })
  } else if (b.action === 'password') {
    r = await supabase.rpc('admin_password', { p_user: b.user_id, p_password: b.password })
  } else if (b.action === 'email') {
    r = await supabase.rpc('admin_email', { p_user: b.user_id, p_email: b.email })
  } else if (b.action === 'estado') {
    r = await supabase.rpc('admin_estado', { p_user: b.user_id, p_activo: b.activo })
  } else throw new Error('Acción desconocida')
  if (r.error) throw new Error(r.error.message)
  return r.data
}
