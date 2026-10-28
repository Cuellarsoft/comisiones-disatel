import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { Cabecera, Cargando, Campo, Error, Kpi, Modal, useApp } from './ui'
import { bs, bs0, fdate, hoyISO, mesLabel, ultimosMeses } from './lib'
import { cotizar } from './tarifas'

const CHIP = { Enviada: 'azul', Vendida: 'verde', Perdida: 'gris' }

export default function ListaCotizaciones() {
  const { perfil, abrirCotizacion } = useApp()
  const admin = perfil.rol === 'admin'
  const [d, setD] = useState(null)
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState('todas')
  const [vend, setVend] = useState('todos')
  const [mes, setMes] = useState('todos')
  const [vender, setVender] = useState(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  async function cargar() {
    const [c, p] = await Promise.all([
      supabase.from('cotizaciones').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, nombre').order('nombre'),
    ])
    if (c.error) setErr(c.error.message)
    setD({ cots: c.data || [], perfiles: p.data || [] })
  }
  useEffect(() => { cargar() }, [])

  const filtradas = useMemo(() => {
    if (!d) return []
    const t = q.trim().toLowerCase()
    return d.cots.filter((c) =>
      (estado === 'todas' || c.estado === estado) &&
      (vend === 'todos' || c.vendedor_id === vend) &&
      (mes === 'todos' || String(c.fecha).startsWith(mes)) &&
      (!t || [c.cliente, c.atencion, c.numero].some((x) => String(x || '').toLowerCase().includes(t))))
  }, [d, q, estado, vend, mes])

  if (!d) return <Cargando />
  const nombre = (id) => d.perfiles.find((p) => p.id === id)?.nombre || '—'
  const vendidas = filtradas.filter((c) => c.estado === 'Vendida')
  const cerradas = filtradas.filter((c) => c.estado !== 'Enviada').length
  const unidadesVendidas = vendidas.reduce((s, c) => s + c.unidades, 0)

  async function cambiarEstado(c, nuevo) {
    setErr(''); setOk('')
    const { error } = await supabase.from('cotizaciones').update({ estado: nuevo }).eq('id', c.id)
    error ? setErr(error.message) : cargar()
  }

  return (
    <>
      <Cabecera titulo={admin ? 'Historial de cotizaciones' : 'Mis cotizaciones'}
        sub={admin ? 'Todas las cotizaciones enviadas por el equipo' : 'Las cotizaciones que enviaste; marca las vendidas para pasarlas a Comisiones'} />

      <div className="grid kpis">
        <Kpi l="Cotizaciones" v={filtradas.length} s={`${filtradas.filter((c) => c.estado === 'Enviada').length} en seguimiento`} />
        <Kpi l="Vendidas" v={vendidas.length} s={`${unidadesVendidas} ${unidadesVendidas === 1 ? 'vehículo' : 'vehículos'}`} tono="bien" />
        <Kpi l="Tasa de cierre" v={cerradas ? Math.round((vendidas.length / cerradas) * 100) + '%' : '—'} s="Vendidas sobre cerradas (vendidas + perdidas)" />
        <Kpi l="Mensual vendido" v={bs0(vendidas.reduce((s, c) => s + Number(c.total_mensual), 0))} s="Servicio mensual de lo vendido" />
      </div>

      <div className="card">
        <div className="filtros">
          <input type="text" placeholder="Buscar cliente, contacto o N.º" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="todas">Todos los estados</option><option>Enviada</option><option>Vendida</option><option>Perdida</option>
          </select>
          {admin && (
            <select value={vend} onChange={(e) => setVend(e.target.value)}>
              <option value="todos">Todos los vendedores</option>
              {d.perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          )}
          <select value={mes} onChange={(e) => setMes(e.target.value)}>
            <option value="todos">Todos los meses</option>
            {ultimosMeses(13).slice(1).map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}
          </select>
        </div>
        <div className="cb" style={{ paddingBottom: 0 }}><Error msg={err} />{ok && <div className="ok">{ok}</div>}</div>
        <div className="tabla-wrap"><table>
          <thead><tr>
            <th>Fecha</th><th>Cliente</th>{admin && <th>Vendedor</th>}<th>Plan</th><th className="r">Vehículos</th>
            <th className="r">Inicial</th><th className="r">Mensual</th><th>Estado</th><th></th>
          </tr></thead>
          <tbody>
            {filtradas.map((c) => (
              <tr key={c.id}>
                <td>{fdate(c.fecha)}<span className="sub">{c.numero}</span></td>
                <td><b>{c.cliente}</b><span className="sub">{[c.atencion, c.telefono].filter(Boolean).join(' · ')}</span></td>
                {admin && <td>{nombre(c.vendedor_id)}</td>}
                <td>{c.tipo === 'empresa' ? 'Empresa' : 'Personal'}{c.con_roaming > 0 && <span className="sub">{c.con_roaming} con roaming</span>}</td>
                <td className="r num">{c.unidades}</td>
                <td className="r num">{bs(c.total_inicial)}</td>
                <td className="r num">{bs(c.total_mensual)}</td>
                <td><span className={'chip ' + CHIP[c.estado]}>{c.estado}</span>
                  {c.fecha_venta && <span className="sub">{fdate(c.fecha_venta)}</span>}</td>
                <td className="r">
                  <div className="acciones-fila">
                    <button className="btn chico" onClick={() => abrirCotizacion(c)}>Abrir</button>
                    {c.estado === 'Enviada' && <>
                      <button className="btn chico primario" onClick={() => { setOk(''); setVender(c) }}>Vendida</button>
                      <button className="btn chico" onClick={() => cambiarEstado(c, 'Perdida')}>Perdida</button>
                    </>}
                    {c.estado === 'Perdida' && <button className="btn chico" onClick={() => cambiarEstado(c, 'Enviada')}>Reabrir</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!filtradas.length && <tr><td colSpan={admin ? 9 : 8} className="vacio">
              {d.cots.length ? 'Ninguna cotización coincide con los filtros.' : 'Todavía no hay cotizaciones. Se guardan solas al enviarlas o descargarlas.'}
            </td></tr>}
          </tbody>
        </table></div>
      </div>

      {vender && <VenderModal c={vender} onClose={() => setVender(null)}
        onDone={(n) => { setVender(null); setOk(`Listo: se crearon ${n} ${n === 1 ? 'venta' : 'ventas'} en Comisiones con los datos de la cotización.`); cargar() }} />}
    </>
  )
}

// Pasa la cotización vendida a Comisiones: una venta por vehículo, con los precios cotizados
function VenderModal({ c, onClose, onDone }) {
  const { params, ir } = useApp()
  const cot = cotizar(c.datos || {})
  const [modalidad, setModalidad] = useState(c.tipo === 'empresa' ? 'Postpago' : 'Prepago')
  const [contrato, setContrato] = useState(true)
  const [fecha, setFecha] = useState(hoyISO())
  const [filas, setFilas] = useState(() => Array.from({ length: c.unidades }, (_, i) => ({
    vehiculo: '',
    roaming: i >= c.unidades - c.con_roaming,
    precio: i >= c.unidades - c.con_roaming ? cot.tramo.roaming : cot.tramo.mes,
  })))
  const [err, setErr] = useState('')
  const [guardando, setGuardando] = useState(false)
  const pct = modalidad === 'Prepago' ? params.comision_prepago_pct : params.comision_postpago_pct
  const comisionTotal = filas.reduce((s, f) => s + Math.round(Number(f.precio || 0) * pct * 100) / 100, 0)
  const setFila = (i, k, v) => setFilas((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)))

  async function confirmar() {
    setErr(''); setGuardando(true)
    const vehiculos = filas.map((f, i) => ({
      vehiculo: f.vehiculo.trim() || `POR ASIGNAR ${i + 1}/${filas.length}`,
      precio_mensual: Number(f.precio),
    }))
    const { data, error } = await supabase.rpc('vender_cotizacion', {
      p_cotizacion: c.id, p_modalidad: modalidad, p_contrato: contrato, p_fecha: fecha, p_vehiculos: vehiculos,
    })
    setGuardando(false)
    if (error) return setErr(error.message)
    onDone(data)
  }

  return (
    <Modal titulo={`Pasar a Comisiones · ${c.cliente}`} onClose={onClose} ancho
      pie={<>
        <button className="btn izq" onClick={() => ir('ventas')}>Ver mis ventas</button>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primario" onClick={confirmar} disabled={guardando}>
          {guardando ? 'Creando ventas…' : `Crear ${filas.length} ${filas.length === 1 ? 'venta' : 'ventas'}`}
        </button>
      </>}>
      <Error msg={err} />
      <div className="nota" style={{ marginBottom: 16 }}>
        Se crea una venta por vehículo en Comisiones con el cliente, el precio cotizado y el tipo de cliente. Si todavía no
        tienes las placas, déjalas vacías: quedan como “Por asignar” y las completas en Mis ventas antes de la instalación.
      </div>
      <div className="form" style={{ marginBottom: 18 }}>
        <Campo label="Tipo de cliente" ayuda={modalidad === 'Postpago' ? 'Empresa: servicio a mes vencido' : 'Personal: servicio por mes adelantado'}>
          <select value={modalidad} onChange={(e) => setModalidad(e.target.value)}><option value="Prepago">Personal</option><option value="Postpago">Empresa</option></select>
        </Campo>
        <Campo label="Fecha de venta"><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
        <label className="check full"><input type="checkbox" checked={contrato} onChange={(e) => setContrato(e.target.checked)} /> Contrato firmado (12 meses)</label>
      </div>
      <div className="tabla-wrap"><table>
        <thead><tr><th>#</th><th>Vehículo / placa</th><th className="r">Precio mensual</th><th className="r">Comisión</th></tr></thead>
        <tbody>{filas.map((f, i) => (
          <tr key={i}>
            <td>{i + 1}{f.roaming && <span className="sub">roaming</span>}</td>
            <td><input type="text" value={f.vehiculo} placeholder={`Por asignar ${i + 1}/${filas.length}`} onChange={(e) => setFila(i, 'vehiculo', e.target.value)} /></td>
            <td className="r"><input type="number" min="0" step="0.01" value={f.precio} onChange={(e) => setFila(i, 'precio', e.target.value)} style={{ width: 110, textAlign: 'right' }} /></td>
            <td className="r num">{bs(Math.round(Number(f.precio || 0) * pct * 100) / 100)}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr><td colSpan="3">Comisión estimada ({Math.round(pct * 100)}%) · se cobra al instalar y activar</td><td className="r num">{bs(comisionTotal)}</td></tr></tfoot>
      </table></div>
    </Modal>
  )
}
