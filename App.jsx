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
import ConfigCotizaciones from './ConfigCotizaciones'
import { Embudo, Seguimientos as SeguimientosCrm, ListaClientes, PanelClientes } from './Clientes'
import ConfigWhatsapp from './ConfigWhatsapp'
import ConfigEtiquetas from './Etiquetas'
import { CONFIG_BASE, normalizarConfig } from './tarifas'

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
  ...(admin ? [['sep', 'Configuración'], ['cot-config', 'Precios y condiciones', ConfigCotizaciones]] : []),
]

const CLIENTES = (admin) => [
  ['cli-embudo', 'Embudo de ventas', Embudo],
  ['cli-seguimientos', 'Seguimientos', SeguimientosCrm],
  ['cli-lista', admin ? 'Todos los clientes' : 'Mis clientes', ListaClientes],
  ...(admin ? [['cli-panel', 'Panel del equipo', PanelClientes], ['sep', 'Configuración'], ['cli-etiquetas', 'Etiquetas', ConfigEtiquetas], ['cli-whatsapp', 'WhatsApp', ConfigWhatsapp]] : []),
]

function Inicio({ perfil, ir, salir }) {
  return (
    <div className="inicio">
      <div className="inicio-caja">
        <img src={logo} alt="Disatel" className="inicio-logo" />
        <div className="inicio-tit">Departamento de Ventas</div>
        <h1>Hola, {perfil.nombre.split(' ')[0]}. ¿Qué quieres hacer?</h1>
        <div className="inicio-opciones tres">
          <button className="opcion" onClick={() => ir('cli-embudo')}>
            <span className="op-icono" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.9 2.7 2.6 3 5.2" /></svg>
            </span>
            <b>Clientes</b>
            <span>{perfil.rol === 'admin' ? 'Prospectos, seguimientos, WhatsApp y el embudo del equipo.' : 'Tus prospectos, seguimientos y conversaciones de WhatsApp.'}</span>
          </button>
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
  const [configCot, setConfigCot] = useState(CONFIG_BASE)
  const [etiquetasTodas, setEtiquetasTodas] = useState([])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const cargarConfigCot = useCallback(async () => {
    const { data } = await supabase.from('config_cotizaciones').select('datos').eq('id', 1).maybeSingle()
    setConfigCot(normalizarConfig(data?.datos))
  }, [])

  const cargarEtiquetas = useCallback(async () => {
    const { data } = await supabase.from('etiquetas').select('*').order('orden').order('id')
    setEtiquetasTodas(data || [])
  }, [])

  const cargarParams = useCallback(async () => {
    const { data } = await supabase.from('parametros').select('*').eq('id', 1).single()
    setParams(data)
  }, [])

  useEffect(() => {
    if (!session) { setPerfil(session === null ? null : undefined); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(({ data }) => setPerfil(data || null))
    cargarParams()
    cargarConfigCot()
    cargarEtiquetas()
  }, [session?.user?.id, cargarParams, cargarConfigCot, cargarEtiquetas])

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

  const area = pag.startsWith('cot-') ? 'cot' : pag.startsWith('cli-') ? 'cli' : 'com'
  const menu = area === 'cot' ? COTIZACIONES(admin) : area === 'cli' ? CLIENTES(admin) : admin ? COMISIONES_ADMIN : COMISIONES_VENDEDOR
  const actual = menu.find((m) => m[0] === pag && m[2]) || menu[0]
  const Pagina = actual[2]
  const abrirCotizacion = (c) => { setCotAbrir(c); ir('cot-nueva') }

  return (
    <Ctx.Provider value={{ perfil, params, cargarParams, ir, cotAbrir, setCotAbrir, abrirCotizacion, configCot, cargarConfigCot, etiquetasTodas, etiquetas: etiquetasTodas.filter((e) => e.activo), cargarEtiquetas }}>
      <div className="app">
        <aside className="side no-print">
          <div className="marca">
            <img src={logo} alt="Disatel" />
            <small>{{ cot: 'Cotizaciones', cli: 'Clientes', com: 'Comisiones' }[area]}</small>
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
          <Pagina key={actual[0] + (actual[0] === 'cot-nueva' ? (cotAbrir?.id || (cotAbrir?.cliente_id ? 'c' + cotAbrir.cliente_id : 'n')) : '')} />
        </main>
      </div>
    </Ctx.Provider>
  )
}
