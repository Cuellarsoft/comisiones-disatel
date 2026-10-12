import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { Cabecera, Kpi, Cargando, MiniBarra, useApp } from '../components/ui'
import { bs, bs0, bonoInfo, diasDesde, mesActual, mesLabel, mesCorto, ultimosMeses, instalada } from '../lib'

export default function ResumenAdmin() {
  const { params, ir } = useApp()
  const [mes, setMes] = useState(mesActual())
  const [d, setD] = useState(null)

  useEffect(() => {
    (async () => {
      await supabase.rpc('sync_clawbacks')
      const [p, v, c] = await Promise.all([
        supabase.from('profiles').select('*').order('nombre'),
        supabase.from('ventas').select('*'),
        supabase.from('clawbacks').select('*').is('liquidacion_id', null),
      ])
      setD({ perfiles: p.data || [], ventas: v.data || [], cbs: c.data || [] })
    })()
  }, [])

  const plazo = params.plazo_pago_dias
  const r = useMemo(() => {
    if (!d) return null
    const enMes = (v) => instalada(v) && v.fecha_instalacion.slice(0, 7) === mes
    const vendedores = d.perfiles.filter((p) => p.rol === 'vendedor' || d.ventas.some((v) => v.vendedor_id === p.id))
    const filas = vendedores.map((p) => {
      const vs = d.ventas.filter((v) => v.vendedor_id === p.id)
      const mesV = vs.filter(enMes)
      const unid = mesV.length
      const sinPago = vs.filter((v) => instalada(v) && v.estado === 'Activo' && !v.fecha_primer_pago)
      return {
        p, unid, info: bonoInfo(unid, params.bonos),
        comMes: mesV.reduce((s, v) => s + Number(v.comision), 0),
        porCobrar: sinPago.filter((v) => diasDesde(v.fecha_instalacion) <= plazo).length,
        vencidos: sinPago.filter((v) => diasDesde(v.fecha_instalacion) > plazo).length,
        cb: d.cbs.filter((c) => c.vendedor_id === p.id).reduce((s, c) => s + Number(c.monto), 0),
        porInstalar: vs.filter((v) => !v.fecha_instalacion && v.estado === 'Activo').length,
      }
    })
    const tot = (k) => filas.reduce((s, f) => s + f[k], 0)
    const vencidosVentas = d.ventas.filter((v) => instalada(v) && v.estado === 'Activo' && !v.fecha_primer_pago && diasDesde(v.fecha_instalacion) > plazo)
    const meses = ultimosMeses(7).slice(1).reverse()
    const porMes = meses.map((m) => ({ m, n: d.ventas.filter((v) => instalada(v) && v.fecha_instalacion.slice(0, 7) === m).length }))
    return { filas, tot, vencidosVentas, porMes, maxMes: Math.max(1, ...porMes.map((x) => x.n)) }
  }, [d, mes, params, plazo])

  if (!r) return <Cargando />
  const cbPend = d.cbs.reduce((s, c) => s + Number(c.monto), 0)

  return (
    <>
      <Cabecera titulo="Resumen del equipo" sub={`Instalaciones, bonos y cobranza · ${mesLabel(mes)}`}>
        <select value={mes} onChange={(e) => setMes(e.target.value)}>
          {ultimosMeses().map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}
        </select>
      </Cabecera>

      <div className="grid kpis">
        <Kpi l="Unidades instaladas" v={r.tot('unid')} s={r.tot('porInstalar') === 1 ? '1 venta por instalar' : `${r.tot('porInstalar')} ventas por instalar`} />
        <Kpi l="Comisiones del mes" v={bs0(r.tot('comMes'))} s="Sobre instalaciones activadas" />
        <Kpi l="Clientes sin pago" v={r.tot('vencidos')} tono={r.tot('vencidos') ? 'alerta' : ''}
          s={`más de ${plazo} días · ${r.tot('porCobrar')} aún en plazo`} />
        <Kpi l="Clawback por aplicar" v={bs0(cbPend)} tono={cbPend > 0 ? 'alerta' : ''} s="Se descuenta en la próxima liquidación" />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="ch"><h2>Por vendedor</h2><span>{mesLabel(mes)}</span></div>
        <div className="tabla-wrap"><table>
          <thead><tr>
            <th>Vendedor</th><th className="r">Instaladas</th><th>Camino al bono</th><th className="r">Comisiones</th>
            <th className="r">Por cobrar</th><th className="r">Sin pago</th><th className="r">Clawback pend.</th>
          </tr></thead>
          <tbody>
            {r.filas.map((f) => (
              <tr key={f.p.id}>
                <td><b>{f.p.nombre}</b>{!f.p.activo && <span className="sub">Inactivo</span>}</td>
                <td className="r num">{f.unid}</td>
                <td style={{ minWidth: 190 }}>
                  <MiniBarra valor={f.unid} max={f.info.siguiente?.min || f.info.max} />
                  <span className="sub">
                    {f.info.actual ? `Bono ${bs0(f.info.actual.bono)}` : 'Sin bono aún'}
                    {f.info.siguiente && ` · faltan ${f.info.faltan} para ${bs0(f.info.siguiente.bono)}`}
                  </span>
                </td>
                <td className="r num">{bs(f.comMes)}</td>
                <td className="r num">{f.porCobrar}</td>
                <td className="r num">{f.vencidos ? <span className="chip rojo">{f.vencidos}</span> : 0}</td>
                <td className="r num">{f.cb ? bs(f.cb) : '—'}</td>
              </tr>
            ))}
            {!r.filas.length && <tr><td colSpan="7" className="vacio">Aún no hay vendedores. Créelos en “Vendedores”.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="grid dos" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="ch"><h2>Clientes instalados sin ningún pago</h2><button className="btn chico" onClick={() => ir('cobranza')}>Ver cobranza</button></div>
          {r.vencidosVentas.length ? (
            <div className="tabla-wrap"><table><tbody>
              {r.vencidosVentas.slice(0, 8).map((v) => (
                <tr key={v.id}>
                  <td>{v.cliente}<span className="sub">{v.empresa || 'Particular'} · {v.vehiculo}</span></td>
                  <td className="r"><span className="chip rojo">{diasDesde(v.fecha_instalacion)} días</span></td>
                  <td className="r num">{bs(v.comision)}</td>
                </tr>
              ))}
            </tbody></table></div>
          ) : <div className="vacio">Todos los clientes instalados están al día o dentro del plazo.</div>}
        </div>
        <div className="card">
          <div className="ch"><h2>Instalaciones por mes</h2><span>Equipo completo</span></div>
          <div className="cb" style={{ display: 'grid', gap: 10 }}>
            {r.porMes.map(({ m, n }) => (
              <div key={m} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 34px', alignItems: 'center', gap: 10 }}>
                <span style={{ color: 'var(--gris)', fontSize: 12.5 }}>{mesCorto(m)}</span>
                <MiniBarra valor={n} max={r.maxMes} />
                <b className="num" style={{ textAlign: 'right' }}>{n}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
