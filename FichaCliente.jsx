import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { Campo, Cargando, Error, Modal, useApp } from './ui'
import { bs, bs0, fdate } from './lib'
import { ETAPAS, ICONO_ACT, ORIGENES, RUBROS, TIPOS_ACT, cambiarEtapa, masDiasISO, registrarActividad, valorMensual, whatsapp } from './crmLib'
import { VenderModal } from './ListaCotizaciones'

const hora = (iso) => new Date(iso).toLocaleString('es-BO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function FichaCliente({ id, onClose, onCambio }) {
  const { perfil, configCot, abrirCotizacion, ir } = useApp()
  const [d, setD] = useState(null)
  const [pestana, setPestana] = useState('historial')
  const [editar, setEditar] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [perder, setPerder] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [vender, setVender] = useState(null)

  const cargar = useCallback(async () => {
    const [c, a, s, q, p] = await Promise.all([
      supabase.from('clientes').select('*').eq('id', id).single(),
      supabase.from('actividades').select('*').eq('cliente_id', id).order('fecha', { ascending: false }),
      supabase.from('seguimientos').select('*').eq('cliente_id', id).eq('hecho', false).order('fecha'),
      supabase.from('cotizaciones').select('*').eq('cliente_id', id).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, nombre'),
    ])
    if (c.error) return setErr(c.error.message)
    setD({ c: c.data, acts: a.data || [], segs: s.data || [], cots: q.data || [], perfiles: p.data || [] })
  }, [id])
  useEffect(() => { cargar() }, [cargar])

  if (!d) return <Modal titulo="Cliente" onClose={onClose} ancho><Cargando /></Modal>
  const { c } = d
  const cerrado = c.etapa === 'Ganado' || c.etapa === 'Perdido'
  const nombre = (uid) => d.perfiles.find((p) => p.id === uid)?.nombre || ''
  const refrescar = async () => { await cargar(); onCambio?.() }

  async function mover(etapa) {
    setErr(''); setOk('')
    if (etapa === c.etapa) return
    if (etapa === 'Ganado') return ganar()
    try { await cambiarEtapa(c, etapa); refrescar() } catch (e) { setErr(e.message) }
  }
  async function ganar() {
    const abierta = d.cots.find((q) => q.estado === 'Enviada')
    if (abierta) { setVender(abierta); return }
    try {
      await cambiarEtapa(c, 'Ganado')
      setOk('Cliente marcado como ganado. Para que la venta llegue a Comisiones, crea su cotización y márcala como vendida, o regístrala en Comisiones › Ventas.')
      refrescar()
    } catch (e) { setErr(e.message) }
  }
  async function confirmarPerdido() {
    try {
      await cambiarEtapa(c, 'Perdido', { motivo_perdida: motivo.trim() || null })
      await supabase.from('seguimientos').update({ hecho: true, hecho_at: new Date().toISOString() }).eq('cliente_id', c.id).eq('hecho', false)
      setPerder(false); refrescar()
    } catch (e) { setErr(e.message) }
  }
  async function reabrir() {
    try { await cambiarEtapa(c, 'Contactado', { motivo_perdida: null }); refrescar() } catch (e) { setErr(e.message) }
  }
  function cotizar() {
    onClose()
    abrirCotizacion({
      prefill: { cliente: c.empresa, atencion: c.contacto && c.contacto !== c.empresa ? c.contacto : '', telefono: c.telefono || '', email: c.email || '', tipo: c.tipo, unidades: c.flota },
      cliente_id: c.id,
    })
  }

  return (
    <Modal titulo={c.empresa} onClose={onClose} ancho className="crm-modal"
      pie={<>
        {!cerrado && <button className="btn peligro izq" onClick={() => setPerder(true)}>Marcar perdido</button>}
        {c.etapa === 'Perdido' && <button className="btn izq" onClick={reabrir}>Reabrir oportunidad</button>}
        {c.etapa === 'Ganado' && <button className="btn izq" onClick={() => { onClose(); ir('ventas') }}>Ver en Comisiones</button>}
        <button className="btn" onClick={onClose}>Cerrar</button>
        {c.etapa !== 'Perdido' && <button className="btn oscuro" onClick={cotizar}>Crear cotización</button>}
        {!cerrado && <button className="btn primario" onClick={ganar}>Marcar ganado</button>}
      </>}>
      <div className="crm-etapas">
        {ETAPAS.map((e, i) => (
          <button key={e} disabled={cerrado && e !== c.etapa} className={(e === c.etapa ? 'on ' : '') + (ETAPAS.indexOf(c.etapa) > i ? 'paso' : '')} onClick={() => mover(e)}>{e}</button>
        ))}
      </div>
      <Error msg={err} />
      {ok && <div className="ok">{ok}</div>}
      {c.etapa === 'Perdido' && <div className="error">Perdido{c.motivo_perdida ? `: ${c.motivo_perdida}` : ''}</div>}
      {perder && (
        <div className="nota crm-perder">
          <Campo label="¿Por qué se perdió?"><input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: eligió a la competencia por precio" autoFocus /></Campo>
          <button className="btn" onClick={() => setPerder(false)}>Cancelar</button>
          <button className="btn peligro" onClick={confirmarPerdido}>Confirmar</button>
        </div>
      )}

      <div className="crm-ficha">
        <div className="crm-datos">
          {editar
            ? <EditarCliente c={c} onCancel={() => setEditar(false)} onSaved={() => { setEditar(false); refrescar() }} />
            : <>
              <dl>
                <dt>Contacto</dt><dd>{c.contacto || '—'}{c.cargo && <span className="sub">{c.cargo}</span>}</dd>
                <dt>WhatsApp</dt><dd>{c.telefono || '—'}</dd>
                <dt>Correo</dt><dd>{c.email || '—'}</dd>
                <dt>Tipo</dt><dd>{c.tipo === 'empresa' ? 'Empresa' : 'Personal'}{c.rubro ? ` · ${c.rubro}` : ''}</dd>
                <dt>Flota</dt><dd>{c.flota} {c.flota === 1 ? 'vehículo' : 'vehículos'} · {bs0(valorMensual(c, configCot))}/mes estimado</dd>
                <dt>Origen</dt><dd>{c.origen || '—'}</dd>
                {perfil.rol === 'admin' && <><dt>Vendedor</dt><dd>{nombre(c.vendedor_id)}</dd></>}
                <dt>Desde</dt><dd>{fdate(c.created_at)}</dd>
                {c.notas && <><dt>Notas</dt><dd>{c.notas}</dd></>}
              </dl>
              <button className="btn chico" style={{ marginTop: 10 }} onClick={() => setEditar(true)}>Editar datos</button>
            </>}

          {!cerrado && <Seguimientos c={c} segs={d.segs} onCambio={refrescar} />}

          {d.cots.length > 0 && <>
            <h4>Cotizaciones</h4>
            <div className="crm-cots">
              {d.cots.map((q) => (
                <button key={q.id} className="crm-cot" onClick={() => { onClose(); abrirCotizacion(q) }}>
                  <span><b>{q.numero}</b><span className="crm-sub">{fdate(q.fecha)} · {q.unidades} veh. · {bs(q.total_mensual)}/mes</span></span>
                  <span className={'chip ' + ({ Enviada: 'azul', Vendida: 'verde', Perdida: 'gris' }[q.estado])}>{q.estado}</span>
                </button>
              ))}
            </div>
          </>}
        </div>

        <div className="crm-historial">
          <div className="crm-pestanas" role="tablist">
            <button role="tab" aria-selected={pestana === 'historial'} className={pestana === 'historial' ? 'on' : ''} onClick={() => setPestana('historial')}>Historial</button>
            <button role="tab" aria-selected={pestana === 'whatsapp'} className={pestana === 'whatsapp' ? 'on' : ''} onClick={() => setPestana('whatsapp')}>
              WhatsApp{c.wa_no_leidos > 0 && <span className="crm-noleidos">{c.wa_no_leidos}</span>}
            </button>
          </div>
          {pestana === 'historial'
            ? <Historial c={c} acts={d.acts} nombre={nombre} onCambio={refrescar} />
            : <Conversacion c={c} onLeido={refrescar} />}
        </div>
      </div>

      {vender && <VenderModal c={vender} onClose={() => setVender(null)}
        onDone={(n) => { setVender(null); setOk(`Listo: se crearon ${n} ${n === 1 ? 'venta' : 'ventas'} en Comisiones y el cliente quedó como ganado.`); refrescar() }} />}
    </Modal>
  )
}

