// Envía correos desde la casilla de cada vendedor (Zoho Mail u otro SMTP), con el PDF de la cotización adjunto.
// Acciones: estado (¿el usuario tiene correo conectado?), enviar, probar (manda un correo de prueba a la misma casilla).
// La contraseña de cada casilla es un secreto de Supabase; la tabla solo guarda su nombre.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import nodemailer from 'npm:nodemailer@6.9.16'

const URL_SB = Deno.env.get('SUPABASE_URL')!
const admin = createClient(URL_SB, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
class ErrorUsuario extends Error {}

const esCorreo = (t: unknown) => typeof t === 'string' && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(t.trim())

function traducir(e: any) {
  const code = e?.code ?? ''
  const resp = String(e?.response ?? e?.message ?? '')
  if (code === 'EAUTH' || /535|authentication/i.test(resp)) return 'Zoho rechazó el usuario o la contraseña. Usa una contraseña de aplicación de Zoho y revisa que el acceso SMTP esté habilitado en la casilla.'
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET' || code === 'EDNS') return 'No se pudo conectar con el servidor de correo. Revisa el servidor (smtppro.zoho.com o smtp.zoho.com) y el puerto 465.'
  if (/550|553|sender|relay/i.test(resp)) return 'El servidor de correo no permitió enviar desde esta casilla: ' + resp.slice(0, 160)
  return 'No se pudo enviar el correo: ' + resp.slice(0, 160)
}

async function enviar(cuenta: any, msg: { para: string; asunto: string; texto: string; adjunto?: { nombre: string; base64: string; mime: string } }) {
  const pass = Deno.env.get(cuenta.secreto || '') ?? ''
  if (!pass) throw new ErrorUsuario(`Falta el secreto ${cuenta.secreto} con la contraseña del correo en Supabase.`)
  const t = nodemailer.createTransport({
    host: cuenta.servidor, port: cuenta.puerto, secure: cuenta.puerto === 465,
    auth: { user: cuenta.correo, pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  })
  try {
    const r = await t.sendMail({
      from: { name: cuenta.remitente || 'DISATEL Bolivia', address: cuenta.correo },
      to: msg.para.trim(), subject: msg.asunto, text: msg.texto,
      attachments: msg.adjunto ? [{ filename: msg.adjunto.nombre, content: msg.adjunto.base64, encoding: 'base64', contentType: msg.adjunto.mime }] : [],
    })
    return r.messageId as string
  } catch (e) {
    throw new ErrorUsuario(traducir(e))
  } finally { t.close() }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  try {
    const usuario = createClient(URL_SB, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await usuario.auth.getUser()
    if (!user) return json({ error: 'Inicia sesión de nuevo.' }, 401)
    const b = await req.json()

    if (b.accion === 'probar') {
      // El administrador prueba cualquier cuenta; cada vendedor, solo la suya
      const { data: yo } = await admin.from('profiles').select('rol').eq('id', user.id).single()
      const { data: c } = await admin.from('correo_cuentas').select('*').eq('id', b.cuenta_id).maybeSingle()
      if (!c || (c.vendedor_id !== user.id && yo?.rol !== 'admin')) throw new ErrorUsuario('Cuenta de correo no encontrada.')
      await enviar(c, { para: c.correo, asunto: 'Prueba de envío desde Ventas Disatel', texto: 'Si recibes este correo, la plataforma ya puede enviar cotizaciones desde esta casilla.' })
      return json({ ok: true })
    }

    const { data: cuenta } = await admin.from('correo_cuentas').select('*').eq('vendedor_id', user.id).eq('activo', true).maybeSingle()
    if (b.accion === 'estado') return json({ conectado: !!cuenta, correo: cuenta?.correo ?? null })

    if (b.accion === 'enviar') {
      if (!cuenta) throw new ErrorUsuario('Tu usuario no tiene un correo conectado.')
      if (!esCorreo(b.para)) throw new ErrorUsuario('Escribe un correo válido para el cliente.')
      const asunto = String(b.asunto ?? '').slice(0, 200).trim()
      const texto = String(b.texto ?? '').slice(0, 10000)
      if (!asunto) throw new ErrorUsuario('Falta el asunto del correo.')
      const d = b.documento
      if (d && (typeof d.base64 !== 'string' || d.base64.length > 14_000_000)) throw new ErrorUsuario('El archivo adjunto no es válido o es demasiado grande.')
      const id = await enviar(cuenta, { para: b.para, asunto, texto, adjunto: d ? { nombre: String(d.nombre || 'cotizacion.pdf'), base64: d.base64, mime: 'application/pdf' } : undefined })
      return json({ ok: true, correo: cuenta.correo, id })
    }
    throw new ErrorUsuario('Acción desconocida.')
  } catch (e) {
    if (e instanceof ErrorUsuario) return json({ error: e.message }, 400)
    console.error(e)
    return json({ error: 'Error inesperado al enviar el correo.' }, 500)
  }
})
