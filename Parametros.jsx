import { useState } from 'react'
import { supabase } from '../supabase'
import { Cabecera, Campo, Error, useApp } from '../components/ui'

export default function Parametros() {
  const { params, cargarParams } = useApp()
  const [f, setF] = useState(() => ({
    comision_prepago_pct: params.comision_prepago_pct * 100,
    precio_prepago: params.precio_prepago,
    comision_postpago_pct: params.comision_postpago_pct * 100,
    precio_postpago: params.precio_postpago,
    plazo_pago_dias: params.plazo_pago_dias,
    sueldo_fijo_default: params.sueldo_fijo_default,
    clawback_baja: params.clawback_baja.map((x) => x * 100),
    bonos: [...params.bonos].sort((a, b) => a.min - b.min),
  }))
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function guardar() {
    setErr(''); setOk('')
    const row = {
      comision_prepago_pct: Number(f.comision_prepago_pct) / 100,
      precio_prepago: Number(f.precio_prepago),
      comision_postpago_pct: Number(f.comision_postpago_pct) / 100,
      precio_postpago: Number(f.precio_postpago),
      plazo_pago_dias: parseInt(f.plazo_pago_dias, 10),
      sueldo_fijo_default: Number(f.sueldo_fijo_default),
      clawback_baja: f.clawback_baja.map((x) => Number(x) / 100),
      bonos: f.bonos.filter((b) => b.min !== '' && b.bono !== '').map((b) => ({ min: parseInt(b.min, 10), bono: Number(b.bono) })).sort((a, b) => a.min - b.min),
      updated_at: new Date().toISOString(),
    }
    if (row.plazo_pago_dias < 1) return setErr('El plazo debe ser de al menos 1 día')
    const { error } = await supabase.from('parametros').update(row).eq('id', 1)
    if (error) return setErr(error.message)
    await supabase.rpc('sync_clawbacks')
    await cargarParams()
    setOk('Parámetros guardados. Aplican a las ventas nuevas; las comisiones ya registradas no cambian.')
  }

  const setBono = (i, k, v) => setF({ ...f, bonos: f.bonos.map((b, j) => (j === i ? { ...b, [k]: v } : b)) })
  const setCb = (i, v) => setF({ ...f, clawback_baja: f.clawback_baja.map((x, j) => (j === i ? v : x)) })

  return (
    <>
      <Cabecera titulo="Parámetros" sub="Plan de compensación del equipo de ventas">
        <button className="btn primario" onClick={guardar}>Guardar cambios</button>
      </Cabecera>
      <Error msg={err} />
      {ok && <div className="ok">{ok}</div>}

      <div className="grid dos">
        <div className="card">
          <div className="ch"><h2>Comisión por unidad instalada</h2></div>
          <div className="cb form">
            <Campo label="Precio Postpago (Bs/mes)"><input type="number" value={f.precio_postpago} onChange={set('precio_postpago')} /></Campo>
            <Campo label="Comisión Postpago (%)"><input type="number" value={f.comision_postpago_pct} onChange={set('comision_postpago_pct')} /></Campo>
            <Campo label="Precio Prepago (Bs/mes)"><input type="number" value={f.precio_prepago} onChange={set('precio_prepago')} /></Campo>
            <Campo label="Comisión Prepago (%)"><input type="number" value={f.comision_prepago_pct} onChange={set('comision_prepago_pct')} /></Campo>
            <Campo label="Sueldo fijo por defecto (Bs)" ayuda="Para vendedores nuevos"><input type="number" value={f.sueldo_fijo_default} onChange={set('sueldo_fijo_default')} /></Campo>
          </div>
        </div>
        <div className="card">
          <div className="ch"><h2>Bonos mensuales</h2><button className="btn chico" onClick={() => setF({ ...f, bonos: [...f.bonos, { min: '', bono: '' }] })}>+ Tramo</button></div>
          <div className="cb" style={{ display: 'grid', gap: 10 }}>
            {f.bonos.map((b, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
                <Campo label={i === 0 ? 'Desde (unidades)' : ''}><input type="number" value={b.min} onChange={(e) => setBono(i, 'min', e.target.value)} /></Campo>
                <Campo label={i === 0 ? 'Bono (Bs)' : ''}><input type="number" value={b.bono} onChange={(e) => setBono(i, 'bono', e.target.value)} /></Campo>
                <button className="btn chico peligro" onClick={() => setF({ ...f, bonos: f.bonos.filter((_, j) => j !== i) })}>Quitar</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="ch"><h2>Clawback</h2><span>Descuento de comisión ya pagada</span></div>
        <div className="cb form">
          <Campo label="Plazo para el primer pago (días)" ayuda="Si el cliente instalado no paga nada en este plazo, se descuenta el 100% de la comisión. Si paga después, se devuelve.">
            <input type="number" value={f.plazo_pago_dias} onChange={set('plazo_pago_dias')} />
          </Campo>
          <div className="campo">
            <label>Por baja del cliente (% a devolver según mes)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {f.clawback_baja.map((x, i) => (
                <div key={i} style={{ width: 90 }}>
                  <input type="number" value={x} onChange={(e) => setCb(i, e.target.value)} />
                  <span className="ayuda">Mes {i + 1}</span>
                </div>
              ))}
              <button className="btn chico" onClick={() => setF({ ...f, clawback_baja: [...f.clawback_baja, 0] })}>+ Mes</button>
              {f.clawback_baja.length > 1 && <button className="btn chico" onClick={() => setF({ ...f, clawback_baja: f.clawback_baja.slice(0, -1) })}>− Mes</button>}
            </div>
            <span className="ayuda">Después del último mes no se descuenta. Las bajas por “Causa Disatel / excepción” nunca descuentan.</span>
          </div>
        </div>
      </div>
    </>
  )
}