function Seguimientos({ c, segs, onCambio }) {
  const [fecha, setFecha] = useState(masDiasISO(3))
  const [texto, setTexto] = useState('')
  async function agendar() {
    if (!texto.trim()) return
    await supabase.from('seguimientos').insert({ cliente_id: c.id, fecha, texto: texto.trim() })
    setTexto(''); onCambio()
  }
  async function hecho(s) {
    await supabase.from('seguimientos').update({ hecho: true, hecho_at: new Date().toISOString() }).eq('id', s.id)
    await registrarActividad(c.id, 'nota', `Seguimiento hecho: ${s.texto}.`)
    onCambio()
  }
  return <>
    <h4>Próximos seguimientos</h4>
    {segs.map((s) => (
      <label key={s.id} className="crm-tarea"><input type="checkbox" onChange={() => hecho(s)} /><span><b>{fdate(s.fecha)}</b> · {s.texto}</span></label>
    ))}
    {!segs.length && <div className="crm-sub">Sin seguimientos. Agenda uno para no perder al cliente.</div>}
    <div className="crm-programar">
      <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha del seguimiento" />
      <input type="text" value={texto} placeholder="Qué hay que hacer" onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && agendar()} />
      <button className="btn chico" onClick={agendar}>Agendar</button>
    </div>
  </>
}

