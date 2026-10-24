import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { Cabecera, Cargando } from './ui'
import { bs, fdate } from './lib'

const ACCIONES = ['Pago registrado', 'Pago borrado', 'Instalación registrada', 'Cambio de estado', 'Dato modificado',
  'Venta registrada', 'Venta eliminada', 'Liquidación generada', 'Liquidación pagada', 'Liquidación reabierta', 'Liquidación eliminada']

export const fechaHora = (ts) => {
  const d = new Date(ts)
  return d.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
}

// Muestra un valor guardado como texto de forma legible
export function valor(campo, v) {
  if (v == null || v === '') return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fdate(v)
  if (v === 'true') return 'Sí'
  if (v === 'false') return 'No'
  if (campo === 'Comisión' || campo === 'Precio mensual') return bs(v)
  return v
}

const tono = (a) => a.startsWith('Pago registrado') || a === 'Liquidación pagada' ? 'verde'
  : a.includes('borrado') || a.includes('eliminada') ? 'rojo'
  : a === 'Dato modificado' || a === 'Cambio de estado' ? 'ambar' : 'azul'

export function FilaHistorial({ h, conDetalle = true }) {
  return (
    <tr>
      <td style={{ whiteSpace: 'nowrap' }}>{fechaHora(h.created_at)}</td>
      <td><b>{h.usuario_nombre}</b></td>
      <td><span className={'chip ' + tono(h.accion)}>{h.accion}</span></td>
      {conDetalle && <td>{h.detalle}</td>}
      <td>{h.campo ? <>{h.campo}: <span style={{ color: 'var(--gris)' }}>{valor(h.campo, h.antes)}</span> → <b>{valor(h.campo, h.despues)}</b></> : '—'}</td>
    </tr>
  )
}

export default function Historial() {
  const [d, setD] = useState(null)
  const [fUsr, setFUsr] = useState('')
  const [fAcc, setFAcc] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    supabase.from('historial').select('*').order('created_at', { ascending: false }).limit(1000)
      .then(({ data }) => setD(data || []))
  }, [])

  const usuarios = useMemo(() => [...new Set((d || []).map((h) => h.usuario_nombre))].sort(), [d])
  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (d || []).filter((h) =>
      (!fUsr || h.usuario_nombre === fUsr) && (!fAcc || h.accion === fAcc) &&
      (!t || (h.detalle || '').toLowerCase().includes(t)))
  }, [d, fUsr, fAcc, q])

  if (!d) return <Cargando />
  return (
    <>
      <Cabecera titulo="Historial de cambios" sub="Quién registró cada pago, instalación, baja o liquidación, y cuándo" />
      <div className="card">
        <div className="filtros">
          <input type="text" placeholder="Buscar cliente o placa…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={fUsr} onChange={(e) => setFUsr(e.target.value)}>
            <option value="">Todos los usuarios</option>
            {usuarios.map((u) => <option key={u}>{u}</option>)}
          </select>
          <select value={fAcc} onChange={(e) => setFAcc(e.target.value)}>
            <option value="">Todas las acciones</option>
            {ACCIONES.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div className="tabla-wrap"><table>
          <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Venta / liquidación</th><th>Cambio</th></tr></thead>
          <tbody>
            {lista.map((h) => <FilaHistorial key={h.id} h={h} />)}
            {!lista.length && <tr><td colSpan="5" className="vacio">Sin movimientos con estos filtros.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
