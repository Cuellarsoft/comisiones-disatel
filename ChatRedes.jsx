import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { Cargando, Error } from './ui'
import { RED, redes } from './crmLib'

export const hora = (iso) => new Date(iso).toLocaleString('es-BO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
export const VEINTICUATRO = 24 * 3600 * 1000

export function ChipRed({ p }) {
  return <span className={'red-chip ' + p}>{RED[p]}</span>
}

// ---------- Conversación de Messenger o Instagram Direct de un cliente
export function ChatRedes({ c, plataforma, onLeido }) {
  const [msgs, setMsgs] = useState(null)
  const [texto, setTexto] = useState('')
  const [err, setErr] = useState('')
  const [enviando, setEnviando] = useState(false)
  const fin = useRef(null)

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('redes_mensajes').select('*').eq('cliente_id', c.id).eq('plataforma', plataforma).eq('clase', 'mensaje').order('fecha')
    setMsgs(data || [])
  }, [c.id, plataforma])

  useEffect(() => {
    cargar()
    if (c.redes_no_leidos > 0) supabase.from('clientes').update({ redes_no_leidos: 0 }).eq('id', c.id).then(() => onLeido?.())
    const canal = supabase.channel(`redes-${c.id}-${plataforma}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'redes_mensajes', filter: `cliente_id=eq.${c.id}` }, () => cargar())
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [c.id, plataforma]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }) }, [msgs])

  async function enviar() {
    setErr(''); setEnviando(true)
    try { await redes({ accion: 'mensaje', cliente_id: c.id, plataforma, texto }); setTexto(''); cargar() }
    catch (e) { setErr(e.message) } finally { setEnviando(false) }
  }

  if (!msgs) return <Cargando />
  const ultimaEntrante = [...msgs].reverse().find((m) => m.direccion === 'entrante')
  const abierta = ultimaEntrante && Date.now() - new Date(ultimaEntrante.fecha) < VEINTICUATRO
  const ORIGEN = { crm: 'desde la plataforma', pagina: `desde ${RED[plataforma]}` }
  return (
    <div className="wa">
      <div className={'wa-chat red-fondo ' + plataforma}>
        {msgs.map((m) => (
          <div key={m.id} className={'wa-burbuja ' + (m.direccion === 'saliente' ? 'sale' : 'entra')}>
            {m.adjunto_url && (m.adjunto_tipo === 'image'
              ? <a href={m.adjunto_url} target="_blank" rel="noopener"><img className="red-img" src={m.adjunto_url} alt="Imagen enviada por el cliente" /></a>
              : <a className="wa-archivo" href={m.adjunto_url} target="_blank" rel="noopener">Ver {m.adjunto_tipo === 'audio' ? 'audio' : m.adjunto_tipo === 'video' ? 'video' : 'archivo'}</a>)}
            {m.texto && <p>{m.texto}</p>}
            <span className="wa-meta">{hora(m.fecha)}{m.direccion === 'saliente' && ` · ${ORIGEN[m.origen] || ''}`}</span>
            {m.error && <span className="wa-error">{m.error}</span>}
          </div>
        ))}
        {!msgs.length && <div className="vacio">Todavía no hay mensajes de {RED[plataforma]} con este cliente.</div>}
        <div ref={fin} />
      </div>
      <Error msg={err} />
      {abierta
        ? <div className="wa-escribir">
            <textarea rows="2" value={texto} placeholder={`Responder por ${RED[plataforma]}`} onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && texto.trim()) { e.preventDefault(); enviar() } }} />
            <button className={'btn red-btn ' + plataforma} disabled={enviando || !texto.trim()} onClick={enviar}>{enviando ? 'Enviando…' : 'Enviar'}</button>
          </div>
        : msgs.length > 0 && <div className="wa-cerrada"><span>Pasaron más de 24 horas desde el último mensaje de esta persona. {RED[plataforma]} solo permite responder cuando vuelva a escribir.</span></div>}
    </div>
  )
}