function Historial({ c, acts, nombre, onCambio }) {
  const [tipo, setTipo] = useState('llamada')
  const [texto, setTexto] = useState('')
  async function registrar() {
    if (!texto.trim()) return
    await registrarActividad(c.id, tipo, texto.trim())
    if (c.etapa === 'Prospecto' && ['llamada', 'whatsapp', 'visita', 'correo'].includes(tipo)) await cambiarEtapa(c, 'Contactado')
    setTexto(''); onCambio()
  }
  return <>
    <div className="crm-registrar">
      <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de actividad">
        {['llamada', 'whatsapp', 'visita', 'correo', 'nota'].map((k) => <option key={k} value={k}>{TIPOS_ACT[k]}</option>)}
      </select>
      <input type="text" value={texto} placeholder="¿Qué pasó? Ej.: pidió la cotización con roaming" onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && registrar()} />
      <button className="btn chico primario" onClick={registrar}>Registrar</button>
    </div>
    <ol className="crm-linea">
      {acts.map((a) => (
        <li key={a.id} className={'t-' + a.tipo}>
          <span className="crm-ico" aria-hidden="true">{ICONO_ACT[a.tipo]}</span>
          <div><b>{TIPOS_ACT[a.tipo]}</b> · <span className="crm-sub-in">{hora(a.fecha)}{nombre(a.vendedor_id) ? ` · ${nombre(a.vendedor_id)}` : ''}</span><p>{a.texto}</p></div>
        </li>
      ))}
      {!acts.length && <li className="crm-sub">Todavía no hay actividad registrada.</li>}
    </ol>
  </>
}

