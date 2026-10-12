import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Cabecera, Cargando, Error, useApp } from './ui'
import { bs, fdate, diasDesde, hoyISO, instalada } from './lib'

export default function Cobranza() {
  const { params } = useApp()
  const plazo = params.plazo_pago_dias
  const [d, setD] = useState(null)
  const [fechas, setFechas] = useState({})
  const [err, setErr] = useState('')

  async function cargar() {
    const [v, p] = await Promise.all([
      supabase.from('ventas').select('*').eq('estado', 'Activo').is('fecha_primer_pago', null).not('fecha_instalacion', 'is', null),
      supabase.from('profiles').select('id, nombre'),
    ])
    const vs = (v.data || []).filter(instalada).sort((a, b) => a.fecha_instalacion.localeCompare(b.fecha_instalacion))
    setD({ ventas: vs, perfiles: p.data || [] })
  }
  useEffect(() => { cargar() }, [])

  async function registrar(v) {
    setErr('')
    const f = fechas[v.id] || hoyISO()
    const { error } = await supabase.from('ventas').update({ fecha_primer_pago: f }).eq('id', v.id)
    if (error) return setErr(error.message)
    cargar()
  }

  if (!d) return <Cargando />
  const nombre = (id) => d.perfiles.find((p) => p.id === id)?.nombre || '—'
  const vencidos = d.ventas.filter((v) => diasDesde(v.fecha_instalacion) > plazo)
  const enPlazo = d.ventas.filter((v) => diasDesde(v.fecha_instalacion) <= plazo)

  const tabla = (filas, vencido) => (
    <div className="tabla-wrap"><table>
      <thead><tr><th>Cliente</th><th>Vendedor</th><th>Instalado</th><th className="r">Días</th><th className="r">Comisión</th><th>Registrar 1er pago</th></tr></thead>
      <tbody>
        {filas.map((v) => {
          const dd = diasDesde(v.fecha_instalacion)
          return (
            <tr key={v.id}>
              <td><b>{v.cliente}</b><span className="sub">{v.empresa || 'Particular'} · {v.vehiculo} · {v.modalidad}</span></td>
              <td>{nombre(v.vendedor_id)}</td>
              <td>{fdate(v.fecha_instalacion)}</td>
              <td className="r">
                {vencido ? <span className="chip rojo">{dd} días</span>
                  : <span className={'chip ' + (plazo - dd <= 7 ? 'ambar' : 'azul')}>quedan {plazo - dd}</span>}
              </td>
              <td className="r num">{bs(v.comision)}</td>
              <td>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="date" style={{ width: 150 }} value={fechas[v.id] || hoyISO()} onChange={(e) => setFechas({ ...fechas, [v.id]: e.target.value })} />
                  <button className="btn chico oscuro" onClick={() => registrar(v)}>Pagó</button>
                </div>
              </td>
            </tr>
          )
        })}
        {!filas.length && <tr><td colSpan="6" className="vacio">Nada por aquí.</td></tr>}
      </tbody>
    </table></div>
  )

  return (
    <>
      <Cabecera titulo="Cobranza" sub={`Clientes instalados que todavía no hicieron su primer pago · plazo ${plazo} días`} />
      <Error msg={err} />
      <div className="card">
        <div className="ch"><h2>Vencidos — se descuenta la comisión ({vencidos.length})</h2><span>{bs(vencidos.reduce((s, v) => s + Number(v.comision), 0))} en clawback</span></div>
        {tabla(vencidos, true)}
      </div>
      <div className="card">
        <div className="ch"><h2>Dentro del plazo ({enPlazo.length})</h2><span>{bs(enPlazo.reduce((s, v) => s + Number(v.comision), 0))} en riesgo</span></div>
        {tabla(enPlazo, false)}
      </div>
      <p className="nota" style={{ marginTop: 18 }}>
        Si un cliente vencido paga después, al registrar el pago el sistema devuelve automáticamente la comisión al vendedor
        (como “reintegro”) en la siguiente liquidación.
      </p>
    </>
  )
}
