import logo from './logo.png'
import { useState } from 'react'
import { supabase } from './supabase'
import { Campo, Error } from './ui'

export default function Login() {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [cargando, setCargando] = useState(false)

  async function entrar(e) {
    e.preventDefault()
    setErr(''); setCargando(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pass })
    setCargando(false)
    if (error) setErr(error.message.includes('Invalid') ? 'Correo o contraseña incorrectos' : error.message)
  }

  return (
    <div className="login">
      <div className="caja">
        <img src={logo} alt="Disatel" />
        <div className="tit">Departamento de Ventas</div>
        <form className="card" onSubmit={entrar}>
          <Error msg={err} />
          <Campo label="Correo"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></Campo>
          <Campo label="Contraseña"><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} required /></Campo>
          <button className="btn primario" disabled={cargando}>{cargando ? 'Ingresando…' : 'Ingresar'}</button>
        </form>
      </div>
    </div>
  )
}
