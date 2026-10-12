import { useState } from 'react'
import { supabase } from '../supabase'
import { Cabecera, Campo, Error, useApp } from '../components/ui'
import { bs } from '../lib'

export default function MiCuenta() {
  const { perfil } = useApp()
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  async function cambiar(e) {
    e.preventDefault()
    setErr(''); setOk('')
    if (p1.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres')
    if (p1 !== p2) return setErr('Las contraseñas no coinciden')
    const { error } = await supabase.auth.updateUser({ password: p1 })
    if (error) return setErr(error.message)
    setP1(''); setP2(''); setOk('Contraseña actualizada')
  }

  return (
    <>
      <Cabecera titulo="Mi cuenta" />
      <div className="grid dos">
        <div className="card">
          <div className="ch"><h2>Datos</h2></div>
          <div className="cb resumen-liq">
            <div className="f"><span>Nombre</span><b>{perfil.nombre}</b></div>
            <div className="f"><span>Correo</span><b>{perfil.email}</b></div>
            <div className="f"><span>Rol</span><b>{perfil.rol === 'admin' ? 'Administrador' : 'Ejecutivo de ventas'}</b></div>
            <div className="f" style={{ borderBottom: 0 }}><span>Sueldo fijo</span><b className="num">{bs(perfil.sueldo_fijo)}</b></div>
          </div>
        </div>
        <form className="card" onSubmit={cambiar}>
          <div className="ch"><h2>Cambiar contraseña</h2></div>
          <div className="cb" style={{ display: 'grid', gap: 14 }}>
            <Error msg={err} />
            {ok && <div className="ok">{ok}</div>}
            <Campo label="Nueva contraseña"><input type="password" value={p1} onChange={(e) => setP1(e.target.value)} /></Campo>
            <Campo label="Repetir contraseña"><input type="password" value={p2} onChange={(e) => setP2(e.target.value)} /></Campo>
            <div><button className="btn primario">Guardar contraseña</button></div>
          </div>
        </form>
      </div>
    </>
  )
}
