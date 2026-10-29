// Recibe los avisos de WhatsApp (Meta Cloud API o socio oficial con el mismo formato):
// mensajes de clientes, mensajes enviados desde el celular (coexistencia), historial y estados de entrega.
// Se publica sin verificación de usuario (Meta no envía sesión); se valida con el token y la firma de Meta.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const VERIFY_TOKEN = Deno.env.get('WA_VERIFY_TOKEN') ?? ''
const APP_SECRET = Deno.env.get('WA_APP_SECRET') ?? ''
// Socio oficial (360dialog): no firma los avisos; se valida con un encabezado secreto configurado junto al webhook
const WEBHOOK_TOKEN = Deno.env.get('WA_WEBHOOK_TOKEN') ?? ''

const digitos = (t: string | undefined | null) => String(t ?? '').replace(/\D/g, '')

function iguales(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Acepta el aviso si trae la firma de Meta válida o el encabezado secreto del socio oficial; si no hay ninguno configurado, se rechaza
async function avisoValido(body: string, req: Request) {
  const firma = req.headers.get('x-hub-signature-256')
  if (APP_SECRET && firma) return await firmaValida(body, firma)
  if (WEBHOOK_TOKEN) return iguales(req.headers.get('authorization') ?? '', `Bearer ${WEBHOOK_TOKEN}`)
  return false
}

async function firmaValida(body: string, firma: string | null) {
  if (!firma?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('')
  const esperado = firma.slice(7)
  if (hex.length !== esperado.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ esperado.charCodeAt(i)
  return diff === 0
}

// Texto legible y datos de archivo de cualquier tipo de mensaje
function contenido(m: any) {
  const t = m.type
  const media = m[t] && typeof m[t] === 'object' ? m[t] : {}
  let texto: string | null = null
  if (t === 'text') texto = m.text?.body ?? null
  else if (t === 'button') texto = m.button?.text ?? null
  else if (t === 'interactive') texto = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null
  else if (t === 'location') texto = `Ubicación: ${m.location?.name ?? ''} https://maps.google.com/?q=${m.location?.latitude},${m.location?.longitude}`.trim()
  else if (t === 'reaction') texto = `Reaccionó ${m.reaction?.emoji ?? ''}`
  else if (t === 'template') texto = 'Plantilla enviada'
  else texto = media.caption ?? null
  return {
    tipo: t ?? 'otro',
    texto,
    media_id: media.id ?? null,
    media_mime: media.mime_type ?? null,
    archivo_nombre: media.filename ?? null,
  }
}

const numerosCache = new Map<string, any>()
async function numeroPorId(phoneNumberId: string) {
  if (numerosCache.has(phoneNumberId)) return numerosCache.get(phoneNumberId)
  const { data } = await sb.from('wa_numeros').select('*').eq('phone_number_id', phoneNumberId).maybeSingle()
  if (data) numerosCache.set(phoneNumberId, data)
  return data
}

// Busca el cliente del vendedor con ese teléfono; si escribe alguien nuevo, lo crea como prospecto
async function clienteDe(numero: any, tel: string, nombre: string | null, crear: boolean) {
  if (!numero?.vendedor_id) return null
  const { data } = await sb.from('clientes').select('id').eq('vendedor_id', numero.vendedor_id).eq('telefono_wa', tel).order('id').limit(1)
  if (data?.length) return data[0].id
  if (!crear) return null
  const { data: nuevo, error } = await sb.from('clientes').insert({
    vendedor_id: numero.vendedor_id, empresa: nombre || '+' + tel, contacto: nombre, telefono: tel,
    tipo: 'empresa', origen: 'WhatsApp', etapa: 'Prospecto',
  }).select('id').single()
  if (error) { console.error('crear cliente', error.message); return null }
  await sb.from('seguimientos').insert({
    cliente_id: nuevo.id, vendedor_id: numero.vendedor_id, fecha: new Date().toISOString().slice(0, 10),
    texto: 'Responder: nuevo contacto por WhatsApp', automatico: true,
  })
  await sb.from('actividades').insert({ cliente_id: nuevo.id, vendedor_id: numero.vendedor_id, tipo: 'whatsapp', texto: 'Escribió por primera vez por WhatsApp.' })
  return nuevo.id
}

async function guardar(fila: any) {
  const { error } = await sb.from('wa_mensajes').upsert(fila, { onConflict: 'wamid', ignoreDuplicates: true })
  if (error) console.error('guardar mensaje', error.message)
}

async function procesar(value: any, field: string) {
  const numero = await numeroPorId(value?.metadata?.phone_number_id ?? '')
  if (!numero) { console.warn('número no registrado', value?.metadata?.phone_number_id); return }
  const propio = digitos(numero.numero)

  if (field === 'messages') {
    const nombres = new Map((value.contacts ?? []).map((c: any) => [digitos(c.wa_id), c.profile?.name ?? null]))
    for (const m of value.messages ?? []) {
      const tel = digitos(m.from)
      const clienteId = await clienteDe(numero, tel, nombres.get(tel) as string | null, true)
      await guardar({
        wa_numero_id: numero.id, cliente_id: clienteId, telefono: tel, direccion: 'entrante', origen: 'cliente',
        wamid: m.id, estado: 'recibido', fecha: new Date(Number(m.timestamp) * 1000).toISOString(), ...contenido(m),
      })
      if (clienteId) {
        const { data: c } = await sb.from('clientes').select('wa_no_leidos, etapa').eq('id', clienteId).single()
        await sb.from('clientes').update({
          wa_no_leidos: (c?.wa_no_leidos ?? 0) + 1, wa_ultimo_at: new Date().toISOString(),
          ...(c?.etapa === 'Prospecto' ? { etapa: 'Contactado' } : {}),
        }).eq('id', clienteId)
      }
    }
    for (const s of value.statuses ?? []) {
      await sb.from('wa_mensajes').update({
        estado: s.status === 'failed' ? 'fallido' : ({ sent: 'enviado', delivered: 'entregado', read: 'leido' } as any)[s.status] ?? s.status,
        error: s.errors?.[0]?.title ?? s.errors?.[0]?.message ?? null,
      }).eq('wamid', s.id)
    }
  } else if (field === 'smb_message_echoes') {
    // Mensajes que el vendedor mandó desde la app del celular
    for (const m of value.message_echoes ?? []) {
      const tel = digitos(m.to)
      const clienteId = await clienteDe(numero, tel, null, true)
      await guardar({
        wa_numero_id: numero.id, cliente_id: clienteId, telefono: tel, direccion: 'saliente', origen: 'celular',
        wamid: m.id, estado: 'enviado', fecha: new Date(Number(m.timestamp) * 1000).toISOString(), ...contenido(m),
      })
      if (clienteId) await sb.from('clientes').update({ wa_ultimo_at: new Date().toISOString() }).eq('id', clienteId)
    }
  } else if (field === 'history') {
    // Chats anteriores (hasta 6 meses) al conectar en modo coexistencia; no crea clientes nuevos
    for (const h of value.history ?? []) {
      for (const hilo of h.threads ?? []) {
        const tel = digitos(hilo.id)
        const clienteId = await clienteDe(numero, tel, null, false)
        for (const m of hilo.messages ?? []) {
          const saliente = digitos(m.from) === propio
          await guardar({
            wa_numero_id: numero.id, cliente_id: clienteId, telefono: tel, direccion: saliente ? 'saliente' : 'entrante', origen: 'historial',
            wamid: m.id, estado: m.history_context?.status ?? null, fecha: new Date(Number(m.timestamp) * 1000).toISOString(), ...contenido(m),
          })
        }
      }
    }
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET') {
    // Verificación inicial que hace Meta al registrar el webhook
    if (url.searchParams.get('hub.mode') === 'subscribe' && VERIFY_TOKEN && url.searchParams.get('hub.verify_token') === VERIFY_TOKEN) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
    }
    return new Response('Prohibido', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('Método no permitido', { status: 405 })

  const body = await req.text()
  if (!(await avisoValido(body, req))) return new Response('No autorizado', { status: 401 })
  let data: any
  try { data = JSON.parse(body) } catch { return new Response('JSON inválido', { status: 400 }) }

  try {
    for (const entry of data.entry ?? []) {
      for (const ch of entry.changes ?? []) await procesar(ch.value, ch.field)
    }
  } catch (e) {
    console.error('procesar', e) // se responde 200 igual para que Meta no reintente sin fin
  }
  return new Response('ok', { status: 200 })
})
