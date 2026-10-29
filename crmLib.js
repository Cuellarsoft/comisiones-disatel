import { supabase, SUPABASE_URL } from './supabase'
import { cotizar } from './tarifas'
import { hoyISO } from './lib'

export const ETAPAS = ['Prospecto', 'Contactado', 'Cotizado', 'Negociación', 'Ganado']
export const CHIP_ETAPA = { Prospecto: 'gris', Contactado: 'azul', Cotizado: 'azul', Negociación: 'ambar', Ganado: 'verde', Perdido: 'rojo' }
export const TIPOS_ACT = { llamada: 'Llamada', whatsapp: 'WhatsApp', visita: 'Visita', correo: 'Correo', cotizacion: 'Cotización', nota: 'Nota', etapa: 'Cambio de etapa', venta: 'Venta' }
export const ICONO_ACT = { llamada: '☎', whatsapp: '✉', visita: '⌂', correo: '@', cotizacion: '▤', nota: '✎', etapa: '→', venta: '★' }
export const ORIGENES = ['Referido', 'WhatsApp', 'Página web', 'Visita en frío', 'Feria', 'Cliente antiguo', 'Redes sociales', 'Cotización']
export const RUBROS = ['Transporte y logística', 'Agropecuario', 'Construcción', 'Distribución', 'Minería', 'Servicios', 'Particular', 'Otro']

export const valorMensual = (c, cfg) => cotizar({ tipo: c.tipo, unidades: c.flota, conRoaming: 0, accesorios: {} }, cfg).totalMensual
export const masDiasISO = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

export function estadoSeg(fecha) {
  const hoy = hoyISO()
  return fecha < hoy ? 'vencido' : fecha === hoy ? 'hoy' : 'proximo'
}

export async function registrarActividad(cliente_id, tipo, texto) {
  return supabase.from('actividades').insert({ cliente_id, tipo, texto })
}

export async function cambiarEtapa(c, etapa, extra = {}) {
  const { error } = await supabase.from('clientes').update({ etapa, ...extra }).eq('id', c.id)
  if (error) throw error
  await registrarActividad(c.id, 'etapa', `Pasó de ${c.etapa} a ${etapa}.`)
}

// Llamada a la función de WhatsApp del servidor con la sesión del usuario
export async function whatsapp(cuerpo) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-enviar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(cuerpo),
  })
  if (cuerpo.accion === 'media') {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo abrir el archivo.')
    return r.blob()
  }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || 'No se pudo enviar por WhatsApp.')
  return data
}

export const aBase64 = (bytes) => {
  let s = ''
  const u = new Uint8Array(bytes)
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000))
  return btoa(s)
}
