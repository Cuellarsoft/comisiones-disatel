import { useState } from 'react'
import { supabase } from './supabase'
import { Cabecera, Campo, Error, useApp } from './ui'
import { CONFIG_BASE, nombreTramo, normalizarConfig } from './tarifas'

const FILAS = [
  ['equipo', 'Equipo GPS (venta, pago único)', 'Bs'],
  ['mes', 'Monitoreo mensual', 'Bs'],
  ['roaming', 'Monitoreo mensual con roaming', 'Bs'],
  ['descSemestral', 'Descuento por pago semestral', '%'],
  ['descAnual', 'Descuento por pago anual', '%'],
]
const pctA = (x) => Math.round(Number(x) * 10000) / 100
const aForm = (c) => ({
  ...c,
  planes: Object.fromEntries(Object.entries(c.planes).map(([k, p]) => [k, {
    ...p, condicionesTexto: p.condiciones.join('\n'),
    tramos: p.tramos.map((t) => ({ ...t, descSemestral: pctA(t.descSemestral), descAnual: pctA(t.descAnual) })),
  }])),
  accesorios: c.accesorios.map((a) => ({ ...a })),
})
const deForm = (f) => normalizarConfig({
  ...f,
  planes: Object.fromEntries(Object.entries(f.planes).map(([k, p]) => [k, {
    limite: p.limite,
    condiciones: String(p.condicionesTexto || '').split('\n').map((x) => x.trim()).filter(Boolean),
    tramos: p.tramos.map((t) => ({ ...t, descSemestral: Number(t.descSemestral) / 100, descAnual: Number(t.descAnual) / 100 })),
  }])),
})