// ---------- Conversación de WhatsApp en vivo
function Conversacion({ c, onLeido }) {
  const [msgs, setMsgs] = useState(null)
  const [estado, setEstado] = useState(null)
  const [texto, setTexto] = useState('')
  const [err, setErr] = useState('')
  const [enviando, setEnviando] = useState(false)
  const fin = useRef(null)

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('wa_mensajes').select('*').eq('cliente_id', c.id).order('fecha')
    setMsgs(data || [])
  }, [c.id])

  useEffect(() => {
    cargar()
    whatsapp({ accion: 'estado', cliente_id: c.id }).then(setEstado).catch(() => setEstado({ conectado: false }))
    if (c.wa_no_leidos > 0) supabase.from('clientes').update({ wa_no_leidos: 0 }).eq('id', c.id).then(() => onLeido?.())
    const canal = supabase.channel('wa-' + c.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_mensajes', filter: `cliente_id=eq.${c.id}` }, () => cargar())
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [c.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }) }, [msgs])

  async function enviar(accion) {
    setErr(''); setEnviando(true)
    try {
      await whatsapp(accion === 'plantilla' ? { accion, cliente_id: c.id } : { accion: 'enviar', cliente_id: c.id, texto })
      if (accion !== 'plantilla') setTexto('')
      cargar()
      whatsapp({ accion: 'estado', cliente_id: c.id }).then(setEstado).catch(() => {})
    } catch (e) { setErr(e.message) } finally { setEnviando(false) }
  }
  async function verArchivo(m) {
    try {
      const blob = await whatsapp({ accion: 'media', mensaje_id: m.id })
      window.open(URL.createObjectURL(blob), '_blank', 'noopener')
    } catch (e) { setErr(e.message) }
  }

  if (!msgs) return <Cargando />
  const ORIGEN = { crm: 'desde la plataforma', celular: 'desde el celular', historial: 'historial' }
  return (
    <div className="wa">
      <div className="wa-chat">
        {msgs.map((m, i) => {
          const dia = new Date(m.fecha).toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' })
          const diaAnt = i ? new Date(msgs[i - 1].fecha).toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' }) : ''
          return (
            <div key={m.id} className="wa-fila-wrap">
              {dia !== diaAnt && <div className="wa-dia">{dia}</div>}
              <div className={'wa-burbuja ' + (m.direccion === 'saliente' ? 'sale' : 'entra')}>
                {m.media_id && <button className="wa-archivo" onClick={() => verArchivo(m)}>{m.tipo === 'image' ? 'Ver imagen' : m.tipo === 'audio' ? 'Escuchar audio' : m.tipo === 'video' ? 'Ver video' : `📄 ${m.archivo_nombre || 'Ver archivo'}`}</button>}
                {m.texto && <p>{m.texto}</p>}
                {!m.texto && !m.media_id && <p className="wa-tipo">[{m.tipo}]</p>}
                <span className="wa-meta">{new Date(m.fecha).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                  {m.direccion === 'saliente' && ` · ${ORIGEN[m.origen] || ''}${m.estado ? ' · ' + ({ enviado: '✓', entregado: '✓✓', leido: '✓✓ leído', fallido: 'no enviado' }[m.estado] || m.estado) : ''}`}
                </span>
                {m.error && <span className="wa-error">{m.error}</span>}
              </div>
            </div>
          )
        })}
        {!msgs.length && <div className="vacio">{c.telefono ? 'Todavía no hay mensajes con este cliente.' : 'Carga el número de WhatsApp del cliente para ver y enviar mensajes.'}</div>}
        <div ref={fin} />
      </div>
      <Error msg={err} />
      {estado && !estado.conectado && <div className="nota">Tu usuario todavía no tiene un número de WhatsApp conectado. Los mensajes aparecerán aquí cuando el administrador lo conecte.</div>}
      {estado?.conectado && (estado.ventana_abierta
        ? <div className="wa-escribir">
            <textarea rows="2" value={texto} placeholder="Escribe un mensaje" onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && texto.trim()) { e.preventDefault(); enviar('texto') } }} />
            <button className="btn whatsapp" disabled={enviando || !texto.trim()} onClick={() => enviar('texto')}>{enviando ? 'Enviando…' : 'Enviar'}</button>
          </div>
        : <div className="wa-cerrada">
            <span>Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite escribirle con una plantilla aprobada.</span>
            <button className="btn whatsapp" disabled={enviando} onClick={() => enviar('plantilla')}>{enviando ? 'Enviando…' : 'Enviar seguimiento'}</button>
          </div>)}
    </div>
  )
}

function EditarCliente({ c, onCancel, onSaved }) {
  const [f, setF] = useState({ empresa: c.empresa, contacto: c.contacto || '', cargo: c.cargo || '', telefono: c.telefono || '', email: c.email || '', tipo: c.tipo, flota: c.flota, rubro: c.rubro || '', origen: c.origen || '', notas: c.notas || '' })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function guardar() {
    if (!f.empresa.trim()) return setErr('El nombre es obligatorio.')
    const { error } = await supabase.from('clientes').update({ ...f, empresa: f.empresa.trim(), flota: Math.max(1, Number(f.flota) || 1) }).eq('id', c.id)
    error ? setErr(error.message) : onSaved()
  }
  return (
    <div className="form">
      <Error msg={err} />
      <Campo label="Empresa o nombre" full><input type="text" value={f.empresa} onChange={set('empresa')} /></Campo>
      <Campo label="Contacto"><input type="text" value={f.contacto} onChange={set('contacto')} /></Campo>
      <Campo label="Cargo"><input type="text" value={f.cargo} onChange={set('cargo')} /></Campo>
      <Campo label="WhatsApp"><input type="text" value={f.telefono} onChange={set('telefono')} /></Campo>
      <Campo label="Correo"><input type="email" value={f.email} onChange={set('email')} /></Campo>
      <Campo label="Tipo"><select value={f.tipo} onChange={set('tipo')}><option value="empresa">Empresa</option><option value="personal">Personal</option></select></Campo>
      <Campo label="Vehículos"><input type="number" min="1" value={f.flota} onChange={set('flota')} /></Campo>
      <Campo label="Rubro"><select value={f.rubro} onChange={set('rubro')}><option value="">—</option>{RUBROS.map((r) => <option key={r}>{r}</option>)}</select></Campo>
      <Campo label="Origen"><select value={f.origen} onChange={set('origen')}><option value="">—</option>{ORIGENES.map((r) => <option key={r}>{r}</option>)}</select></Campo>
      <Campo label="Notas" full><textarea rows="2" value={f.notas} onChange={set('notas')} /></Campo>
      <div className="full" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>Cancelar</button>
        <button className="btn primario" onClick={guardar}>Guardar</button>
      </div>
    </div>
  )
}

