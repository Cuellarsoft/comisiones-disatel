import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { Cabecera, Cargando, useApp } from './ui'
import VentaModal from './VentaModal'
import { bs, fdate, estadoVenta, mesLabel, descargarCSV, diasDesde, instalada } from './lib'

const FILTROS = {
  todas: 'Todas',
  por_instalar: 'Por instalar',
  por_cobrar: 'Instaladas sin pago',
  pagando: 'Pagando',
  baja: 'Bajas / canceladas',
}

export default function Ventas() {
  const { perfil, params } = useApp()
  const admin = perfil.rol === 'admin'
  const [ventas, setVentas] = useState(null)
  const [perfiles, setPerfiles] = useState([])
  const [liqs, setLiqs] = useState({})
  const [edit, setEdit] = useState(null)
  const [fVend, setFVend] = useState('')
  const [fEst, setFEst] = useState('todas')
  const [fMes, setFMes] = useState('')
  const [q, setQ] = useState('')

  async function cargar() {
    const [v, p, l] = await Promise.all([
      supabase.from('ventas').select('*').order('fecha_captacion', { ascending: false }).order('id', { ascending: false }),
      supabase.from('profiles').select('id, nombre, rol, activo').order('nombre'),
      supabase.from('liquidaciones').select('id, periodo'),
    ])
    setVentas(v.data || [])
    setPerfiles(p.data || [])
    setLiqs(Object.fromEntries((l.data || []).map((x) => [x.id, x.periodo])))
  }
  useEffect(() => { cargar() }, [])

  const nombre = (id) => perfiles.find((p) => p.id === id)?.nombre || '—'
  const meses = useMemo(() => [...new Set((ventas || []).map((v) => v.fecha_captacion.slice(0, 7)))].sort().reverse(), [ventas])

  const lista = useMemo(() => {
    if (!ventas) return []
    const t = q.trim().toLowerCase()
    return ventas.filter((v) => {
      if (fVend && v.vendedor_id !== fVend) return false
      if (fMes && !(v.fecha_captacion.startsWith(fMes) || v.fecha_instalacion?.startsWith(fMes))) return false
      if (fEst === 'por_instalar' && !(v.estado === 'Activo' && !v.fecha_instalacion)) return false
      if (fEst === 'por_cobrar' && !(v.estado === 'Activo' && instalada(v) && !v.fecha_primer_pago)) return false
      if (fEst === 'pagando' && !(v.estado === 'Activo' && v.fecha_primer_pago)) return false
      if (fEst === 'baja' && v.estado === 'Activo') return false
      if (t && !`${v.cliente} ${v.empresa || ''} ${v.vehiculo}`.toLowerCase().includes(t)) return false
      return true
    })
  }, [ventas, fVend, fEst, fMes, q])

  if (!ventas) return <Cargando />
  const vendedoresSel = perfiles.filter((p) => p.activo || ventas.some((v) => v.vendedor_id === p.id))

  function exportar() {
    descargarCSV('ventas-disatel.csv', lista.map((v) => ({
      Vendedor: nombre(v.vendedor_id), Captacion: v.fecha_captacion, Cliente: v.cliente, Empresa: v.empresa || '',
      Vehiculo: v.vehiculo, Modalidad: v.modalidad, Precio: v.precio_mensual, Contrato: v.contrato ? 'Sí' : 'No',
      Instalacion: v.fecha_instalacion || '', Activado: v.activado ? 'Sí' : 'No', PrimerPago: v.fecha_primer_pago || '',
      Estado: v.estado, FechaBaja: v.fecha_baja || '', CausaBaja: v.causa_baja || '', Comision: v.comision,
      Liquidacion: v.liquidacion_id ? mesLabel(liqs[v.liquidacion_id]) : '',
    })))
  }

  return (
    <>
      <Cabecera titulo={admin ? 'Ventas' : 'Mis ventas'} sub={`${lista.length} de ${ventas.length} ventas`}>
        <button className="btn" onClick={exportar}>Exportar CSV</button>
        <button className="btn primario" onClick={() => setEdit({})}>+ Registrar venta</button>
      </Cabecera>

      <div className="card">
        <div className="filtros">
          <input type="text" placeholder="Buscar cliente, empresa o placa…" value={q} onChange={(e) => setQ(e.target.value)} />
          {admin && (
            <select value={fVend} onChange={(e) => setFVend(e.target.value)}>
              <option value="">Todos los vendedores</option>
              {vendedoresSel.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          )}
          <select value={fEst} onChange={(e) => setFEst(e.target.value)}>
            {Object.entries(FILTROS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <select value={fMes} onChange={(e) => setFMes(e.target.value)}>
            <option value="">Todos los meses</option>
            {meses.map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}
          </select>
        </div>
        <div className="tabla-wrap"><table>
          <thead><tr>
            <th>Captación</th>{admin && <th>Vendedor</th>}<th>Cliente</th><th>Vehículo</th><th>Modalidad</th>
            <th className="r">Precio</th><th className="r">Comisión</th><th>Instalación</th><th>1er pago</th><th>Estado</th><th>Liquidada</th>
          </tr></thead>
          <tbody>
            {lista.map((v) => {
              const e = estadoVenta(v, params.plazo_pago_dias)
              return (
                <tr key={v.id} className="click" onClick={() => setEdit(v)}>
                  <td>{fdate(v.fecha_captacion)}</td>
                  {admin && <td>{nombre(v.vendedor_id)}</td>}
                  <td><b>{v.cliente}</b><span className="sub">{v.empresa || 'Particular'}</span></td>
                  <td>{v.vehiculo}</td>
                  <td>{v.modalidad}</td>
                  <td className="r num">{bs(v.precio_mensual)}</td>
                  <td className="r num">{bs(v.comision)}</td>
                  <td>{fdate(v.fecha_instalacion)}</td>
                  <td>{fdate(v.fecha_primer_pago)}</td>
                  <td><span className={'chip ' + e.cls}>{e.txt}</span></td>
                  <td>{v.liquidacion_id ? mesLabel(liqs[v.liquidacion_id]) : <span style={{ color: 'var(--gris-claro)' }}>Pendiente</span>}</td>
                </tr>
              )
            })}
            {!lista.length && <tr><td colSpan="11" className="vacio">No hay ventas con estos filtros.</td></tr>}
          </tbody>
        </table></div>
      </div>

      {edit && (
        <VentaModal
          venta={edit.id ? edit : null}
          vendedores={perfiles.filter((p) => p.activo || p.id === edit.vendedor_id)}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); cargar() }}
        />
      )}
    </>
  )
}