export default function ConfigCotizaciones() {
  const { configCot, cargarConfigCot } = useApp()
  const [f, setF] = useState(() => aForm(configCot))
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [guardando, setGuardando] = useState(false)

  const setGen = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const setPlan = (pk, k, v) => setF((x) => ({ ...x, planes: { ...x.planes, [pk]: { ...x.planes[pk], [k]: v } } }))
  const setTramo = (pk, i, k, v) => setF((x) => {
    const p = x.planes[pk]
    return { ...x, planes: { ...x.planes, [pk]: { ...p, tramos: p.tramos.map((t, j) => (j === i ? { ...t, [k]: v } : t)) } } }
  })
  const setAcc = (i, k, v) => setF((x) => ({ ...x, accesorios: x.accesorios.map((a, j) => (j === i ? { ...a, [k]: v } : a)) }))
  const agregarAcc = () => setF((x) => ({ ...x, accesorios: [...x.accesorios, { id: 'acc-' + Date.now().toString(36), nombre: '', precio: '' }] }))
  const quitarAcc = (i) => setF((x) => ({ ...x, accesorios: x.accesorios.filter((_, j) => j !== i) }))

  async function guardar() {
    setErr(''); setOk('')
    for (const [, p] of Object.entries(f.planes)) {
      for (const t of p.tramos) for (const [k] of FILAS) {
        if (t[k] === '' || isNaN(Number(t[k])) || Number(t[k]) < 0) return setErr(`Revisa los precios de ${p.nombre}: hay un valor vacío o negativo.`)
      }
      if (Number(p.limite) < 1) return setErr(`El primer tramo de ${p.nombre} debe ser de al menos 1 vehículo.`)
    }
    if (f.accesorios.some((a) => String(a.nombre).trim() && (a.precio === '' || Number(a.precio) < 0))) return setErr('Cada accesorio necesita un precio.')
    setGuardando(true)
    const datos = deForm(f)
    const { error } = await supabase.from('config_cotizaciones').upsert({ id: 1, datos })
    setGuardando(false)
    if (error) return setErr(error.message)
    await cargarConfigCot()
    setF(aForm(datos))
    setOk('Configuración guardada. Ya se usa en las cotizaciones nuevas y en las que todavía no se vendieron.')
  }

  function restaurar() {
    setF(aForm(CONFIG_BASE)); setOk(''); setErr('')
  }

  return (
    <>
      <Cabecera titulo="Precios y condiciones" sub="Lo que cambies aquí se usa en las cotizaciones nuevas y en las que no se vendieron. Las vendidas conservan sus precios.">
        <button className="btn" onClick={restaurar}>Volver a los valores iniciales</button>
        <button className="btn primario" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button>
      </Cabecera>
      <Error msg={err} />
      {ok && <div className="ok">{ok}</div>}

      <div className="grid cfg-planes">
        {Object.entries(f.planes).map(([pk, p]) => (
          <div className="card" key={pk}>
            <div className="ch"><h2>{p.nombre}</h2><span>{p.equipo === 'venta' ? 'Equipo en venta' : 'Equipo en comodato'}</span></div>
            <div className="cb">
              <div className="cfg-limite">
                Primer tramo: de 1 a
                <input type="number" min="1" value={p.limite} onChange={(e) => setPlan(pk, 'limite', e.target.value)} />
                vehículos; el segundo tramo es de {Number(p.limite || 0) + 1} en adelante.
              </div>
              <div className="tabla-wrap"><table className="cfg-tabla">
                <thead><tr><th>Concepto</th>{p.tramos.map((_, i) => <th key={i} className="r">{nombreTramo({ limite: Number(p.limite) || 0 }, i)}</th>)}</tr></thead>
                <tbody>{FILAS.filter(([k]) => !(k === 'equipo' && p.equipo === 'comodato')).map(([k, label, u]) => (
                  <tr key={k}>
                    <td>{label}</td>
                    {p.tramos.map((t, i) => (
                      <td key={i} className="r">
                        <span className="cfg-celda"><input type="number" min="0" step={u === '%' ? '0.5' : '1'} value={t[k]} onChange={(e) => setTramo(pk, i, k, e.target.value)} /><small>{u}</small></span>
                      </td>
                    ))}
                  </tr>
                ))}
                {p.equipo === 'comodato' && <tr><td>Equipo GPS</td><td colSpan={p.tramos.length} className="r sub-gris">En comodato, sin costo</td></tr>}
                </tbody>
              </table></div>
              <Campo label="Condiciones que salen en el PDF (una por línea)" ayuda="Además se agregan solas: el contrato mínimo y que los precios están en bolivianos.">
                <textarea rows="4" value={p.condicionesTexto} onChange={(e) => setPlan(pk, 'condicionesTexto', e.target.value)} />
              </Campo>
            </div>
          </div>
        ))}
      </div>

      <div className="grid dos">
        <div className="card">
          <div className="ch"><h2>Accesorios</h2><span>{f.accesorios.length} en la lista</span></div>
          <div className="tabla-wrap"><table className="cfg-tabla">
            <thead><tr><th>Accesorio</th><th className="r">Precio unitario</th><th></th></tr></thead>
            <tbody>
              {f.accesorios.map((a, i) => (
                <tr key={a.id}>
                  <td><input type="text" value={a.nombre} placeholder="Nombre del accesorio" onChange={(e) => setAcc(i, 'nombre', e.target.value)} /></td>
                  <td className="r"><span className="cfg-celda"><input type="number" min="0" value={a.precio} onChange={(e) => setAcc(i, 'precio', e.target.value)} /><small>Bs</small></span></td>
                  <td className="r"><button className="btn chico peligro" onClick={() => quitarAcc(i)}>Quitar</button></td>
                </tr>
              ))}
              {!f.accesorios.length && <tr><td colSpan="3" className="vacio">Sin accesorios. Agrega el primero.</td></tr>}
            </tbody>
          </table></div>
          <div className="cb"><button className="btn" onClick={agregarAcc}>+ Agregar accesorio</button></div>
        </div>

        <div className="card">
          <div className="ch"><h2>Generales</h2></div>
          <div className="cb form">
            <Campo label="Validez de la cotización (días)" full><input type="number" min="1" value={f.validezDias} onChange={setGen('validezDias')} /></Campo>
            <Campo label="Contrato mínimo (meses)" full><input type="number" min="1" value={f.contratoMeses} onChange={setGen('contratoMeses')} /></Campo>
            <Campo label="Permitir bonificar accesorios con más de (vehículos)" ayuda="Arriba de esta cantidad, el vendedor puede dejar los accesorios sin costo." full>
              <input type="number" min="0" value={f.umbralBonificar} onChange={setGen('umbralBonificar')} />
            </Campo>
          </div>
        </div>
      </div>

      <div className="cfg-pie">
        <button className="btn primario" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </>
  )
}
