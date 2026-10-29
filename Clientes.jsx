import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { Cabecera, Cargando, Error, Kpi, useApp } from './ui'
import { bs0, fdate, hoyISO } from './lib'
import { CHIP_ETAPA, ETAPAS, cambiarEtapa, estadoSeg, guardarFiltroEtiquetas, leerFiltroEtiquetas, masDiasISO, pasaFiltroEtiquetas, valorMensual } from './crmLib'
import { EtiquetasCliente, FiltroEtiquetas } from './Etiquetas'
import FichaCliente, { NuevoCliente } from './FichaCliente'

// Datos comunes del módulo: clientes visibles para el usuario y sus seguimientos pendientes
function useCrm() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const cargar = useCallback(async () => {
    const [c, s, p] = await Promise.all([
      supabase.from('clientes').select('*').order('updated_at', { ascending: false }),
      supabase.from('seguimientos').select('*').eq('hecho', false).order('fecha'),
      supabase.from('profiles').select('id, nombre, rol, activo').order('nombre'),
    ])
    if (c.error) setErr(c.error.message)
    setD({ clientes: c.data || [], segs: s.data || [], perfiles: p.data || [] })
  }, [])
  useEffect(() => { cargar() }, [cargar])
  return { d, err, cargar }
}

// Filtro por etiquetas compartido entre Embudo, Seguimientos y la lista
function useFiltroEtiquetas() {
  const { etiquetasTodas } = useApp()
  const [sel, setSelIn] = useState(leerFiltroEtiquetas)
  const setSel = (v) => { setSelIn(v); guardarFiltroEtiquetas(v) }
  const valido = sel.filter((id) => etiquetasTodas.some((e) => e.id === id))
  return { sel: valido, setSel, pasa: (c) => pasaFiltroEtiquetas(c, valido, etiquetasTodas) }
}

