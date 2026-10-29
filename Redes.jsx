import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { Cabecera, Cargando, Error } from './ui'
import { redes } from './crmLib'
import FichaCliente from './FichaCliente'
import { ChatRedes, ChipRed, VEINTICUATRO, hora } from './ChatRedes'

// ---------- Bandeja de Facebook e Instagram
export default function Redes() {
  const [vista, setVista] = useState('mensajes')
  const [red, setRed] = useState('todas')
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [ficha, setFicha] = useState(null)

  const cargar = useCallback(async () => {
    const [m, c, k] = await Promise.all([
      supabase.from('redes_mensajes').select('*').order('fecha', { ascending: false }).limit(800),
      supabase.from('clientes').select('id, empresa, contacto, etapa, redes_no_leidos, fb_id, ig_id'),
      supabase.from('redes_cuentas').select('id, plataforma, nombre'),
    ])
    if (m.error) setErr(m.error.message)
    setD({ msgs: m.data || [], clientes: c.data || [], cuentas: k.data || [] })
  }, [])
  useEffect(() => {
    cargar()
    const canal = supabase.channel('redes-bandeja')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'redes_mensajes' }, () => cargar())
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [cargar])

  if (!d) return <Cargando />
  const filtrados = d.msgs.filter((m) => red === 'todas' || m.plataforma === red)
  const sinResponder = filtrados.filter((m) => m.clase === 'comentario' && m.direccion === 'entrante' && !m.respondido).length
  const noLeidos = d.clientes.reduce((s, c) => s + (c.redes_no_leidos || 0), 0)

  return (
    <>
      <Cabecera titulo="Facebook e Instagram" sub="Mensajes y comentarios de la página de Disatel; cada persona que escribe queda como prospecto" />
      <Error msg={err} />
      {!d.cuentas.length && <div className="nota" style={{ marginBottom: 16 }}>Todavía no hay cuentas conectadas. El administrador las conecta en Clientes › Configuración › Redes sociales.</div>}
      <div className="red-barra">
        <div className="crm-pestanas" role="tablist">
          <button role="tab" aria-selected={vista === 'mensajes'} className={vista === 'mensajes' ? 'on' : ''} onClick={() => setVista('mensajes')}>Mensajes{noLeidos > 0 && <span className="crm-noleidos">{noLeidos}</span>}</button>
          <button role="tab" aria-selected={vista === 'comentarios'} className={vista === 'comentarios' ? 'on' : ''} onClick={() => setVista('comentarios')}>Comentarios{sinResponder > 0 && <span className="crm-noleidos">{sinResponder}</span>}</button>
        </div>
        <div className="segmento red-filtro">
          {[['todas', 'Todas'], ['facebook', 'Facebook'], ['instagram', 'Instagram']].map(([k, t]) => (
            <button key={k} type="button" className={red === k ? 'on' : ''} onClick={() => setRed(k)}>{t}</button>
          ))}
        </div>
      </div>
      {vista === 'mensajes'
        ? <Conversaciones msgs={filtrados.filter((m) => m.clase === 'mensaje')} clientes={d.clientes} abrirFicha={setFicha} onCambio={cargar} />
        : <Comentarios msgs={filtrados.filter((m) => m.clase === 'comentario')} clientes={d.clientes} abrirFicha={setFicha} onCambio={cargar} />}
      {ficha && <FichaCliente id={ficha} onClose={() => { setFicha(null); cargar() }} onCambio={cargar} />}
    </>
  )
}

