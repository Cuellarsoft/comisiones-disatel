import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { Cabecera, Error, useApp } from './ui'

export const COLORES = { gris: 'Gris', rojo: 'Rojo', ambar: 'Ámbar', verde: 'Verde', azul: 'Azul', morado: 'Morado' }
const agrupar = (xs) => xs.reduce((m, e) => ((m[e.grupo] ||= []).push(e), m), {})

// ---------- Configuración (solo administrador)
export default function ConfigEtiquetas() {
  const { etiquetasTodas, cargarEtiquetas } = useApp()
  const [filas, setFilas] = useState(() => etiquetasTodas.map((e) => ({ ...e })))
  const [nueva, setNueva] = useState({ grupo: etiquetasTodas[0]?.grupo || 'Producto', nombre: '', color: 'gris' })
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [guardando, setGuardando] = useState(false)
  const grupos = useMemo(() => [...new Set(filas.map((f) => f.grupo))], [filas])
  const set = (id, k, v) => setFilas((xs) => xs.map((x) => (x.id === id ? { ...x, [k]: v } : x)))

  async function guardar() {
    setErr(''); setOk('')
    if (filas.some((f) => !f.nombre.trim() || !f.grupo.trim())) return setErr('Cada etiqueta necesita grupo y nombre.')
    const claves = filas.map((f) => (f.grupo.trim() + '|' + f.nombre.trim()).toLowerCase())
    if (new Set(claves).size !== claves.length) return setErr('Hay dos etiquetas con el mismo nombre en un mismo grupo.')
    setGuardando(true)
    for (const [i, f] of filas.entries()) {
      const { error } = await supabase.from('etiquetas').update({
        grupo: f.grupo.trim(), nombre: f.nombre.trim(), color: f.color, de_cotizacion: f.de_cotizacion, activo: f.activo, orden: i + 1,
      }).eq('id', f.id)
      if (error) { setGuardando(false); return setErr(error.message) }
    }
    setGuardando(false)
    await cargarEtiquetas()
    setOk('Etiquetas guardadas.')
  }

  async function agregar() {
    setErr(''); setOk('')
    const grupo = nueva.grupo.trim() || 'General', nombre = nueva.nombre.trim()
    if (!nombre) return setErr('Escribe el nombre de la etiqueta.')
    if (filas.some((f) => f.grupo.toLowerCase() === grupo.toLowerCase() && f.nombre.toLowerCase() === nombre.toLowerCase())) return setErr('Esa etiqueta ya existe en ese grupo.')
    const { data, error } = await supabase.from('etiquetas').insert({ grupo, nombre, color: nueva.color, orden: filas.length + 1 }).select('*').single()
    if (error) return setErr(error.message)
    setFilas((xs) => [...xs, data]); setNueva((n) => ({ ...n, nombre: '' }))
    await cargarEtiquetas()
  }

  return (
    <>
      <Cabecera titulo="Etiquetas" sub="Para clasificar clientes por producto, tamaño o lo que necesites, y filtrar el embudo">
        <button className="btn primario" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button>
      </Cabecera>
      <Error msg={err} />
      {ok && <div className="ok">{ok}</div>}

      <div className="card">
        <div className="ch"><h2>Nueva etiqueta</h2></div>
        <div className="cb etq-nueva">
          <input type="text" list="etq-grupos" value={nueva.grupo} placeholder="Grupo, ej.: Producto" onChange={(e) => setNueva({ ...nueva, grupo: e.target.value })} />
          <datalist id="etq-grupos">{grupos.map((g) => <option key={g} value={g} />)}</datalist>
          <input type="text" value={nueva.nombre} placeholder="Nombre, ej.: Sensores de combustible" onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && agregar()} />
          <select value={nueva.color} onChange={(e) => setNueva({ ...nueva, color: e.target.value })}>{Object.entries(COLORES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
          <button className="btn" onClick={agregar}>+ Agregar</button>
        </div>
      </div>

      {grupos.map((g) => (
        <div className="card" key={g}>
          <div className="ch"><h2>{g}</h2><span>{filas.filter((f) => f.grupo === g).length} etiquetas</span></div>
          <div className="tabla-wrap"><table className="cfg-tabla">
            <thead><tr><th>Etiqueta</th><th>Grupo</th><th>Color</th><th>Al enviar una cotización</th><th>Estado</th></tr></thead>
            <tbody>{filas.filter((f) => f.grupo === g).map((f) => (
              <tr key={f.id}>
                <td><span className="etq-fila"><span className={'crm-etq c-' + f.color}>{f.nombre || '—'}</span><input type="text" value={f.nombre} onChange={(e) => set(f.id, 'nombre', e.target.value)} /></span></td>
                <td><input type="text" list="etq-grupos" value={f.grupo} onChange={(e) => set(f.id, 'grupo', e.target.value)} style={{ maxWidth: 160 }} /></td>
                <td><select value={f.color} onChange={(e) => set(f.id, 'color', e.target.value)} style={{ width: 'auto' }}>{Object.entries(COLORES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>
                <td><label className="check"><input type="checkbox" checked={f.de_cotizacion} onChange={(e) => set(f.id, 'de_cotizacion', e.target.checked)} /> Ponerla sola</label></td>
                <td><label className="check"><input type="checkbox" checked={f.activo} onChange={(e) => set(f.id, 'activo', e.target.checked)} /> {f.activo ? 'Activa' : 'Oculta'}</label></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ))}
      <p className="crm-sub">“Ponerla sola”: los clientes que reciben una cotización quedan con esa etiqueta (por ejemplo, GPS vehicular). Una etiqueta oculta ya no se puede elegir, pero los clientes que la tienen la conservan.</p>
    </>
  )
}

// ---------- Elegir etiquetas en el formulario del cliente
export function ElegirEtiquetas({ valor, onChange }) {
  const { etiquetas } = useApp()
  const sel = new Set(valor || [])
  const grupos = agrupar(etiquetas)
  const cambiar = (id) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); onChange([...s]) }
  return (
    <div className="etq-elegir">
      {Object.entries(grupos).map(([g, xs]) => (
        <div key={g} className="etq-grupo">
          <span className="etq-grupo-nom">{g}</span>
          <div>{xs.map((e) => (
            <button type="button" key={e.id} className={'crm-etq c-' + e.color + (sel.has(e.id) ? ' on' : '')} aria-pressed={sel.has(e.id)} onClick={() => cambiar(e.id)}>
              {sel.has(e.id) ? '✓ ' : ''}{e.nombre}
            </button>
          ))}</div>
        </div>
      ))}
      {!etiquetas.length && <span className="crm-sub">Todavía no hay etiquetas. El administrador las crea en Configuración › Etiquetas.</span>}
    </div>
  )
}

// ---------- Etiquetas de un cliente (tarjetas, listas, ficha)
export function EtiquetasCliente({ ids }) {
  const { etiquetasTodas } = useApp()
  const xs = (ids || []).map((id) => etiquetasTodas.find((e) => e.id === id)).filter(Boolean)
  if (!xs.length) return null
  return <span className="crm-etiquetas">{xs.map((e) => <span key={e.id} className={'crm-etq c-' + e.color}>{e.nombre}</span>)}</span>
}

// ---------- Filtro por etiquetas, con la cantidad de clientes de cada una
export function FiltroEtiquetas({ clientes, sel, setSel }) {
  const { etiquetasTodas } = useApp()
  const usadas = etiquetasTodas.filter((e) => e.activo || clientes.some((c) => (c.etiquetas || []).includes(e.id)))
  if (!usadas.length) return null
  const grupos = agrupar(usadas)
  const cambiar = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id])
  return (
    <div className="etq-filtro" role="group" aria-label="Filtrar por etiquetas">
      {Object.entries(grupos).map(([g, xs]) => (
        <div key={g} className="etq-filtro-fila">
          <span className="etq-grupo-nom">{g}</span>
          {xs.map((e) => {
            const n = clientes.filter((c) => (c.etiquetas || []).includes(e.id)).length
            return (
              <button key={e.id} className={'crm-etq c-' + e.color + (sel.includes(e.id) ? ' on' : '')} aria-pressed={sel.includes(e.id)} onClick={() => cambiar(e.id)}>
                {e.nombre} <b>{n}</b>
              </button>
            )
          })}
        </div>
      ))}
      {sel.length > 0 && <button className="etq-limpiar" onClick={() => setSel([])}>Quitar filtros</button>}
    </div>
  )
}