function FiltroVendedor({ perfiles, vend, setVend }) {
  const { perfil } = useApp()
  if (perfil.rol !== 'admin') return null
  return (
    <select value={vend} onChange={(e) => setVend(e.target.value)} style={{ width: 'auto' }}>
      <option value="todos">Todos los vendedores</option>
      {perfiles.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
    </select>
  )
}

export function ChipSeguimiento({ s }) {
  if (!s) return <span className="crm-prox sin">Sin seguimiento</span>
  const e = estadoSeg(s.fecha)
  return <span className={'crm-prox ' + (e === 'proximo' ? '' : e)}>{e === 'vencido' ? `Vencido ${fdate(s.fecha)}` : e === 'hoy' ? 'Hoy' : fdate(s.fecha)} · {s.texto}</span>
}

function usarModales(cargar) {
  const [ficha, setFicha] = useState(null)
  const [nuevo, setNuevo] = useState(false)
  const modales = <>
    {ficha && <FichaCliente id={ficha} onClose={() => { setFicha(null); cargar() }} onCambio={cargar} />}
    {nuevo && <NuevoCliente onClose={() => setNuevo(false)} onCreado={(id) => { setNuevo(false); cargar(); setFicha(id) }} />}
  </>
  return { abrir: setFicha, nuevo: () => setNuevo(true), modales }
}

// ---------- Embudo
export function Embudo() {
  const { configCot } = useApp()
  const { d, err, cargar } = useCrm()
  const filtro = useFiltroEtiquetas()
  const [vend, setVend] = useState('todos')
  const [arrastrando, setArrastrando] = useState(null)
  const [aviso, setAviso] = useState('')
  const { abrir, nuevo, modales } = usarModales(cargar)
  if (!d) return <Cargando />
  const delVendedor = d.clientes.filter((c) => vend === 'todos' || c.vendedor_id === vend)
  const clientes = delVendedor.filter(filtro.pasa)
  const proximo = (id) => d.segs.find((s) => s.cliente_id === id)
  const abiertos = clientes.filter((c) => !['Ganado', 'Perdido'].includes(c.etapa))
  const nombre = (id) => d.perfiles.find((p) => p.id === id)?.nombre || ''

  async function soltar(etapa) {
    const c = arrastrando
    setArrastrando(null)
    if (!c || c.etapa === etapa) return
    if (etapa === 'Ganado' || etapa === 'Perdido') { setAviso('Para marcar Ganado o Perdido abre la ficha del cliente: ahí se pasa a Comisiones o se anota el motivo.'); abrir(c.id); return }
    try { await cambiarEtapa(c, etapa); cargar() } catch (e) { setAviso(e.message) }
  }

  return (
    <>
      <Cabecera titulo="Embudo de ventas" sub={`${abiertos.length} oportunidades abiertas · ${bs0(abiertos.reduce((s, c) => s + valorMensual(c, configCot), 0))} al mes en juego · arrastra las tarjetas para cambiar de etapa`}>
        <FiltroVendedor perfiles={d.perfiles} vend={vend} setVend={setVend} />
        <button className="btn primario" onClick={nuevo}>+ Nuevo prospecto</button>
      </Cabecera>
      <Error msg={err} />
      <FiltroEtiquetas clientes={delVendedor} sel={filtro.sel} setSel={filtro.setSel} />
      {aviso && <div className="nota" style={{ marginBottom: 14 }}>{aviso}</div>}
      <div className="crm-tablero">
        {ETAPAS.map((e) => {
          const cs = clientes.filter((c) => c.etapa === e)
          return (
            <div key={e} className={'crm-col' + (e === 'Ganado' ? ' ganado' : '')} onDragOver={(ev) => ev.preventDefault()} onDrop={() => soltar(e)}>
              <div className="crm-col-cab"><b>{e}</b><span>{cs.length} · {bs0(cs.reduce((s, c) => s + valorMensual(c, configCot), 0))}/mes</span></div>
              {cs.map((c) => (
                <div key={c.id} className="crm-tarjeta" draggable onDragStart={() => setArrastrando(c)} onClick={() => abrir(c.id)} role="button" tabIndex={0}
                  onKeyDown={(ev) => ev.key === 'Enter' && abrir(c.id)}>
                  <div className="crm-tarjeta-cab"><b>{c.empresa}</b>{(c.wa_no_leidos || 0) + (c.redes_no_leidos || 0) > 0 && <span className="crm-noleidos" title="Mensajes sin leer (WhatsApp, Facebook e Instagram)">{(c.wa_no_leidos || 0) + (c.redes_no_leidos || 0)}</span>}</div>
                  <span className="crm-sub">{c.flota} {c.flota === 1 ? 'vehículo' : 'vehículos'} · {c.tipo === 'empresa' ? 'Empresa' : 'Personal'} · {bs0(valorMensual(c, configCot))}/mes</span>
                  <EtiquetasCliente ids={c.etiquetas} />
                  {vend === 'todos' && d.perfiles.length > 1 && <span className="crm-sub">{nombre(c.vendedor_id)}</span>}
                  {e !== 'Ganado' && <ChipSeguimiento s={proximo(c.id)} />}
                </div>
              ))}
              {!cs.length && <div className="crm-vacia">{d.clientes.length ? (filtro.sel.length ? 'Ninguno con estas etiquetas' : 'Arrastra aquí') : e === 'Prospecto' ? 'Agrega tu primer prospecto' : ''}</div>}
            </div>
          )
        })}
      </div>
      {clientes.some((c) => c.etapa === 'Perdido') && (
        <p className="crm-perdidos">Perdidos: {clientes.filter((c) => c.etapa === 'Perdido').map((c) => <button key={c.id} onClick={() => abrir(c.id)}>{c.empresa}</button>)}</p>
      )}
      {modales}
    </>
  )
}

// ---------- Seguimientos
export function Seguimientos() {
  const { d, err, cargar } = useCrm()
  const filtro = useFiltroEtiquetas()
  const [vend, setVend] = useState('todos')
  const { abrir, modales } = usarModales(cargar)
  if (!d) return <Cargando />
  const cli = (id) => d.clientes.find((c) => c.id === id)
  const delVendedor = d.clientes.filter((c) => vend === 'todos' || c.vendedor_id === vend)
  const pend = d.segs.filter((s) => cli(s.cliente_id) && (vend === 'todos' || cli(s.cliente_id).vendedor_id === vend) && filtro.pasa(cli(s.cliente_id)))
  const hoy = hoyISO()
  const grupos = [
    ['Vencidos', pend.filter((s) => s.fecha < hoy), 'rojo'],
    ['Hoy', pend.filter((s) => s.fecha === hoy), 'ambar'],
    ['Próximos días', pend.filter((s) => s.fecha > hoy), 'azul'],
  ]
  async function hecho(s) {
    await supabase.from('seguimientos').update({ hecho: true, hecho_at: new Date().toISOString() }).eq('id', s.id)
    await supabase.from('actividades').insert({ cliente_id: s.cliente_id, tipo: 'nota', texto: `Seguimiento hecho: ${s.texto}.` })
    cargar()
  }
  async function posponer(s) {
    await supabase.from('seguimientos').update({ fecha: masDiasISO(1) }).eq('id', s.id)
    cargar()
  }
  return (
    <>
      <Cabecera titulo="Seguimientos" sub="Lo que hay que hacer con cada cliente. Al enviar una cotización se agenda solo un seguimiento a 3 días.">
        <FiltroVendedor perfiles={d.perfiles} vend={vend} setVend={setVend} />
      </Cabecera>
      <FiltroEtiquetas clientes={delVendedor} sel={filtro.sel} setSel={filtro.setSel} />
      <Error msg={err} />
      <div className="grid crm-seg">
        {grupos.map(([t, xs, tono]) => (
          <div className="card" key={t}>
            <div className="ch"><h2>{t}</h2><span className={'chip ' + tono}>{xs.length}</span></div>
            <div className="crm-lista-seg">
              {xs.map((s) => {
                const c = cli(s.cliente_id)
                return (
                  <div key={s.id} className="crm-seg-fila">
                    <input type="checkbox" aria-label="Marcar como hecho" onChange={() => hecho(s)} />
                    <div className="crm-seg-txt" onClick={() => abrir(c.id)} role="button" tabIndex={0}>
                      <b>{s.texto}</b>
                      <span className="crm-sub">{c.empresa}{c.contacto && c.contacto !== c.empresa ? ` · ${c.contacto}` : ''}{c.telefono ? ` · ${c.telefono}` : ''}</span>
                      <span className="crm-sub">{fdate(s.fecha)}{s.automatico ? ' · automático' : ''}</span>
                    </div>
                    {t !== 'Próximos días' && <button className="btn chico" onClick={() => posponer(s)} title="Pasar a mañana">Mañana</button>}
                  </div>
                )
              })}
              {!xs.length && <div className="vacio">Nada pendiente.</div>}
            </div>
          </div>
        ))}
      </div>
      {modales}
    </>
  )
}

// ---------- Lista de clientes
export function ListaClientes() {
  const { configCot, perfil } = useApp()
  const { d, err, cargar } = useCrm()
  const [vend, setVend] = useState('todos')
  const [q, setQ] = useState('')
  const [etapa, setEtapa] = useState('todas')
  const filtro = useFiltroEtiquetas()
  const { abrir, nuevo, modales } = usarModales(cargar)
  const delVendedor = (d?.clientes || []).filter((c) => vend === 'todos' || c.vendedor_id === vend)
  const fil = useMemo(() => delVendedor.filter((c) => filtro.pasa(c) && (etapa === 'todas' || c.etapa === etapa) &&
    (!q || [c.empresa, c.contacto, c.telefono, c.rubro, c.email].join(' ').toLowerCase().includes(q.toLowerCase()))), [d, vend, etapa, q, filtro.sel]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Cargando />
  const proximo = (id) => d.segs.find((s) => s.cliente_id === id)
  const nombre = (id) => d.perfiles.find((p) => p.id === id)?.nombre || '—'
  const admin = perfil.rol === 'admin'
  return (
    <>
      <Cabecera titulo={admin ? 'Todos los clientes' : 'Mis clientes'} sub={`${fil.length} de ${d.clientes.length} clientes y prospectos`}>
        <FiltroVendedor perfiles={d.perfiles} vend={vend} setVend={setVend} />
        <button className="btn primario" onClick={nuevo}>+ Nuevo prospecto</button>
      </Cabecera>
      <Error msg={err} />
      <FiltroEtiquetas clientes={delVendedor} sel={filtro.sel} setSel={filtro.setSel} />
      <div className="card">
        <div className="filtros">
          <input type="text" placeholder="Buscar empresa, contacto, teléfono, correo o rubro" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={etapa} onChange={(e) => setEtapa(e.target.value)}>
            <option value="todas">Todas las etapas</option>{[...ETAPAS, 'Perdido'].map((e) => <option key={e}>{e}</option>)}
          </select>
        </div>
        <div className="tabla-wrap"><table>
          <thead><tr><th>Cliente</th><th>Rubro</th><th className="r">Flota</th><th className="r">Valor mensual</th><th>Etapa</th><th>Próximo paso</th>{admin && <th>Vendedor</th>}</tr></thead>
          <tbody>
            {fil.map((c) => (
              <tr key={c.id} className="click" onClick={() => abrir(c.id)}>
                <td><b>{c.empresa}</b>{(c.wa_no_leidos || 0) + (c.redes_no_leidos || 0) > 0 && <span className="crm-noleidos">{(c.wa_no_leidos || 0) + (c.redes_no_leidos || 0)}</span>}<span className="sub">{[c.contacto !== c.empresa ? c.contacto : null, c.telefono].filter(Boolean).join(' · ')}</span><EtiquetasCliente ids={c.etiquetas} /></td>
                <td>{c.rubro || '—'}<span className="sub">{c.origen}</span></td>
                <td className="r num">{c.flota}</td>
                <td className="r num">{bs0(valorMensual(c, configCot))}</td>
                <td><span className={'chip ' + CHIP_ETAPA[c.etapa]}>{c.etapa}</span></td>
                <td style={{ maxWidth: 280 }}>{['Ganado', 'Perdido'].includes(c.etapa) ? '—' : <ChipSeguimiento s={proximo(c.id)} />}</td>
                {admin && <td>{nombre(c.vendedor_id)}</td>}
              </tr>
            ))}
            {!fil.length && <tr><td colSpan={admin ? 7 : 6} className="vacio">{d.clientes.length ? 'Ningún cliente coincide con la búsqueda o las etiquetas.' : 'Todavía no hay clientes. Se agregan solos al enviar cotizaciones o al recibir un WhatsApp, o con “Nuevo prospecto”.'}</td></tr>}
          </tbody>
        </table></div>
      </div>
      {modales}
    </>
  )
}

// ---------- Panel del equipo (administrador)
export function PanelClientes() {
  const { configCot } = useApp()
  const { d, err } = useCrm()
  const [acts, setActs] = useState([])
  useEffect(() => {
    supabase.from('actividades').select('vendedor_id, fecha').gte('fecha', masDiasISO(-7)).then(({ data }) => setActs(data || []))
  }, [])
  if (!d) return <Cargando />
  const cs = d.clientes
  const abiertos = cs.filter((c) => !['Ganado', 'Perdido'].includes(c.etapa))
  const ganados = cs.filter((c) => c.etapa === 'Ganado')
  const cerrados = cs.filter((c) => ['Ganado', 'Perdido'].includes(c.etapa))
  const hoy = hoyISO()
  const vencidos = d.segs.filter((s) => s.fecha < hoy).length
  const maxEtapa = Math.max(...ETAPAS.map((e) => cs.filter((c) => c.etapa === e).length), 1)
  const vendedores = d.perfiles.filter((p) => p.activo)
  const porMotivo = Object.entries(cs.filter((c) => c.etapa === 'Perdido').reduce((m, c) => ({ ...m, [c.motivo_perdida || 'Sin motivo']: (m[c.motivo_perdida || 'Sin motivo'] || 0) + 1 }), {}))
  return (
    <>
      <Cabecera titulo="Panel del equipo" sub="Cómo viene el embudo y quién necesita ayuda" />
      <Error msg={err} />
      <div className="grid kpis">
        <Kpi l="Oportunidades abiertas" v={abiertos.length} s={`${bs0(abiertos.reduce((s, c) => s + valorMensual(c, configCot), 0))} al mes en juego`} />
        <Kpi l="Ganados" v={ganados.length} s={`${ganados.reduce((s, c) => s + c.flota, 0)} vehículos`} tono="bien" />
        <Kpi l="Tasa de cierre" v={cerrados.length ? Math.round((ganados.length / cerrados.length) * 100) + '%' : '—'} s="Ganados sobre cerrados" />
        <Kpi l="Seguimientos vencidos" v={vencidos} s="Clientes esperando respuesta" tono={vencidos ? 'alerta' : ''} />
      </div>
      <div className="grid dos">
        <div className="card">
          <div className="ch"><h2>Embudo por etapa</h2><span>cantidad y valor mensual</span></div>
          <div className="cb crm-barras">
            {ETAPAS.map((e) => {
              const xs = cs.filter((c) => c.etapa === e)
              return (
                <div key={e} className="crm-barra">
                  <span>{e}</span>
                  <div><i style={{ width: (xs.length / maxEtapa) * 100 + '%' }} /></div>
                  <b className="num">{xs.length} · {bs0(xs.reduce((s, c) => s + valorMensual(c, configCot), 0))}</b>
                </div>
              )
            })}
          </div>
        </div>
        <div className="card">
          <div className="ch"><h2>Por vendedor</h2></div>
          <div className="tabla-wrap"><table>
            <thead><tr><th>Vendedor</th><th className="r">Abiertas</th><th className="r">Ganados</th><th className="r">Vencidos</th><th className="r">Actividad 7 días</th></tr></thead>
            <tbody>{vendedores.map((v) => {
              const mios = cs.filter((c) => c.vendedor_id === v.id)
              const ids = new Set(mios.map((c) => c.id))
              return (
                <tr key={v.id}>
                  <td><b>{v.nombre}</b></td>
                  <td className="r num">{mios.filter((c) => !['Ganado', 'Perdido'].includes(c.etapa)).length}</td>
                  <td className="r num">{mios.filter((c) => c.etapa === 'Ganado').length}</td>
                  <td className="r num" style={{ color: 'var(--rojo-osc)' }}>{d.segs.filter((s) => ids.has(s.cliente_id) && s.fecha < hoy).length}</td>
                  <td className="r num">{acts.filter((a) => a.vendedor_id === v.id).length}</td>
                </tr>
              )
            })}</tbody>
          </table></div>
          {porMotivo.length > 0 && <div className="cb">
            <b style={{ fontSize: 13 }}>Por qué se pierden</b>
            <ul className="crm-motivos">{porMotivo.sort((a, b) => b[1] - a[1]).map(([m, n]) => <li key={m}><span>{m}</span><b>{n}</b></li>)}</ul>
          </div>}
        </div>
      </div>
    </>
  )
}