function Conversaciones({ msgs, clientes, abrirFicha, onCambio }) {
  const [sel, setSel] = useState(null)
  const [err, setErr] = useState('')
  // Una conversación por persona y red; la más reciente arriba
  const hilos = useMemo(() => {
    const m = new Map()
    for (const x of msgs) {
      const k = x.plataforma + ':' + (x.cliente_id ? 'c' + x.cliente_id : 'u' + x.usuario_id)
      if (!m.has(k)) m.set(k, { k, plataforma: x.plataforma, cliente_id: x.cliente_id, ultimo: x, nombre: x.usuario_nombre, cuenta_id: x.cuenta_id, usuario_id: x.usuario_id, mensaje_id: x.id })
      else if (!m.get(k).nombre && x.usuario_nombre) m.get(k).nombre = x.usuario_nombre
    }
    return [...m.values()]
  }, [msgs])
  const cli = (id) => clientes.find((c) => c.id === id)
  const actual = hilos.find((h) => h.k === sel) || hilos[0]

  async function crear(h) {
    setErr('')
    try { const r = await redes({ accion: 'prospecto', mensaje_id: h.mensaje_id }); await onCambio(); abrirFicha(r.cliente_id) }
    catch (e) { setErr(e.message) }
  }

  if (!hilos.length) return <div className="card"><div className="cb vacio">Todavía no llegaron mensajes. Cuando alguien escriba a la página o a Instagram, aparece aquí.</div></div>
  const c = actual?.cliente_id ? cli(actual.cliente_id) : null
  return (
    <div className="red-bandeja">
      <div className="card red-lista">
        {hilos.map((h) => {
          const cc = h.cliente_id ? cli(h.cliente_id) : null
          return (
            <button key={h.k} className={'red-hilo' + (actual?.k === h.k ? ' on' : '')} onClick={() => setSel(h.k)}>
              <span className={'red-avatar ' + h.plataforma}>{(cc?.empresa || h.nombre || '?').slice(0, 1).toUpperCase()}</span>
              <span className="red-hilo-txt">
                <span className="red-hilo-cab"><b>{cc?.empresa || h.nombre || 'Sin nombre'}</b>{cc?.redes_no_leidos > 0 && <span className="crm-noleidos">{cc.redes_no_leidos}</span>}</span>
                <span className="crm-sub">{h.ultimo.direccion === 'saliente' ? 'Tú: ' : ''}{h.ultimo.texto || (h.ultimo.adjunto_tipo ? `[${h.ultimo.adjunto_tipo}]` : '')}</span>
                <span className="red-hilo-pie"><ChipRed p={h.plataforma} /><span className="crm-sub">{hora(h.ultimo.fecha)}</span></span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="card red-conv">
        <div className="ch">
          <h2>{c?.empresa || actual?.nombre || 'Conversación'}</h2>
          {c ? <button className="btn chico" onClick={() => abrirFicha(c.id)}>Abrir ficha</button>
            : <button className="btn chico primario" onClick={() => crear(actual)}>Crear prospecto</button>}
        </div>
        <div className="cb">
          <Error msg={err} />
          {c ? <ChatRedes key={actual.k} c={c} plataforma={actual.plataforma} onLeido={onCambio} />
            : <div className="nota">Esta conversación todavía no está asignada a un cliente. Créalo como prospecto para responder y darle seguimiento.</div>}
        </div>
      </div>
    </div>
  )
}

function Comentarios({ msgs, clientes, abrirFicha, onCambio }) {
  const [solo, setSolo] = useState(true)
  const [trayendo, setTrayendo] = useState(false)
  const [aviso, setAviso] = useState('')
  const [err, setErr] = useState('')
  const entrantes = msgs.filter((m) => m.direccion === 'entrante' && (!solo || !m.respondido))
  const respuestas = (mid) => msgs.filter((m) => m.responde_a === mid && m.direccion === 'saliente').reverse()
  async function traer() {
    setErr(''); setAviso(''); setTrayendo(true)
    try {
      const r = await redes({ accion: 'importar' })
      setAviso(r.nuevos ? `Se trajeron ${r.nuevos} ${r.nuevos === 1 ? 'comentario nuevo' : 'comentarios nuevos'} de las últimas publicaciones.` : 'No hay comentarios nuevos en las últimas publicaciones.')
      if (r.errores?.length) setErr(r.errores.join(' '))
      await onCambio()
    } catch (e) { setErr(e.message) } finally { setTrayendo(false) }
  }
  return (
    <>
      <div className="red-com-barra">
        <label className="check"><input type="checkbox" checked={solo} onChange={(e) => setSolo(e.target.checked)} /> Solo los que faltan responder</label>
        <button className="btn chico" disabled={trayendo} onClick={traer}>{trayendo ? 'Buscando…' : 'Traer comentarios recientes'}</button>
      </div>
      <Error msg={err} />
      {aviso && <div className="ok">{aviso}</div>}
      <div className="red-comentarios">
        {entrantes.map((m) => <Comentario key={m.id} m={m} resp={respuestas(m.mid)} cliente={clientes.find((c) => c.id === m.cliente_id)} abrirFicha={abrirFicha} onCambio={onCambio} />)}
        {!entrantes.length && <div className="card"><div className="cb vacio">{solo ? 'No hay comentarios pendientes de respuesta.' : 'Todavía no llegaron comentarios.'}</div></div>}
      </div>
    </>
  )
}

function Comentario({ m, resp, cliente, abrirFicha, onCambio }) {
  const [texto, setTexto] = useState('')
  const [err, setErr] = useState('')
  const [enviando, setEnviando] = useState('')
  const viejo = Date.now() - new Date(m.fecha) > 7 * VEINTICUATRO

  async function hacer(accion) {
    setErr(''); setEnviando(accion)
    try {
      const r = await redes({ accion, mensaje_id: m.id, texto })
      if (accion === 'prospecto') { await onCambio(); abrirFicha(r.cliente_id); return }
      setTexto(''); onCambio()
    } catch (e) { setErr(e.message) } finally { setEnviando('') }
  }

  return (
    <div className={'card red-coment' + (m.respondido ? ' hecho' : '')}>
      <div className="cb">
        <div className="red-coment-cab">
          <span className={'red-avatar ' + m.plataforma}>{(m.usuario_nombre || '?').replace('@', '').slice(0, 1).toUpperCase()}</span>
          <div>
            <div className="red-coment-nom"><b>{m.usuario_nombre || 'Sin nombre'}</b> <ChipRed p={m.plataforma} /></div>
            <div className="crm-sub">{hora(m.fecha)}{m.respondido ? ' · respondido' : ''}
              {m.publicacion_url && <> · <a className="red-pub" href={m.publicacion_url} target="_blank" rel="noopener">Ver publicación ↗</a></>}</div>
          </div>
          {cliente ? <button className="btn chico" onClick={() => abrirFicha(cliente.id)}>{cliente.empresa}</button>
            : <button className="btn chico" disabled={!!enviando} onClick={() => hacer('prospecto')}>Crear prospecto</button>}
        </div>
        <p className="red-coment-txt">{m.texto || '[sin texto]'}</p>
        {m.adjunto_url && <a href={m.adjunto_url} target="_blank" rel="noopener"><img className="red-img" src={m.adjunto_url} alt="Imagen del comentario" /></a>}
        {resp.map((r) => (
          <div key={r.id} className="red-resp"><b>{r.clase === 'mensaje' ? 'Mensaje privado' : 'Respuesta'}:</b> {r.texto}<span className="crm-sub"> · {hora(r.fecha)}</span></div>
        ))}
        <Error msg={err} />
        <div className="red-responder">
          <input type="text" value={texto} placeholder="Escribe la respuesta" onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && texto.trim() && hacer('comentario')} />
          <button className="btn chico" disabled={!texto.trim() || !!enviando} onClick={() => hacer('comentario')}>{enviando === 'comentario' ? 'Enviando…' : 'Responder en público'}</button>
          <button className="btn chico primario" disabled={!texto.trim() || !!enviando || viejo} title={viejo ? 'Meta permite el mensaje privado solo hasta 7 días después del comentario' : ''} onClick={() => hacer('privado')}>{enviando === 'privado' ? 'Enviando…' : 'Mensaje privado'}</button>
        </div>
      </div>
    </div>
  )
}
