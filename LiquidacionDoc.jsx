import logo from './logo.png'
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { bs, fdate, mesLabel, MOTIVOS, pct } from './lib'
import { Cargando } from './ui'

// Resumen numérico (se usa en vista previa y en el documento)
export function ResumenLiq({ l }) {
  return (
    <div className="resumen-liq num">
      <div className="f"><span>Comisiones por instalaciones</span><span>{bs(l.comisiones)}</span></div>
      <div className="f"><span>Bono por meta ({l.unidades} unidades en el mes)</span><span>{bs(l.bono)}</span></div>
      <div className={'f' + (Number(l.clawbacks) > 0 ? ' menos' : '')}>
        <span>Clawbacks {Number(l.clawbacks) < 0 ? '(neto a favor)' : ''}</span><span>{Number(l.clawbacks) ? '− ' + bs(l.clawbacks) : bs(0)}</span>
      </div>
      {Number(l.saldo_anterior) !== 0 && (
        <div className="f menos"><span>Saldo negativo del mes anterior</span><span>{bs(l.saldo_anterior)}</span></div>
      )}
      <div className="f total"><span>Variable a pagar</span><span>{bs(l.a_pagar)}</span></div>
      {Number(l.total_variable) < 0 && (
        <div className="f ingreso"><span>Saldo que pasa al siguiente mes</span><span>{bs(l.total_variable)}</span></div>
      )}
      <div className="f ingreso"><span>Sueldo fijo</span><span>{bs(l.sueldo_fijo)}</span></div>
      <div className="f ingreso"><span><b>Ingreso total del mes</b></span><span><b>{bs(Number(l.sueldo_fijo) + Number(l.a_pagar))}</b></span></div>
    </div>
  )
}

export default function LiquidacionDoc({ liq, vendedor }) {
  const [ventas, setVentas] = useState(null)
  const [cbs, setCbs] = useState([])
  useEffect(() => {
    Promise.all([
      supabase.from('ventas').select('*').eq('liquidacion_id', liq.id).order('fecha_instalacion'),
      supabase.from('clawbacks').select('*, ventas(cliente, empresa, vehiculo)').eq('liquidacion_id', liq.id).order('created_at'),
    ]).then(([a, b]) => { setVentas(a.data || []); setCbs(b.data || []) })
  }, [liq.id])

  if (!ventas) return <Cargando />
  return (
    <div className="doc-liq imprimible">
      <div className="doc-cab">
        <img src={logo} alt="Disatel" />
        <div className="der">
          <h3>Liquidación de comisiones</h3>
          <div>{vendedor} · {mesLabel(liq.periodo)}</div>
          <div>N.º {String(liq.id).padStart(5, '0')} · {liq.estado === 'pagada' ? `Pagada el ${fdate(liq.fecha_pago)}` : 'Borrador'}</div>
        </div>
      </div>

      <ResumenLiq l={liq} />

      <h4>Ventas comisionadas ({ventas.length})</h4>
      {ventas.length ? (
        <div className="tabla-wrap"><table>
          <thead><tr><th>Instalación</th><th>Cliente</th><th>Vehículo</th><th>Modalidad</th><th className="r">Precio</th><th className="r">Comisión</th></tr></thead>
          <tbody>{ventas.map((v) => (
            <tr key={v.id}><td>{fdate(v.fecha_instalacion)}</td><td>{v.cliente}<span className="sub">{v.empresa}</span></td><td>{v.vehiculo}</td><td>{v.modalidad}</td><td className="r num">{bs(v.precio_mensual)}</td><td className="r num">{bs(v.comision)}</td></tr>
          ))}</tbody>
          <tfoot><tr><td colSpan="5">Total</td><td className="r num">{bs(ventas.reduce((s, v) => s + Number(v.comision), 0))}</td></tr></tfoot>
        </table></div>
      ) : <div className="nota">Sin ventas nuevas en esta liquidación.</div>}

      {cbs.length > 0 && <>
        <h4>Clawbacks aplicados ({cbs.length})</h4>
        <div className="tabla-wrap"><table>
          <thead><tr><th>Cliente</th><th>Vehículo</th><th>Motivo</th><th>Detalle</th><th className="r">%</th><th className="r">Monto</th></tr></thead>
          <tbody>{cbs.map((c) => (
            <tr key={c.id}><td>{c.ventas?.cliente}</td><td>{c.ventas?.vehiculo}</td><td>{MOTIVOS[c.motivo]}</td><td>{c.detalle}</td><td className="r num">{pct(c.porcentaje)}</td><td className="r num">{c.monto > 0 ? '− ' : '+ '}{bs(Math.abs(c.monto))}</td></tr>
          ))}</tbody>
        </table></div>
      </>}

      {liq.notas && <><h4>Notas</h4><div>{liq.notas}</div></>}
      <div className="firmas"><div>Entregué conforme — Disatel</div><div>Recibí conforme — {vendedor}</div></div>
    </div>
  )
}
