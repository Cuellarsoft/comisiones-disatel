// Recibe los avisos de Meta de la página de Facebook y la cuenta de Instagram:
// mensajes (Messenger / Direct), mensajes enviados desde la página y comentarios en publicaciones.
// Se publica sin verificación de usuario (Meta no envía sesión); se valida con la firma de la app de Meta.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const VERIFY_TOKEN = (Deno.env.get('REDES_VERIFY_TOKEN') ?? '').trim()
const APP_SECRET = (Deno.env.get('REDES_APP_SECRET') ?? '').trim()
const VER = Deno.env.get('REDES_GRAPH_VERSION') ?? 'v21.0'

async function firmaValida(body: string, firma: string | null) {
  if (!APP_SECRET || !firma?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('')
  const esperado = firma.slice(7)
  if (hex.length !== esperado.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ esperado.charCodeAt(i)
  return diff === 0
}

const cuentas = new Map<string, any>()
async function cuentaDe(plataforma: string, id: string) {
  const k = plataforma + ':' + id
  if (cuentas.has(k)) return cuentas.get(k)
  const { data } = await sb.from('redes_cuentas').select('*').eq('plataforma', plataforma).eq('cuenta_id', id).eq('activo', true).maybeSingle()
  if (data) cuentas.set(k, data)
  return data
}

// Consulta a Meta con la clave de la página (nombre de la persona, enlace de la publicación)
async function graph(cuenta: any, ruta: string) {
  const token = Deno.env.get(cuenta.secreto || '') ?? ''
  if (!token) return null
  try {
    const r = await fetch(`https://graph.facebook.com/${VER}/${ruta}`, { headers: { Authorization: `Bearer ${token}` } })
    return r.ok ? await r.json() : null
  } catch { return null }
}

async function nombreDe(cuenta: any, usuarioId: string) {
  const p = cuenta.plataforma === 'facebook'
    ? await graph(cuenta, `${usuarioId}?fields=first_name,last_name,name`)
    : await graph(cuenta, `${usuarioId}?fields=name,username`)
  if (!p) return null
  return p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || (p.username ? '@' + p.username : null)
}

const enlaces = new Map<string, string | null>()
async function enlacePublicacion(cuenta: any, id: string) {
  if (!id) return null
  if (enlaces.has(id)) return enlaces.get(id)!
  const campo = cuenta.plataforma === 'facebook' ? 'permalink_url' : 'permalink'
  const r = await graph(cuenta, `${id}?fields=${campo}`)
  const url = r?.[campo] ?? null
  enlaces.set(id, url)
  return url
}

const colId = (cuenta: any) => (cuenta.plataforma === 'facebook' ? 'fb_id' : 'ig_id')

// Cliente del vendedor que atiende la cuenta; si escribe alguien nuevo por mensaje, se crea como prospecto
async function clienteDe(cuenta: any, usuarioId: string, crear: boolean) {
  if (!cuenta.vendedor_id || !usuarioId) return { id: null, nombre: null }
  const { data } = await sb.from('clientes').select('id, empresa').eq('vendedor_id', cuenta.vendedor_id).eq(colId(cuenta), usuarioId).order('id').limit(1)
  if (data?.length) return { id: data[0].id, nombre: data[0].empresa }
  const nombre = await nombreDe(cuenta, usuarioId)
  if (!crear) return { id: null, nombre }
  const red = cuenta.plataforma === 'facebook' ? 'Facebook' : 'Instagram'
  const { data: nuevo, error } = await sb.from('clientes').insert({
    vendedor_id: cuenta.vendedor_id, empresa: nombre || `Contacto de ${red}`, contacto: nombre,
    tipo: 'empresa', origen: red, etapa: 'Prospecto', [colId(cuenta)]: usuarioId,
  }).select('id').single()
  if (error) { console.error('crear cliente', error.message); return { id: null, nombre } }
  await sb.from('seguimientos').insert({
    cliente_id: nuevo.id, vendedor_id: cuenta.vendedor_id, fecha: new Date().toISOString().slice(0, 10),
    texto: `Responder: nuevo contacto por ${red}`, automatico: true,
  })
  await sb.from('actividades').insert({ cliente_id: nuevo.id, vendedor_id: cuenta.vendedor_id, tipo: 'nota', texto: `Escribió por primera vez por ${red}.` })
  return { id: nuevo.id, nombre }
}

async function guardar(fila: any) {
  const { error } = await sb.from('redes_mensajes').upsert(fila, { onConflict: 'mid', ignoreDuplicates: true })
  if (error) console.error('guardar', error.message)
}

// Mensajes de Messenger o de Instagram Direct
async function mensaje(cuenta: any, ev: any) {
  const m = ev.message
  if (!m || m.is_deleted || m.is_unsupported) return
  const eco = !!m.is_echo // lo envió la página (desde Meta Business Suite, el celular o esta plataforma)
  const usuarioId = eco ? ev.recipient?.id : ev.sender?.id
  if (!usuarioId) return
  const cli = await clienteDe(cuenta, usuarioId, !eco)
  const adj = m.attachments?.[0]
  await guardar({
    cuenta_id: cuenta.id, plataforma: cuenta.plataforma, clase: 'mensaje', direccion: eco ? 'saliente' : 'entrante', origen: eco ? 'pagina' : 'cliente',
    cliente_id: cli.id, usuario_id: usuarioId, usuario_nombre: cli.nombre, texto: m.text ?? null,
    adjunto_url: adj?.payload?.url ?? null, adjunto_tipo: adj?.type ?? null, mid: m.mid,
    fecha: new Date(Number(ev.timestamp) || Date.now()).toISOString(),
  })
  if (!eco && cli.id) {
    const { data: c } = await sb.from('clientes').select('redes_no_leidos, etapa').eq('id', cli.id).single()
    await sb.from('clientes').update({
      redes_no_leidos: (c?.redes_no_leidos ?? 0) + 1,
      ...(c?.etapa === 'Prospecto' ? { etapa: 'Contactado' } : {}),
    }).eq('id', cli.id)
  }
}

// Comentarios en publicaciones (no crean clientes solos: el vendedor decide desde la bandeja)
async function comentario(cuenta: any, v: any) {
  const fb = cuenta.plataforma === 'facebook'
  if (fb && (v.item !== 'comment' || (v.verb !== 'add' && v.verb !== 'edited'))) return
  const mid = fb ? v.comment_id : v.id
  const autor = v.from?.id
  if (!mid || !autor) return
  const propio = autor === cuenta.cuenta_id
  const pubId = fb ? v.post_id : v.media?.id
  const padre = fb ? (v.parent_id && v.parent_id !== v.post_id ? v.parent_id : null) : v.parent_id ?? null
  const texto = fb ? v.message : v.text
  if (fb && v.verb === 'edited') {
    await sb.from('redes_mensajes').update({ texto }).eq('mid', mid)
    return
  }
  const cli = propio ? { id: null, nombre: null } : await clienteDe(cuenta, autor, false)
  await guardar({
    cuenta_id: cuenta.id, plataforma: cuenta.plataforma, clase: 'comentario',
    direccion: propio ? 'saliente' : 'entrante', origen: propio ? 'pagina' : 'cliente',
    cliente_id: cli.id, usuario_id: propio ? null : autor,
    usuario_nombre: propio ? cuenta.nombre : (v.from?.name || (v.from?.username ? '@' + v.from.username : cli.nombre)),
    texto: texto ?? null, adjunto_url: fb ? v.photo ?? null : null, adjunto_tipo: fb && v.photo ? 'image' : null,
    mid, responde_a: padre, publicacion_id: pubId ?? null, publicacion_url: await enlacePublicacion(cuenta, pubId),
    fecha: v.created_time ? new Date(typeof v.created_time === 'number' ? v.created_time * 1000 : v.created_time).toISOString() : new Date().toISOString(),
  })
  // Si la página respondió en Facebook o Instagram, el comentario original queda como respondido
  if (propio && padre) await sb.from('redes_mensajes').update({ respondido: true }).eq('mid', padre)
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET') {
    if (url.searchParams.get('hub.mode') === 'subscribe' && VERIFY_TOKEN && url.searchParams.get('hub.verify_token') === VERIFY_TOKEN) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
    }
    // Revisión de la conexión con la página: deja el resultado en los registros del servidor (no lo muestra)
    if (url.searchParams.get('revisar') === '1') {
      const { data: cs } = await sb.from('redes_cuentas').select('*').eq('activo', true)
      for (const c of cs ?? []) {
        const tok = Deno.env.get(c.secreto || '') ?? ''
        const ver = async (ruta: string) => {
          try {
            const r = await fetch(`https://graph.facebook.com/${VER}/${ruta}`, { headers: { Authorization: `Bearer ${tok}` } })
            const j = await r.json()
            return { status: r.status, ...(j.error ? { error: { code: j.error.code, sub: j.error.error_subcode, msg: j.error.message } } : { data: j.data ?? j }) }
          } catch (e) { return { fallo: String(e) } }
        }
        console.log('revision', c.plataforma, c.cuenta_id, JSON.stringify({
          hay_clave: !!tok, largo_clave: tok.length,
          yo: await ver('me?fields=id,name'),
          apps: await ver(`${c.cuenta_id}/subscribed_apps`),
          conversaciones: await ver(`${c.cuenta_id}/conversations?limit=1&fields=updated_time`),
        }))
      }
      return new Response('Revisión hecha. Ya puedes cerrar esta pestaña.', { status: 200 })
    }
    return new Response('Prohibido', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('Método no permitido', { status: 405 })

  const body = await req.text()
  if (!(await firmaValida(body, req.headers.get('x-hub-signature-256')))) {
    console.warn('firma rechazada', { hay_secreto: !!APP_SECRET, largo_secreto: APP_SECRET.length, hay_firma: !!req.headers.get('x-hub-signature-256') })
    return new Response('No autorizado', { status: 401 })
  }
  let data: any
  try { data = JSON.parse(body) } catch { return new Response('JSON inválido', { status: 400 }) }

  console.log('aviso', data.object, (data.entry ?? []).map((e: any) => ({ id: e.id, claves: Object.keys(e) })))
  const plataforma = data.object === 'page' ? 'facebook' : data.object === 'instagram' ? 'instagram' : null
  if (!plataforma) return new Response('ok', { status: 200 })
  try {
    for (const entry of data.entry ?? []) {
      const cuenta = await cuentaDe(plataforma, String(entry.id))
      if (!cuenta) { console.warn('cuenta no registrada', plataforma, entry.id); continue }
      // standby: mensajes que llegan cuando otra app de la página atiende primero (enrutamiento de conversaciones)
      for (const ev of [...(entry.messaging ?? []), ...(entry.standby ?? [])]) await mensaje(cuenta, ev)
      for (const ch of entry.changes ?? []) {
        if (ch.field === 'feed' || ch.field === 'comments') await comentario(cuenta, ch.value ?? {})
      }
    }
  } catch (e) {
    console.error('procesar', e) // se responde 200 igual para que Meta no reintente sin fin
  }
  return new Response('ok', { status: 200 })
})
