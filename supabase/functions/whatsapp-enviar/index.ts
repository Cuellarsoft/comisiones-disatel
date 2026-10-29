// Envía mensajes de WhatsApp desde el CRM con el número del vendedor del cliente.
// Acciones: estado (¿hay número conectado? ¿ventana de 24 h abierta?), enviar (texto o PDF),
// plantilla (seguimiento fuera de la ventana) y media (ver archivos que mandó el cliente).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const URL_SB = Deno.env.get('SUPABASE_URL')!
const admin = createClient(URL_SB, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const VER = Deno.env.get('WA_GRAPH_VERSION') ?? 'v21.0'
const PLANTILLA_PROPUESTA = Deno.env.get('WA_PLANTILLA_PROPUESTA') ?? 'propuesta_disatel'
const PLANTILLA_SEGUIMIENTO = Deno.env.get('WA_PLANTILLA_SEGUIMIENTO') ?? 'seguimiento_disatel'
const IDIOMA = Deno.env.get('WA_PLANTILLA_IDIOMA') ?? 'es'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

class ErrorUsuario extends Error {}

// ---------- Proveedor: Meta directo o socio oficial (360dialog), mismo formato de mensajes
function proveedor(n: any) {
  if (n.proveedor === '360dialog') {
    const key = Deno.env.get(n.secreto || '') ?? ''
    if (!key) throw new ErrorUsuario('Falta la clave del socio de WhatsApp para este número.')
    return { base: 'https://waba-v2.360dialog.io', mensajes: '/messages', media: '/media', headers: { 'D360-API-KEY': key } as Record<string, string>, es360: true }
  }
  const token = Deno.env.get('WA_TOKEN') ?? ''
  if (!token) throw new ErrorUsuario('WhatsApp todavía no está conectado (falta la clave de acceso de Meta).')
  return { base: `https://graph.facebook.com/${VER}`, mensajes: `/${n.phone_number_id}/messages`, media: `/${n.phone_number_id}/media`, headers: { Authorization: `Bearer ${token}` } as Record<string, string>, es360: false }
}

function traducirError(e: any) {
  const code = e?.error?.code
  if (code === 131047) return 'Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite enviar una plantilla aprobada.'
  if (code === 132001) return 'La plantilla no existe o todavía no está aprobada por Meta.'
  if (code === 131026) return 'El número del cliente no tiene WhatsApp o no puede recibir mensajes.'
  if (code === 131060) return 'Revisa la app de WhatsApp Business del celular: es el primer mensaje a este contacto o el dispositivo no es compatible.'
  if (code === 190) return 'La clave de acceso de Meta venció o no es válida.'
  return e?.error?.error_user_msg ?? e?.error?.message ?? 'WhatsApp rechazó el mensaje.'
}

async function llamar(p: any, ruta: string, body: unknown) {
  const r = await fetch(p.base + ruta, { method: 'POST', headers: { ...p.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new ErrorUsuario(traducirError(data))
  return data
}

async function subirArchivo(p: any, base64: string, nombre: string, mime: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const fd = new FormData()
  fd.append('messaging_product', 'whatsapp')
  fd.append('type', mime)
  fd.append('file', new Blob([bytes], { type: mime }), nombre)
  const r = await fetch(p.base + p.media, { method: 'POST', headers: p.headers, body: fd })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || !data.id) throw new ErrorUsuario('No se pudo subir el PDF a WhatsApp: ' + traducirError(data))
  return data.id as string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  try {
    // Usuario de la plataforma: la seguridad por vendedor se aplica con su propia sesión
    const authHeader = req.headers.get('Authorization') ?? ''
    const usuario = createClient(URL_SB, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await usuario.auth.getUser()
    if (!user) return json({ error: 'Inicia sesión de nuevo.' }, 401)

    const b = await req.json()

    if (b.accion === 'media') {
      // Solo se entrega un archivo de un mensaje que el usuario puede ver
      const { data: msg } = await usuario.from('wa_mensajes').select('media_id, media_mime, archivo_nombre, wa_numero_id').eq('id', b.mensaje_id).maybeSingle()
      if (!msg?.media_id) return json({ error: 'Archivo no encontrado.' }, 404)
      const { data: n } = await admin.from('wa_numeros').select('*').eq('id', msg.wa_numero_id).single()
      const p = proveedor(n)
      const info = await fetch(`${p.base}/${msg.media_id}`, { headers: p.headers }).then((r) => r.json())
      if (!info.url) return json({ error: 'WhatsApp ya no tiene este archivo (se guardan por tiempo limitado).' }, 410)
      const urlArchivo = p.es360 ? String(info.url).replace('https://lookaside.fbsbx.com', p.base) : info.url
      const archivo = await fetch(urlArchivo, { headers: p.headers })
      return new Response(archivo.body, { headers: { ...CORS, 'Content-Type': msg.media_mime ?? 'application/octet-stream' } })
    }

    if (b.accion === 'webhook') {
      // Solo administrador: registra en 360dialog la dirección donde llegan los mensajes de este número
      const { data: yo } = await admin.from('profiles').select('rol').eq('id', user.id).single()
      if (yo?.rol !== 'admin') return json({ error: 'Solo el administrador puede conectar números.' }, 403)
      const { data: n } = await admin.from('wa_numeros').select('*').eq('id', b.numero_id).single()
      if (!n) throw new ErrorUsuario('Número no encontrado.')
      if (n.proveedor !== '360dialog') throw new ErrorUsuario('Con Meta directo, el webhook se configura en el panel de la app de Meta.')
      const token = Deno.env.get('WA_WEBHOOK_TOKEN') ?? ''
      if (!token) throw new ErrorUsuario('Falta el secreto WA_WEBHOOK_TOKEN en Supabase.')
      const p = proveedor(n)
      await llamar(p, '/v1/configs/webhook', { url: `${URL_SB}/functions/v1/whatsapp-webhook`, headers: { Authorization: `Bearer ${token}` } })
      return json({ ok: true })
    }

    // El cliente tiene que ser del usuario (o el usuario, administrador)
    const { data: cli } = await usuario.from('clientes').select('id, vendedor_id, empresa, contacto, telefono_wa').eq('id', b.cliente_id).maybeSingle()
    if (!cli) return json({ error: 'Cliente no encontrado o no es tuyo.' }, 404)
    const { data: n } = await admin.from('wa_numeros').select('*').eq('vendedor_id', cli.vendedor_id).eq('activo', true).order('id').limit(1).maybeSingle()

    // Ventana de 24 h: abierta si el cliente escribió en las últimas 24 horas
    const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { count } = cli.telefono_wa
      ? await admin.from('wa_mensajes').select('id', { count: 'exact', head: true }).eq('telefono', cli.telefono_wa).eq('direccion', 'entrante').gte('fecha', desde)
      : { count: 0 }
    const ventana = (count ?? 0) > 0

    if (b.accion === 'estado') {
      return json({ conectado: !!n, numero: n?.numero ?? null, ventana_abierta: ventana, tiene_telefono: !!cli.telefono_wa })
    }
    if (!n) throw new ErrorUsuario('Tu usuario no tiene un número de WhatsApp conectado.')
    if (!cli.telefono_wa) throw new ErrorUsuario('El cliente no tiene número de WhatsApp cargado.')

    const p = proveedor(n)
    const { data: perfil } = await admin.from('profiles').select('nombre').eq('id', user.id).single()
    const saludo = cli.contacto || cli.empresa
    const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: cli.telefono_wa }
    let envio: any, fila: any

    if (b.accion === 'enviar' && b.documento) {
      const mediaId = await subirArchivo(p, b.documento.base64, b.documento.nombre, b.documento.mime ?? 'application/pdf')
      if (ventana) {
        envio = { ...base, type: 'document', document: { id: mediaId, filename: b.documento.nombre, caption: b.texto ?? '' } }
        fila = { tipo: 'document', texto: b.texto ?? null }
      } else {
        // Fuera de la ventana: plantilla aprobada con el PDF como encabezado
        envio = { ...base, type: 'template', template: { name: PLANTILLA_PROPUESTA, language: { code: IDIOMA }, components: [
          { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename: b.documento.nombre } }] },
          { type: 'body', parameters: [{ type: 'text', text: saludo }, { type: 'text', text: perfil?.nombre ?? 'DISATEL' }] },
        ] } }
        fila = { tipo: 'template', texto: `Plantilla “${PLANTILLA_PROPUESTA}” con la propuesta` }
      }
      fila = { ...fila, media_id: mediaId, media_mime: b.documento.mime ?? 'application/pdf', archivo_nombre: b.documento.nombre }
    } else if (b.accion === 'enviar') {
      const texto = String(b.texto ?? '').trim()
      if (!texto) throw new ErrorUsuario('Escribe un mensaje.')
      if (!ventana) throw new ErrorUsuario('Pasaron más de 24 horas desde el último mensaje del cliente. Usa “Enviar seguimiento” (plantilla aprobada).')
      envio = { ...base, type: 'text', text: { preview_url: true, body: texto } }
      fila = { tipo: 'text', texto }
    } else if (b.accion === 'plantilla') {
      envio = { ...base, type: 'template', template: { name: PLANTILLA_SEGUIMIENTO, language: { code: IDIOMA }, components: [
        { type: 'body', parameters: [{ type: 'text', text: saludo }, { type: 'text', text: perfil?.nombre ?? 'DISATEL' }] },
      ] } }
      fila = { tipo: 'template', texto: `Plantilla “${PLANTILLA_SEGUIMIENTO}”` }
    } else {
      throw new ErrorUsuario('Acción desconocida.')
    }

    const r = await llamar(p, p.mensajes, envio)
    const wamid = r.messages?.[0]?.id ?? null
    await admin.from('wa_mensajes').insert({
      wa_numero_id: n.id, cliente_id: cli.id, telefono: cli.telefono_wa, direccion: 'saliente', origen: 'crm',
      wamid, estado: 'enviado', enviado_por: user.id, ...fila,
    })
    await admin.from('clientes').update({ wa_ultimo_at: new Date().toISOString() }).eq('id', cli.id)
    return json({ ok: true, modo: fila.tipo === 'template' ? 'plantilla' : 'mensaje', wamid })
  } catch (e) {
    if (e instanceof ErrorUsuario) return json({ error: e.message }, 400)
    console.error(e)
    return json({ error: 'Error inesperado al enviar por WhatsApp.' }, 500)
  }
})
