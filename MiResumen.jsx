import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { Cabecera, Kpi, Cargando, BonoBarra, useApp } from '../components/ui'
import { ResumenLiq } from '../components/LiquidacionDoc'
import VentaModal from '../components/VentaModal'
import { bs, bs0, bonoInfo, diasDesde, fdate, mesActual, mesLabel, instalada } from '../lib'

export default function MiResumen() {
  const { perfil, params, ir } = useApp()
  const [d, setD] = useState(null)
  const [nueva, setNueva] = useState(false)
  const mes = mesActual()

  async function cargar() {
    const [v, prev] = await Promise.all([
      supabase.from('ventas').select('*').order('fecha_captacion', { ascending: false }),
      supabase.rpc('calcular_liquidacion', { p_vendedor: perfil.id, p_periodo: mes + '-01', p_guardar: false }),
    ])
    setD({ ventas: v.data || [], prev: prev.data })
  }
  useEffect(() => { cargar() }, [])

  if (!d) return <Cargando />
  const plazo = params.plazo_pago_dias
  const delMes = d.ventas.filter((v) => instalada(v) && v.fecha_instalacion.slice(0, 7) === mes)
  const unid = delMes.length
  const info = bonoInfo(unid, params.bonos)
  const porCobrar = d.ventas
    .filter((v) => instalada(v) && v.estado === 'Activo' && !v.fecha_primer_pago)
    .sort((a, b) => a.fecha_instalacion.localeCompare(b.fecha_instalacion))
  const porInstalar = d.ventas.filter((v) => !v.fecha_instalacion && v.estado === 'Activo')
  const enRiesgo = porCobrar.reduce((s, v) => s + Number(v.comision), 0)

  return (
    <>
      <Cabecera titulo={`Hola, ${perfil.nombre.split(' ')[0]}`} sub={`Tu mes de ${mesLabel(mes)}`}>
        <button className="btn primario" onClick={() => setNueva(true)}>+ Registrar venta</button>
      </Cabecera>

      <div className="grid kpis">
        <Kpi l="Instaladas este mes" v={unid} s={porInstalar.length === 1 ? '1 venta esperando instalación' : `${porInstalar.length} ventas esperando instalación`} />
        <Kpi l="Comisiones del mes" v={bs0(delMes.reduce((s, v) => s + Number(v.comision), 0))} s="Por unidades instaladas" />
        <Kpi l="Bono alcanzado" v={bs0(info.actual?.bono || 0)} tono={info.actual ? 'bien' : ''}
          s={info.siguiente ? `Te faltan ${info.faltan} para ${bs0(info.siguiente.bono)}` : '¡Bono máximo!'} />
        <Kpi l="Comisión en riesgo" v={bs0(enRiesgo)} tono={enRiesgo ? 'alerta' : ''} s={`${porCobrar.length} clientes sin primer pago`} />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="ch"><h2>Camino al bono de {mesLabel(mes)}</h2><span>{unid} unidades instaladas</span></div>
        <div className="cb"><BonoBarra unidades={unid} bonos={params.bonos} /></div>
      </div>

      <div className="grid dos" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="ch"><h2>Clientes por cobrar</h2><span>Si no pagan en {plazo} días se descuenta la comisión</span></div>
          {porCobrar.length ? (
            <div className="tabla-wrap"><table>
              <thead><tr><th>Cliente</th><th>Instalado</th><th className="r">Plazo</th><th className="r">Comisión</th></tr></thead>
              <tbody>{porCobrar.map((v) => {
                const dd = diasDesde(v.fecha_instalacion), q = plazo - dd
                return (
                  <tr key={v.id}>
                    <td>{v.cliente}<span className="sub">{v.empresa || 'Particular'} · {v.vehiculo}</span></td>
                    <td>{fdate(v.fecha_instalacion)}</td>
                    <td className="r">{q >= 0 ? <span className={'chip ' + (q <= 7 ? 'ambar' : 'azul')}>quedan {q} días</span> : <span className="chip rojo">vencido</span>}</td>
                    <td className="r num">{bs(v.comision)}</td>
                  </tr>
                )
              })}</tbody>
            </table></div>
          ) : <div className="vacio">Todos tus clientes instalados ya pagaron. 👏</div>}
        </div>

        <div className="card">
          <div className="ch"><h2>Si se liquidara hoy</h2><button className="btn chico" onClick={() => ir('liquidaciones')}>Mis liquidaciones</button></div>
          <div className="cb">{d.prev ? <ResumenLiq l={d.prev} /> : <div className="vacio">Sin datos</div>}</div>
        </div>
      </div>

      {nueva && <VentaModal onClose={() => setNueva(false)} onSaved={() => { setNueva(false); cargar() }} />}
    </>
  )
}
