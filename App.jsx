import logo from './logo.png'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Ctx, Cargando } from './ui'
import Login from './Login'
import ResumenAdmin from './ResumenAdmin'
import MiResumen from './MiResumen'
import Ventas from './Ventas'
import Cobranza from './Cobranza'
import Clawbacks from './Clawbacks'
import Liquidaciones from './Liquidaciones'
import Vendedores from './Vendedores'
import Parametros from './Parametros'
import MiCuenta from './MiCuenta'
import Historial from './Historial'
import Cotizaciones from './Cotizaciones'

const MENU_ADMIN = [
  ['resumen', 'Resumen', ResumenAdmin],
  ['ventas', 'Ventas', Ventas],
  ['cotizaciones', 'Cotizaciones', Cotizaciones],
  ['cobranza', 'Cobranza', Cobranza],
  ['clawbacks', 'Clawbacks', Clawbacks],
  ['liquidaciones', 'Liquidaciones', Liquidaciones],
  ['historial', 'Historial', Historial],
  ['sep', 'Configuración'],
  ['vendedores', 'Vendedores', Vendedores],
  ['parametros', 'Parámetros', Parametros],
  ['cuenta', 'Mi cuenta', MiCuenta],
]
const MENU_VENDEDOR = [
  ['resumen', 'Mi resumen', MiResumen],
  ['ventas', 'Mis ventas', Ventas],
  ['cotizaciones', 'Cotizaciones', Cotizaciones],
  ['clawbacks', 'Mis descuentos', Clawbacks],
  ['liquidaciones', 'Mis liquidaciones', Liquidaciones],
  ['cuenta', 'Mi cuenta', MiCuenta],
]

export default function App() {
  const [session, setSession] = useState(undefined)
  const [perfil, setPerfil] = useState(undefined)
  const [params, setParams] = useState(null)
  const [pag, setPag] = useState(() => location.hash.slice(1) || 'resumen')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const cargarParams = useCallback(async () => {
    const { data } = await supabase.from('parametros').select('*').eq('id', 1).single()
    setParams(data)
  }, [])

  useEffect(() => {
    if (!session) { setPerfil(session === null ? null : undefined); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(({ data }) => setPerfil(data || null))
    cargarParams()
  }, [session?.user?.id, cargarParams])

  useEffect(() => {
    const h = () => setPag(location.hash.slice(1) || 'resumen')
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])

  const ir = (p) => { location.hash = p; window.scrollTo(0, 0) }
  const salir = () => supabase.auth.signOut()

  if (session === undefined) return <Cargando />
  if (!session) return <Login />
  if (perfil === undefined || (perfil && !params)) return <Cargando />
  if (!perfil || !perfil.activo) {
    return (
      <div className="login"><div className="caja">
        <img src={logo} alt="Disatel" />
        <div className="card" style={{ textAlign: 'center' }}>
          <p>Este usuario no tiene acceso a la plataforma de comisiones.</p>
          <button className="btn" onClick={salir}>Salir</button>
        </div>
      </div></div>
    )
  }

  const menu = perfil.rol === 'admin' ? MENU_ADMIN : MENU_VENDEDOR
  const actual = menu.find((m) => m[0] === pag && m[2]) || menu[0]
  const Pagina = actual[2]

  return (
    <Ctx.Provider value={{ perfil, params, cargarParams, ir }}>
      <div className="app">
        <aside className="side no-print">
          <div className="marca">
            <img src={logo} alt="Disatel" />
            <small>Comisiones</small>
          </div>
          <nav>
            {menu.map(([k, t, C]) => C
              ? <button key={k} className={actual[0] === k ? 'on' : ''} onClick={() => ir(k)}>{t}</button>
              : <div key={k} className="sep">{t}</div>)}
          </nav>
          <div className="yo">
            <div><b>{perfil.nombre}</b>{perfil.rol === 'admin' ? 'Administrador' : 'Ejecutivo de ventas'}</div>
            <button onClick={salir}>Cerrar sesión</button>
          </div>
        </aside>
        <main className="main">
          <Pagina key={actual[0]} />
        </main>
      </div>
    </Ctx.Provider>
  )
}
