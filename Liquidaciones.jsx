import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { Cabecera, Cargando, Campo, Error, Modal, useApp } from '../components/ui'
import LiquidacionDoc from '../components/LiquidacionDoc'
import { bs, fdate, hoyISO, mesActual, mesLabel, ultimosMeses } from '../lib'

function mesAnterior() {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Liquidaciones() {
  const { perfil } = useApp()
  const admin = perfil.rol === 'admin'
  const [d, setD] = useState(null)
  const [ver, setVer] = useState(null)
  const [gen, setGen] = useState(false)

  async function cargar() {
    const [l, p] = await Promise.all([
      supabase.from('liquidaciones').select('*').order('periodo', { ascending: false }).order('id', { ascending: false }),
      supabase.from('profiles').select('id, nombre, rol, activo').order('nombre'),
    ])
    setD({ liqs: l.data || [], perfiles: p.data || [] })
  }
  useEffect(() => { cargar() }, [])

  if (!d) return <Cargando />
  const nombre = (id) => d.perfiles.find((p) => p.id === id)?.nombre || '—'
  const pendientes = d.liqs.filter((l) => l.estado === 'borrador')

  return (
    <>
      <Cabecera titulo={admin ? 'Liquidaciones' : 'Mis liquidaciones'}
        sub={admin ? `${pendientes.length} por pagar · ${bs(pendientes.reduce((s, l) => s + Number(l.a_pagar), 0))}` : 'Detalle de lo que se te pagó cada mes'}>
        {admin && <button className="btn primario" onClick={() => setGen(true)}>+ Generar liquidación</button>}
      </Cabecera>

      <div className="card">
        <div className="tabla-wrap"><table>
          <thead><tr>
            <th>Mes</th>{admin && <th>Vendedor</th>}<th className="r">Unidades</th><th className="r">Comisiones</th><th className="r">Bono</th>
            <th className="r">Clawbacks</th><th className="r">A pagar</th><th>Estado</th>
          </tr></thead>
          <tbody>
            {d.liqs.map((l) => (
              <tr key={l.id} className="click" onClick={() => setVer(l)}>
                <td><b>{mesLabel(l.periodo)}</b></td>
                {admin && <td>{nombre(l.vendedor_id)}</td>}
                <td className="r num">{l.unidades}</td>
                <td className="r num">{bs(l.comisiones)}</td>
                <td className="r num">{bs(l.bono)}</td>
                <td className="r num" style={{ color: l.clawbacks > 0 ? 'var(--rojo-osc)' : undefined }}>{Number(l.clawbacks) ? '− ' + bs(l.clawbacks) : '—'}</td>
                <td className="r num"><b>{bs(l.a_pagar)}</b></td>
                <td>{l.estado === 'pagada' ? <span className="chip verde">Pagada {fdate(l.fecha_pago)}</span> : <span className="chip ambar">Por pagar</span>}</td>
              </tr>
            ))}
            {!d.liqs.length && <tr><td colSpan="8" className="vacio">Todavía no hay liquidaciones.</td></tr>}
          </tbody>
        </table></div>
      </div>

      {ver && <DetalleModal liq={ver} vendedor={nombre(ver.vendedor_id)} admin={admin}
        onClose={() => setVer(null)} onChange={() => { setVer(null); cargar() }} />}
      {gen && <GenerarModal perfiles={d.perfiles} liqs={d.liqs} onClose={() => setGen(false)} onDone={() => { setGen(false); cargar() }} />}
    </>
  )
}

function DetalleModal({ liq, vendedor, admin, onClose, onChange }) {
  const [fecha, setFecha] = useState(hoyISO())
  const [err, setErr] = useState('')

  async function pagar() {
    const { error } = await supabase.from('liquidaciones').update({ estado: 'pagada', fecha_pago: fecha }).eq('id', liq.id)
    error ? setErr(error.message) : onChange()
  }
  async function reabrir() {
    const { error } = await supabase.from('liquidaciones').update({ estado: 'borrador', fecha_pago: null }).eq('id', liq.id)
    error ? setErr(error.message) : onChange()
  }
  async function eliminar() {
    if (!confirm('¿Eliminar esta liquidación? Las ventas y clawbacks vuelven a quedar pendientes.')) return
    const { error } = await supabase.rpc('eliminar_liquidacion', { p_id: liq.id })
    error ? setErr(error.message) : onChange()
  }

  return (
    <Modal titulo={`Liquidación · ${vendedor} · ${mesLabel(liq.periodo)}`} onClose={onClose} ancho
      pie={<>
        {admin && liq.estado === 'borrador' && <button className="btn peligro izq" onClick={eliminar}>Eliminar</button>}
        {admin && liq.estado === 'pagada' && <button className="btn izq" onClick={reabrir}>Marcar como no pagada</button>}
        <button className="btn" onClick={() => window.print()}>Imprimir / PDF</button>
        {admin && liq.estado === 'borrador' && <>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ width: 160 }} />
          <button className="btn primario" onClick={pagar}>Marcar pagada</button>
        </>}
      </>}>
      <div className="no-print"><Error msg={err} /></div>
      <LiquidacionDoc liq={liq} vendedor={vendedor} />
    </Modal>
  )
}