export function NuevoCliente({ onClose, onCreado }) {
  const { perfil } = useApp()
  const [vendedores, setVendedores] = useState([])
  const [f, setF] = useState({ empresa: '', contacto: '', cargo: '', telefono: '', email: '', rubro: RUBROS[0], tipo: 'empresa', flota: 1, origen: ORIGENES[0], vendedor_id: perfil.id, notas: '' })
  const [err, setErr] = useState('')
  const [guardando, setGuardando] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  useEffect(() => {
    if (perfil.rol === 'admin') supabase.from('profiles').select('id, nombre, activo').eq('activo', true).order('nombre').then(({ data }) => setVendedores(data || []))
  }, [perfil.rol])
  async function guardar() {
    setErr('')
    if (!f.empresa.trim()) return setErr('Escribe la empresa o el nombre del cliente.')
    setGuardando(true)
    const fila = { ...f, empresa: f.empresa.trim(), contacto: f.contacto.trim() || f.empresa.trim(), flota: Math.max(1, Number(f.flota) || 1), etapa: 'Prospecto' }
    const { data, error } = await supabase.from('clientes').insert(fila).select('id').single()
    if (error) { setGuardando(false); return setErr(error.message) }
    await supabase.from('actividades').insert({ cliente_id: data.id, tipo: 'nota', texto: 'Prospecto creado.' })
    await supabase.from('seguimientos').insert({ cliente_id: data.id, fecha: masDiasISO(1), texto: 'Primer contacto', automatico: true })
    setGuardando(false)
    onCreado(data.id)
  }
  return (
    <Modal titulo="Nuevo prospecto" onClose={onClose}
      pie={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primario" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar'}</button></>}>
      <Error msg={err} />
      <div className="form">
        <Campo label="Empresa o nombre *" full><input type="text" value={f.empresa} onChange={set('empresa')} autoFocus /></Campo>
        <Campo label="Persona de contacto"><input type="text" value={f.contacto} onChange={set('contacto')} /></Campo>
        <Campo label="Cargo"><input type="text" value={f.cargo} onChange={set('cargo')} /></Campo>
        <Campo label="WhatsApp" ayuda="8 dígitos; se agrega el 591"><input type="text" inputMode="tel" value={f.telefono} onChange={set('telefono')} /></Campo>
        <Campo label="Correo"><input type="email" value={f.email} onChange={set('email')} /></Campo>
        <Campo label="Tipo"><select value={f.tipo} onChange={set('tipo')}><option value="empresa">Empresa</option><option value="personal">Personal</option></select></Campo>
        <Campo label="Vehículos (aprox.)"><input type="number" min="1" value={f.flota} onChange={set('flota')} /></Campo>
        <Campo label="Rubro"><select value={f.rubro} onChange={set('rubro')}>{RUBROS.map((r) => <option key={r}>{r}</option>)}</select></Campo>
        <Campo label="¿Cómo llegó?"><select value={f.origen} onChange={set('origen')}>{ORIGENES.map((r) => <option key={r}>{r}</option>)}</select></Campo>
        {perfil.rol === 'admin' && <Campo label="Vendedor" full><select value={f.vendedor_id} onChange={set('vendedor_id')}>{vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}</select></Campo>}
        <Campo label="Notas" full><textarea rows="2" value={f.notas} onChange={set('notas')} /></Campo>
      </div>
    </Modal>
  )
}
