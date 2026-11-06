import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { Cabecera, Cargando, Error } from './ui'
import FichaCliente from './FichaCliente'

// Conversaciones de WhatsApp de números que todavía no son clientes (sobre todo, el historial del celular).
// El vendedor revisa cada una y decide si la crea como prospecto o la descarta.
const TIPO = { image: 'Imagen', audio: 'Audio', video: 'Video', document: 'Archivo', sticker: 'Sticker', location: 'Ubicación', template: 'Plantilla' }
const telLindo = (t) => (t?.startsWith('591') && t.length === 11 ? `+591 ${t.slice(3, 6)} ${t.slice(6)}` : '+' + t)
const cuando = (iso) => {
  const d = new Date(iso), hoy = new Date()
  const mismoDia = d.toDateString() === hoy.toDateString()
  return mismoDia ? d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function SinAsignar() {
  const [lista, setLista] = useState(null)
  const [err, setErr] = useState('')
  const [buscar, setBuscar] = useState('')
  const [soloEscribieron, setSoloEscribieron] = useState(true)
  const [sel, setSel] = useState(null)
  const [ficha, setFicha] = useState(null)
  const [aviso, setAviso] = useState('')

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('wa_sin_asignar')
    if (error) setErr(error.message)
    setLista(data || [])
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const visibles = useMemo(() => {
    const t = buscar.trim().toLowerCase().replace(/\s+/g, '')
    return (lista || []).filter((c) => (!soloEscribieron || c.entrantes > 0)
      && (!t || c.telefono.includes(t.replace(/\D/g, '') || '~') || (c.ultimo_texto || '').toLowerCase().includes(buscar.trim().toLowerCase())))
  }, [lista, buscar, soloEscribieron])

  if (!lista) return <Cargando />
  const actual = visibles.find((c) => c.telefono === sel?.telefono && c.wa_numero_id === sel?.wa_numero_id) || visibles[0]

  function quitar(c, texto) {
    setLista((xs) => xs.filter((x) => !(x.telefono === c.telefono && x.wa_numero_id === c.wa_numero_id)))
    setSel(null); setAviso(texto)
  }

  return (
    <>
      <Cabecera titulo="WhatsApp sin asignar" sub="Conversaciones de números que todavía no son clientes. Crea el prospecto o descarta la conversación." />
      <Error msg={err} />
      {aviso && <div className="ok">{aviso}</div>}
      <div className="sa-barra">
        <input type="search" value={buscar} placeholder="Buscar por número o texto" aria-label="Buscar conversación" onChange={(e) => setBuscar(e.target.value)} />
        <label className="check"><input type="checkbox" checked={soloEscribieron} onChange={(e) => setSoloEscribieron(e.target.checked)} /> Solo los que escribieron</label>
        <span className="crm-sub">{visibles.length} {visibles.length === 1 ? 'conversación' : 'conversaciones'}</span>
      </div>
      {!visibles.length
        ? <div className="card"><div className="cb vacio">{lista.length ? 'Ninguna conversación coincide con la búsqueda.' : 'No hay conversaciones sin asignar. Todo lo que llega por WhatsApp ya está en la ficha de un cliente.'}</div></div>
        : (
          <div className="red-bandeja">
            <div className="card red-lista">
              {visibles.slice(0, 300).map((c) => (
                <button key={c.wa_numero_id + ':' + c.telefono} className={'red-hilo' + (actual === c ? ' on' : '')} onClick={() => { setSel(c); setAviso('') }}>
                  <span className="red-avatar sa-avatar">{c.entrantes > 0 ? '↘' : '↗'}</span>
                  <span className="red-hilo-txt">
                    <span className="red-hilo-cab"><b>{telLindo(c.telefono)}</b><span className="crm-sub">{cuando(c.ultima)}</span></span>
                    <span className="crm-sub">{c.ultima_direccion === 'saliente' ? 'Tú: ' : ''}{c.ultimo_texto || `[${TIPO[c.ultimo_tipo] || c.ultimo_tipo}]`}</span>
                    <span className="crm-sub">{c.mensajes} {c.mensajes === 1 ? 'mensaje' : 'mensajes'}{c.entrantes ? ` · ${c.entrantes} del contacto` : ' · solo enviados desde el celular'}</span>
                  </span>
                </button>
              ))}
              {visibles.length > 300 && <div className="cb crm-sub">Se muestran las 300 más recientes. Usa la búsqueda para encontrar otras.</div>}
            </div>
            {actual && <Detalle key={actual.wa_numero_id + ':' + actual.telefono} c={actual}
              onCreado={(id) => { quitar(actual, `Se creó el prospecto con el ${telLindo(actual.telefono)}.`); setFicha(id) }}
              onDescartado={() => quitar(actual, `Se descartó la conversación con el ${telLindo(actual.telefono)}.`)} />}
          </div>
        )}
      {ficha && <FichaCliente id={ficha} onClose={() => setFicha(null)} onCambio={() => {}} />}
    </>
  )
}

function Detalle({ c, onCreado, onDescartado }) {
  const [msgs, setMsgs] = useState(null)
  const [empresa, setEmpresa] = useState('')
  const [contacto, setContacto] = useState('')
  const [err, setErr] = useState('')
  const [trabajando, setTrabajando] = useState('')
  const fin = useRef(null)

  useEffect(() => {
    supabase.from('wa_mensajes').select('id, direccion, origen, tipo, texto, archivo_nombre, fecha')
      .eq('wa_numero_id', c.wa_numero_id).eq('telefono', c.telefono).is('cliente_id', null)
      .order('fecha', { ascending: false }).limit(200)
      .then(({ data, error }) => { if (error) setErr(error.message); setMsgs((data || []).reverse()) })
  }, [c.wa_numero_id, c.telefono])
  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }) }, [msgs])

  async function crear() {
    setErr(''); setTrabajando('crear')
    const { data, error } = await supabase.rpc('wa_crear_prospecto', { p_numero: c.wa_numero_id, p_tel: c.telefono, p_empresa: empresa, p_contacto: contacto })
    setTrabajando('')
    error ? setErr('No se pudo crear el prospecto: ' + error.message) : onCreado(data)
  }
  async function descartar() {
    setErr(''); setTrabajando('descartar')
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('wa_descartados').upsert({ wa_numero_id: c.wa_numero_id, telefono: c.telefono, descartado_por: user?.id })
    setTrabajando('')
    error ? setErr('No se pudo descartar: ' + error.message) : onDescartado()
  }

  return (
    <div className="card red-conv">
      <div className="ch"><h2>{telLindo(c.telefono)}</h2><span>{c.mensajes} mensajes</span></div>
      <div className="cb">
        {!msgs ? <Cargando /> : (
          <div className="wa-chat sa-chat">
            {msgs.map((m, i) => {
              const dia = new Date(m.fecha).toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' })
              const diaAnt = i ? new Date(msgs[i - 1].fecha).toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' }) : ''
              return (
                <div key={m.id} className="wa-fila-wrap">
                  {dia !== diaAnt && <div className="wa-dia">{dia}</div>}
                  <div className={'wa-burbuja ' + (m.direccion === 'saliente' ? 'sale' : 'entra')}>
                    {m.texto ? <p>{m.texto}</p> : <p className="wa-tipo">[{TIPO[m.tipo] || m.tipo}{m.archivo_nombre ? `: ${m.archivo_nombre}` : ''}]</p>}
                    <span className="wa-meta">{new Date(m.fecha).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              )
            })}
            {c.mensajes > 200 && <div className="crm-sub" style={{ textAlign: 'center' }}>Se muestran los últimos 200 mensajes. Al crear el prospecto pasan todos a su ficha.</div>}
            <div ref={fin} />
          </div>
        )}
        <Error msg={err} />
        <div className="sa-form">
          <input type="text" value={empresa} placeholder="Empresa o nombre del cliente" aria-label="Empresa o nombre del cliente" onChange={(e) => setEmpresa(e.target.value)} />
          <input type="text" value={contacto} placeholder="Persona de contacto (opcional)" aria-label="Persona de contacto" onChange={(e) => setContacto(e.target.value)} />
          <button className="btn" disabled={!!trabajando} onClick={descartar}>{trabajando === 'descartar' ? 'Descartando…' : 'Descartar'}</button>
          <button className="btn primario" disabled={!!trabajando} onClick={crear}>{trabajando === 'crear' ? 'Creando…' : 'Crear prospecto'}</button>
        </div>
        <p className="crm-sub" style={{ margin: '8px 0 0' }}>Al crearlo queda como prospecto tuyo con toda esta conversación en su ficha. “Descartar” la oculta de esta lista (por ejemplo, chats personales o proveedores).</p>
      </div>
    </div>
  )
}
