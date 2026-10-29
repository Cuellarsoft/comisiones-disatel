// Responde desde el CRM en Facebook e Instagram con la clave de la página.
// Acciones: mensaje (Messenger / Direct), comentario (respuesta pública), privado (mensaje privado a quien comentó),
// prospecto (crea el cliente a partir de una conversación o un comentario).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const URL_SB = Deno.env.get('SUPABASE_URL')!
const admin = createClient(URL_SB, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const VER = Deno.env.get('REDES_GRAPH_VERSION') ?? 'v21.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
class ErrorUsuario extends Error {}

function traducir(e: any) {
  const err = e?.error ?? {}
  if (err.code === 10 && err.error_subcode === 2018278) return 'Pasaron más de 24 horas desde el último mensaje de esta persona. Meta ya no permite escribirle por mensaje; respóndele en un comentario o espera que vuelva a escribir.'
  if (err.code === 10 && err.error_subcode === 2534022) return 'Pasaron más de 7 días desde el comentario: Meta ya no permite enviarle un mensaje privado.'
  if (err.code === 551 || err.error_subcode === 1545041) return 'Esta persona no está disponible para recibir mensajes.'
  if (err.code === 190) return 'La clave de la página venció o no es válida. Hay que generarla de nuevo.'
  if (err.code === 200 || err.code === 10) return 'Falta un permiso de la app de Meta para esta acción: ' + (err.message ?? '')
  return err.error_user_msg ?? err.message ?? 'Meta rechazó el envío.'
}

async function llamar(cuenta: any, ruta: string, body: unknown) {
  const token = Deno.env.get(cuenta.secreto || '') ?? ''
  if (!token) throw new ErrorUsuario(`Falta el secreto ${cuenta.secreto} con la clave de la página en Supabase.`)
  const r = await fetch(`https://graph.facebook.com/${VER}/${ruta}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new ErrorUsuario(traducir(data))
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  try {
    const usuario = createClient(URL_SB, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await usuario.auth.getUser()
    if (!user) return json({ error: 'Inicia sesión de nuevo.' }, 401)
    const b = await req.json()
    const texto = String(b.texto ?? '').trim().slice(0, 2000)

    if (b.accion === 'mensaje') {
      // El cliente tiene que ser del usuario (o el usuario, administrador)
      const { data: cli } = await usuario.from('clientes').select('id, fb_id, ig_id').eq('id', b.cliente_id).maybeSingle()
      if (!cli) throw new ErrorUsuario('Cliente no encontrado o no es tuyo.')
      const plataforma = b.plataforma === 'instagram' ? 'instagram' : 'facebook'
      const destino = plataforma === 'facebook' ? cli.fb_id : cli.ig_id
      if (!destino) throw new ErrorUsuario(`Este cliente no tiene conversación de ${plataforma === 'facebook' ? 'Facebook' : 'Instagram'}.`)
      if (!texto) throw new ErrorUsuario('Escribe un mensaje.')
      // Se responde desde la cuenta por la que escribió la última vez
      const { data: ult } = await admin.from('redes_mensajes').select('cuenta_id').eq('plataforma', plataforma).eq('clase', 'mensaje').eq('usuario_id', destino).order('fecha', { ascending: false }).limit(1).maybeSingle()
      const { data: cuenta } = ult
        ? await admin.from('redes_cuentas').select('*').eq('id', ult.cuenta_id).single()
        : await admin.from('redes_cuentas').select('*').eq('plataforma', plataforma).eq('activo', true).order('id').limit(1).single()
      if (!cuenta) throw new ErrorUsuario('No hay una cuenta conectada para esta red.')
      const r = await llamar(cuenta, 'me/messages', { recipient: { id: destino }, messaging_type: 'RESPONSE', message: { text: texto } })
      await admin.from('redes_mensajes').insert({
        cuenta_id: cuenta.id, plataforma, clase: 'mensaje', direccion: 'saliente', origen: 'crm', cliente_id: cli.id,
        usuario_id: destino, texto, mid: r.message_id ?? null, estado: 'enviado', enviado_por: user.id,
      })
      return json({ ok: true })
    }

    if (b.accion === 'importar') {
      // Trae los comentarios recientes de las publicaciones (sirve aunque Meta todavía no mande los avisos de comentarios)
      const { data: yo } = await admin.from('profiles').select('rol').eq('id', user.id).single()
      const { data: cs } = await admin.from('redes_cuentas').select('*').eq('activo', true)
      const mias = (cs ?? []).filter((c: any) => yo?.rol === 'admin' || c.vendedor_id === user.id)
      if (!mias.length) throw new ErrorUsuario('No tienes cuentas de Facebook o Instagram a tu cargo.')
      let nuevos = 0
      const errores: string[] = []
      for (const c of mias) {
        const token = Deno.env.get(c.secreto || '') ?? ''
        if (!token) { errores.push(`Falta la clave de ${c.nombre}.`); continue }
        const fb = c.plataforma === 'facebook'
        const campos = fb
          ? `posts?limit=15&fields=id,permalink_url,comments.limit(50).order(reverse_chronological){id,from{id,name},message,created_time,comments{id,from{id,name},message,created_time}}`
          : `media?limit=15&fields=id,permalink,comments.limit(50){id,text,username,from{id,username},timestamp,replies{id,text,username,from{id,username},timestamp}}`
        const r = await fetch(`https://graph.facebook.com/${VER}/${c.cuenta_id}/${campos}`, { headers: { Authorization: `Bearer ${token}` } })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { errores.push(`${c.nombre}: ${traducir(j)}`); continue }
        const filas: any[] = []
        const pagina = (x: any) => (fb ? x.from?.id === c.cuenta_id : (x.from?.id === c.cuenta_id || ('@' + x.username) === c.nombre))
        for (const p of j.data ?? []) {
          const url = fb ? p.permalink_url : p.permalink
          for (const k of p.comments?.data ?? []) {
            const resp = fb ? k.comments?.data ?? [] : k.replies?.data ?? []
            const propio = pagina(k)
            const nombre = (x: any) => x.from?.name || (x.username ? '@' + x.username : x.from?.username ? '@' + x.from.username : null)
            filas.push({
              cuenta_id: c.id, plataforma: c.plataforma, clase: 'comentario', direccion: propio ? 'saliente' : 'entrante', origen: propio ? 'pagina' : 'cliente',
              usuario_id: propio ? null : k.from?.id ?? null, usuario_nombre: propio ? c.nombre : nombre(k), texto: fb ? k.message : k.text,
              mid: k.id, publicacion_id: p.id, publicacion_url: url ?? null, respondido: resp.some(pagina),
              fecha: new Date(fb ? k.created_time : k.timestamp).toISOString(),
            })
            for (const x of resp) {
              const suyo = pagina(x)
              filas.push({
                cuenta_id: c.id, plataforma: c.plataforma, clase: 'comentario', direccion: suyo ? 'saliente' : 'entrante', origen: suyo ? 'pagina' : 'cliente',
                usuario_id: suyo ? null : x.from?.id ?? null, usuario_nombre: suyo ? c.nombre : nombre(x), texto: fb ? x.message : x.text,
                mid: x.id, responde_a: k.id, publicacion_id: p.id, publicacion_url: url ?? null,
                fecha: new Date(fb ? x.created_time : x.timestamp).toISOString(),
              })
            }
          }
        }
        if (!filas.length) continue
        const { data: ya } = await admin.from('redes_mensajes').select('mid').in('mid', filas.map((f) => f.mid))
        const existentes = new Set((ya ?? []).map((x: any) => x.mid))
        const nuevas = filas.filter((f) => !existentes.has(f.mid))
        if (nuevas.length) {
          const { error } = await admin.from('redes_mensajes').insert(nuevas)
          if (error) errores.push(`${c.nombre}: ${error.message}`); else nuevos += nuevas.length
        }
        // Lo que se respondió desde Facebook o Instagram queda marcado
        const respondidos = filas.filter((f) => f.respondido).map((f) => f.mid)
        if (respondidos.length) await admin.from('redes_mensajes').update({ respondido: true }).in('mid', respondidos)
      }
      return json({ ok: true, nuevos, errores })
    }

    // Las demás acciones parten de un comentario o mensaje que el usuario puede ver
    const { data: m } = await usuario.from('redes_mensajes').select('*').eq('id', b.mensaje_id).maybeSingle()
    if (!m) throw new ErrorUsuario('Mensaje no encontrado.')
    const { data: cuenta } = await admin.from('redes_cuentas').select('*').eq('id', m.cuenta_id).single()

    if (b.accion === 'comentario' || b.accion === 'privado') {
      if (m.clase !== 'comentario' || m.direccion !== 'entrante') throw new ErrorUsuario('Solo se puede responder un comentario de un cliente.')
      if (!texto) throw new ErrorUsuario('Escribe la respuesta.')
      let fila: any
      if (b.accion === 'comentario') {
        const ruta = m.plataforma === 'facebook' ? `${m.mid}/comments` : `${m.mid}/replies`
        const r = await llamar(cuenta, ruta, { message: texto })
        fila = { clase: 'comentario', mid: r.id ?? null, publicacion_id: m.publicacion_id, publicacion_url: m.publicacion_url }
      } else {
        const r = await llamar(cuenta, 'me/messages', { recipient: { comment_id: m.mid }, message: { text: texto } })
        fila = { clase: 'mensaje', mid: r.message_id ?? null }
        // La conversación privada que se abre queda en el cliente si ya existe
        if (r.recipient_id && m.cliente_id) {
          const col = m.plataforma === 'facebook' ? 'fb_id' : 'ig_id'
          await admin.from('clientes').update({ [col]: r.recipient_id }).eq('id', m.cliente_id).is(col, null)
        }
      }
      await admin.from('redes_mensajes').insert({
        cuenta_id: m.cuenta_id, plataforma: m.plataforma, direccion: 'saliente', origen: 'crm', cliente_id: m.cliente_id,
        usuario_id: m.usuario_id, usuario_nombre: m.usuario_nombre, texto, responde_a: m.mid, estado: 'enviado', enviado_por: user.id, ...fila,
      })
      await admin.from('redes_mensajes').update({ respondido: true }).eq('id', m.id)
      return json({ ok: true })
    }

    if (b.accion === 'prospecto') {
      if (m.cliente_id) return json({ ok: true, cliente_id: m.cliente_id })
      if (!m.usuario_id) throw new ErrorUsuario('No se sabe quién escribió este mensaje.')
      const red = m.plataforma === 'facebook' ? 'Facebook' : 'Instagram'
      const col = m.plataforma === 'facebook' ? 'fb_id' : 'ig_id'
      const vendedor = cuenta.vendedor_id ?? user.id
      const { data: nuevo, error } = await admin.from('clientes').insert({
        vendedor_id: vendedor, empresa: m.usuario_nombre || `Contacto de ${red}`, contacto: m.usuario_nombre,
        tipo: 'empresa', origen: red, etapa: 'Prospecto', [col]: m.clase === 'mensaje' || m.plataforma === 'instagram' ? m.usuario_id : null,
      }).select('id').single()
      if (error) throw new ErrorUsuario('No se pudo crear el cliente: ' + error.message)
      await admin.from('redes_mensajes').update({ cliente_id: nuevo.id }).eq('cuenta_id', m.cuenta_id).eq('usuario_id', m.usuario_id).is('cliente_id', null)
      await admin.from('actividades').insert({
        cliente_id: nuevo.id, vendedor_id: vendedor, tipo: 'nota',
        texto: m.clase === 'comentario' ? `Comentó en una publicación de ${red}: “${(m.texto ?? '').slice(0, 200)}”` : `Escribió por ${red}.`,
      })
      return json({ ok: true, cliente_id: nuevo.id })
    }
    throw new ErrorUsuario('Acción desconocida.')
  } catch (e) {
    if (e instanceof ErrorUsuario) return json({ error: e.message }, 400)
    console.error(e)
    return json({ error: 'Error inesperado al enviar.' }, 500)
  }
})
