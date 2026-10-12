import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Cabecera, Cargando, Kpi, useApp } from './ui'
import { bs, fdate, mesLabel, MOTIVOS, pct } from './lib'

export default function Clawbacks() {
  const { perfil, params } = useApp()
  const admin = perfil.rol === 'admin'
  const [d, setD] = useState(null)
  const [filtro, setFiltro] = useState('pendientes')
  const [recalc, setRecalc] = useState(false)

  async function cargar(sync = true) {
    if (sync && admin) await supabase.rpc('sync_clawbacks')
    const [c, p, l] = await Promise.all([
      supabase.from('clawbacks').select('*, ventas(cliente, empresa, vehiculo, fecha_instalacion)').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, nombre'),
      supabase.from('liquidaciones').select('id, periodo'),
    ])
    setD({ cbs: c.data || [], perfiles: p.data || [], liqs: Object.fromEntries((l.data || []).map((x) => [x.id, x.periodo])) })
  }
  useEffect(() => { cargar() }, [])

  if (!d) return <Cargando />
  const nombre = (id) => d.perfiles.find((p) => p.id === id)?.nombre || '—'
  const lista = d.cbs.filter((c) => filtro === 'todos' || (filtro === 'pendientes' ? !c.liquidacion_id : c.liquidacion_id))
  const pend = d.cbs.filter((c) => !c.liquidacion_id)
  const aplic = d.cbs.filter((c) => c.liquidacion_id)
  const suma = (a) => a.reduce((s, c) => s + Number(c.monto), 0)
  const tiers = (params.clawback_baja || []).map((p, i) => `mes ${i + 1}: ${pct(p)}`).join(' · ')

  return (
    <>
      <Cabecera titulo={admin ? 'Clawbacks' : 'Mis descuentos'} sub="Comisiones que se descuentan por clientes que no pagaron o se dieron de baja">
        {admin && <button className="btn" disabled={recalc} onClick={async () => { setRecalc(true); await cargar(); setRecalc(false) }}>{recalc ? 'Recalculando…' : 'Recalcular ahora'}</button>}
      </Cabecera>

      <div className="grid kpis">
        <Kpi l="Pendiente de aplicar" v={bs(suma(pend))} tono={suma(pend) > 0 ? 'alerta' : ''} s={`${pend.length} movimientos`} />
        <Kpi l="Ya descontado" v={bs(suma(aplic))} s={`${aplic.length} movimientos en liquidaciones`} />
        <Kpi l="Regla falta de pago" v="100%" s={`Sin pago a ${params.plazo_pago_dias} días de instalado`} />
        <Kpi l="Regla de bajas" v={pct(params.clawback_baja?.[0])} s={tiers} />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="filtros">
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option value="pendientes">Pendientes de aplicar</option>
            <option value="aplicados">Aplicados en liquidaciones</option>
            <option value="todos">Todos</option>
          </select>
        </div>
        <div className="tabla-wrap"><table>
          <thead><tr>
            <th>Generado</th>{admin && <th>Vendedor</th>}<th>Cliente</th><th>Motivo</th><th>Detalle</th><th className="r">%</th><th className="r">Monto</th><th>Estado</th>
          </tr></thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id}>
                <td>{fdate(c.created_at)}</td>
                {admin && <td>{nombre(c.vendedor_id)}</td>}
                <td><b>{c.ventas?.cliente}</b><span className="sub">{c.ventas?.empresa || 'Particular'} · {c.ventas?.vehiculo}</span></td>
                <td><span className={'chip ' + (c.motivo === 'reintegro' ? 'verde' : 'rojo')}>{MOTIVOS[c.motivo]}</span></td>
                <td>{c.detalle}</td>
                <td className="r num">{pct(c.porcentaje)}</td>
                <td className="r num" style={{ color: c.monto > 0 ? 'var(--rojo-osc)' : 'var(--verde)' }}>{c.monto > 0 ? '− ' : '+ '}{bs(Math.abs(c.monto))}</td>
                <td>{c.liquidacion_id ? `Aplicado · ${mesLabel(d.liqs[c.liquidacion_id])}` : <span className="chip ambar">Pendiente</span>}</td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan="8" className="vacio">No hay clawbacks {filtro === 'pendientes' ? 'pendientes' : ''}.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