function GenerarModal({ perfiles, liqs, onClose, onDone }) {
  const [mes, setMes] = useState(mesAnterior())
  const [vend, setVend] = useState('todos')
  const [prev, setPrev] = useState(null)
  const [err, setErr] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const candidatos = perfiles.filter((p) => p.activo && p.rol === 'vendedor')
  const objetivo = vend === 'todos' ? candidatos : perfiles.filter((p) => p.id === vend)

  async function previsualizar() {
    setErr(''); setTrabajando(true)
    const res = []
    for (const p of objetivo) {
      const { data, error } = await supabase.rpc('calcular_liquidacion', { p_vendedor: p.id, p_periodo: mes + '-01', p_guardar: false })
      if (error) { setErr(error.message); break }
      const posterior = liqs.some((l) => l.vendedor_id === p.id && l.periodo > mes + '-01')
      res.push({ p, r: data, bloqueo: data.ya_existe ? 'Ya liquidado' : posterior ? 'Tiene una liquidación posterior' : null })
    }
    setPrev(res); setTrabajando(false)
  }
  useEffect(() => { setPrev(null) }, [mes, vend])

  async function generar() {
    setErr(''); setTrabajando(true)
    for (const x of prev.filter((x) => !x.bloqueo)) {
      const { error } = await supabase.rpc('calcular_liquidacion', { p_vendedor: x.p.id, p_periodo: mes + '-01', p_guardar: true })
      if (error) { setErr(`${x.p.nombre}: ${error.message}`); setTrabajando(false); return }
    }
    setTrabajando(false); onDone()
  }

  const generables = prev?.filter((x) => !x.bloqueo) || []

  return (
    <Modal titulo="Generar liquidación" onClose={onClose} ancho
      pie={<>
        <button className="btn" onClick={onClose}>Cancelar</button>
        {!prev
          ? <button className="btn oscuro" onClick={previsualizar} disabled={trabajando || !objetivo.length}>{trabajando ? 'Calculando…' : 'Vista previa'}</button>
          : <button className="btn primario" onClick={generar} disabled={trabajando || !generables.length}>{trabajando ? 'Generando…' : `Generar ${generables.length} liquidación(es)`}</button>}
      </>}>
      <Error msg={err} />
      <div className="form" style={{ marginBottom: 16 }}>
        <Campo label="Mes a liquidar" ayuda="Incluye instalaciones hasta fin de ese mes aún no pagadas y todos los clawbacks pendientes">
          <select value={mes} onChange={(e) => setMes(e.target.value)}>
            {ultimosMeses().filter((m) => m <= mesActual()).map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}
          </select>
        </Campo>
        <Campo label="Vendedor">
          <select value={vend} onChange={(e) => setVend(e.target.value)}>
            <option value="todos">Todos los vendedores activos</option>
            {perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
      </div>
      {prev && (
        <div className="tabla-wrap" style={{ border: '1px solid var(--linea)', borderRadius: 8 }}><table>
          <thead><tr><th>Vendedor</th><th className="r">Unid.</th><th className="r">Comisiones</th><th className="r">Bono</th><th className="r">Clawbacks</th><th className="r">Saldo ant.</th><th className="r">A pagar</th><th></th></tr></thead>
          <tbody>{prev.map(({ p, r, bloqueo }) => (
            <tr key={p.id} style={{ opacity: bloqueo ? .5 : 1 }}>
              <td><b>{p.nombre}</b></td>
              <td className="r num">{r.unidades}</td>
              <td className="r num">{bs(r.comisiones)}</td>
              <td className="r num">{bs(r.bono)}</td>
              <td className="r num">{Number(r.clawbacks) ? '− ' + bs(r.clawbacks) : '—'}</td>
              <td className="r num">{Number(r.saldo_anterior) ? bs(r.saldo_anterior) : '—'}</td>
              <td className="r num"><b>{bs(r.a_pagar)}</b></td>
              <td>{bloqueo && <span className="chip gris">{bloqueo}</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {!candidatos.length && vend === 'todos' && <div className="nota">No hay vendedores activos.</div>}
    </Modal>
  )
}
