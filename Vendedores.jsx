import { useEffect, useState } from 'react'
import { supabase, adminUsuarios } from './supabase'
import { Cabecera, Cargando, Campo, Error, Modal, useApp } from './ui'
import { bs, fdate } from './lib'

const genPass = () => 'Disatel-' + Math.random().toString(36).slice(2, 7) + Math.floor(10 + Math.random() * 89)

export default function Vendedores() {
  const { perfil, params } = useApp()
  const [lista, setLista] = useState(null)
  const [edit, setEdit] = useState(null)
  const [msg, setMsg] = useState('')

  async function cargar() {
    const { data } = await supabase.from('profiles').select('*').order('activo', { ascending: false }).order('nombre')
    setLista(data || [])
  }
  useEffect(() => { cargar() }, [])
  if (!lista) return <Cargando />

  return (
    <>
      <Cabecera titulo="Vendedores" sub="Cada vendedor entra con su correo y solo ve sus propias ventas y comisiones">
        <button className="btn primario" onClick={() => setEdit({})}>+ Nuevo vendedor</button>
      </Cabecera>
      {msg && <div className="ok">{msg}</div>}
      <div className="card"><div className="tabla-wrap"><table>
        <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th className="r">Sueldo fijo</th><th>Alta</th><th>Estado</th></tr></thead>
        <tbody>{lista.map((p) => (
          <tr key={p.id} className="click" onClick={() => setEdit(p)}>
            <td><b>{p.nombre}</b>{p.id === perfil.id && <span className="sub">Tú</span>}</td>
            <td>{p.email}</td>
            <td>{p.rol === 'admin' ? 'Administrador' : 'Vendedor'}</td>
            <td className="r num">{bs(p.sueldo_fijo)}</td>
            <td>{fdate(p.created_at)}</td>
            <td>{p.activo ? <span className="chip verde">Activo</span> : <span className="chip gris">Inactivo</span>}</td>
          </tr>
        ))}</tbody>
      </table></div></div>
      {edit && <UsuarioModal u={edit} yo={perfil} sueldoDef={params.sueldo_fijo_default}
        onClose={() => setEdit(null)} onDone={(m) => { setEdit(null); setMsg(m || ''); cargar() }} />}
    </>
  )
}

function UsuarioModal({ u, yo, sueldoDef, onClose, onDone }) {
  const nuevo = !u.id
  const [f, setF] = useState({ nombre: u.nombre || '', email: u.email || '', rol: u.rol || 'vendedor', sueldo_fijo: u.sueldo_fijo ?? sueldoDef, password: nuevo ? genPass() : '' })
  const [err, setErr] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function correr(fn) {
    setErr(''); setOcupado(true)
    try { await fn() } catch (e) { setErr(e.message) }
    setOcupado(false)
  }

  const guardar = () => correr(async () => {
    if (nuevo) {
      await adminUsuarios({ action: 'crear', ...f, sueldo_fijo: Number(f.sueldo_fijo) })
      return onDone(`Usuario creado. Pásale a ${f.nombre}: correo ${f.email.trim().toLowerCase()} · contraseña ${f.password}`)
    }
    const { error } = await supabase.from('profiles').update({ nombre: f.nombre, rol: u.id === yo.id ? u.rol : f.rol, sueldo_fijo: Number(f.sueldo_fijo) }).eq('id', u.id)
    if (error) throw error
    if (f.email.trim().toLowerCase() !== u.email) await adminUsuarios({ action: 'email', user_id: u.id, email: f.email })
    if (f.password) {
      await adminUsuarios({ action: 'password', user_id: u.id, password: f.password })
      return onDone(`Datos guardados. Nueva contraseña de ${f.nombre}: ${f.password}`)
    }
    onDone('Datos guardados')
  })

  const cambiarEstado = () => correr(async () => {
    await adminUsuarios({ action: 'estado', user_id: u.id, activo: !u.activo })
    onDone(u.activo ? `${u.nombre} ya no puede ingresar` : `${u.nombre} puede volver a ingresar`)
  })

  return (
    <Modal titulo={nuevo ? 'Nuevo vendedor' : u.nombre} onClose={onClose}
      pie={<>
        {!nuevo && u.id !== yo.id && <button className="btn peligro izq" onClick={cambiarEstado} disabled={ocupado}>{u.activo ? 'Desactivar acceso' : 'Reactivar acceso'}</button>}
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primario" onClick={guardar} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
      </>}>
      <Error msg={err} />
      <div className="form">
        <Campo label="Nombre completo" full><input type="text" value={f.nombre} onChange={set('nombre')} autoFocus /></Campo>
        <Campo label="Correo (usuario para ingresar)" full><input type="email" value={f.email} onChange={set('email')} /></Campo>
        <Campo label="Rol">
          <select value={f.rol} onChange={set('rol')} disabled={u.id === yo.id}>
            <option value="vendedor">Vendedor</option><option value="admin">Administrador</option>
          </select>
        </Campo>
        <Campo label="Sueldo fijo (Bs)"><input type="number" value={f.sueldo_fijo} onChange={set('sueldo_fijo')} /></Campo>
        <Campo label={nuevo ? 'Contraseña inicial' : 'Nueva contraseña'} full ayuda={nuevo ? 'Compártela con el vendedor; puede cambiarla en “Mi cuenta”' : 'Déjala vacía para no cambiarla'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" value={f.password} onChange={set('password')} />
            <button type="button" className="btn" onClick={() => setF({ ...f, password: genPass() })}>Generar</button>
          </div>
        </Campo>
      </div>
    </Modal>
  )
}
