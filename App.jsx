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
import ListaCotizaciones from './ListaCotizaciones'

const COMISIONES_ADMIN = [
  ['resumen', 'Resumen', ResumenAdmin],
  ['ventas', 'Ventas', Ventas],
  ['cobranza', 'Cobranza', Cobranza],
  ['clawbacks', 'Clawbacks', Clawbacks],
  ['liquidaciones', 'Liquidaciones', Liquidaciones],
  ['historial', 'Historial', Historial],
  ['sep', 'Configuración'],
  ['vendedores', 'Vendedores', Vendedores],
  ['parametros', 'Parámetros', Parametros],
  ['cuenta', 'Mi cuenta', MiCuenta],
]
const COMISIONES_VENDEDOR = [
  ['resumen', 'Mi resumen', MiResumen],
  ['ventas', 'Mis ventas', Ventas],
  ['clawbacks', 'Mis descuentos', Clawbacks],
  ['liquidaciones', 'Mis liquidaciones', Liquidaciones],
  ['cuenta', 'Mi cuenta', MiCuenta],
]
const COTIZACIONES = (admin) => [
  ['cot-nueva', 'Nueva cotización', Cotizaciones],
  ['cot-lista', admin ? 'Todas las cotizaciones' : 'Mis cotizaciones', ListaCotizaciones],
]

function Inicio({ perfil, ir, salir }) {
  return (
    <div className="inicio">
      <div className="inicio-caja">
        <img src={logo} alt="Disatel" className="inicio-logo" />
        <div className="inicio-tit">Departamento de Ventas</div>
        <h1>Hola, {perfil.nombre.split(' ')[0]}. ¿Qué quieres hacer?</h1>
        <div className="inicio-opciones">
          <button className="opcion" onClick={() => ir('cot-nueva')}>
            <span className="op-icono" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg>
            </span>
            <b>Cotizaciones</b>
            <span>Arma la propuesta en PDF y envíala por WhatsApp o correo.</span>
          </button>
          <button className="opcion" onClick={() => ir('resumen')}>
            <span className="op-icono" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
            </span>
            <b>Comisiones</b>
            <span>{perfil.rol === 'admin' ? 'Ventas, cobranza, clawbacks y liquidaciones del equipo.' : 'Tus ventas, tus comisiones y tus liquidaciones.'}</span>
          </button>
        </div>
        <button className="inicio-salir" onClick={salir}>Cerrar sesión</button>
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [perfil, setPerfil] = useState(undefined)
  const [params, setParams] = useState(null)
  const [pag, setPag] = useState(() => location.hash.slice(1) || 'inicio')
  const [cotAbrir, setCotAbrir] = useState(null)

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
    const h = () => setPag(location.hash.slice(1) || 'inicio')
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
          <p>Este usuario no tiene acceso a la plataforma de ventas.</p>
          <button className="btn" onClick={salir}>Salir</button>
        </div>
      </div></div>
    )
  }

  const admin = perfil.rol === 'admin'
  if (pag === 'inicio') return <Inicio perfil={perfil} ir={ir} salir={salir} />

  const enCot = pag.startsWith('cot-')
  const menu = enCot ? COTIZACIONES(admin) : admin ? COMISIONES_ADMIN : COMISIONES_VENDEDOR
  const actual = menu.find((m) => m[0] === pag && m[2]) || menu[0]
  const Pagina = actual[2]
  const abrirCotizacion = (c) => { setCotAbrir(c); ir('cot-nueva') }

  return (
    <Ctx.Provider value={{ perfil, params, cargarParams, ir, cotAbrir, setCotAbrir, abrirCotizacion }}>
      <div className="app">
        <aside className="side no-print">
          <div className="marca">
            <img src={logo} alt="Disatel" />
            <small>{enCot ? 'Cotizaciones' : 'Comisiones'}</small>
          </div>
          <nav>
            <button className="volver" onClick={() => ir('inicio')}>← Inicio</button>
            {menu.map(([k, t, C]) => C
              ? <button key={k} className={actual[0] === k ? 'on' : ''} onClick={() => { if (k === 'cot-nueva') setCotAbrir(null); ir(k) }}>{t}</button>
              : <div key={k} className="sep">{t}</div>)}
          </nav>
          <div className="yo">
            <div><b>{perfil.nombre}</b>{admin ? 'Administrador' : 'Ejecutivo de ventas'}</div>
            <button onClick={salir}>Cerrar sesión</button>
          </div>
        </aside>
        <main className="main">
          <Pagina key={actual[0] + (actual[0] === 'cot-nueva' ? (cotAbrir?.id || 'n') : '')} />
        </main>
      </div>
    </Ctx.Provider>
  )
}
