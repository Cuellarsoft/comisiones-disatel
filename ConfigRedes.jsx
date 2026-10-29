import { useEffect, useState } from 'react'
import { supabase, SUPABASE_URL } from './supabase'
import { Cabecera, Campo, Cargando, Error, Modal } from './ui'
import { RED } from './crmLib'
import { ChipRed } from './ChatRedes'

const WEBHOOK = `${SUPABASE_URL}/functions/v1/redes-webhook`

// Página de Facebook y cuenta de Instagram conectadas, y a qué vendedor va lo que llega
export default function ConfigRedes() {
  const [d, setD] = useState(null)
  const [edit, setEdit] = useState(null)
  const [err, setErr] = useState('')
  const [copiado, setCopiado] = useState('')

  async function cargar() {
    const [c, p, m] = await Promise.all([
      supabase.from('redes_cuentas').select('*').order('id'),
      supabase.from('profiles').select('id, nombre, activo').order('nombre'),
      supabase.from('redes_mensajes').select('cuenta_id, fecha').order('fecha', { ascending: false }).limit(200),
    ])
    if (c.error) setErr(c.error.message)
    setD({ cuentas: c.data || [], perfiles: p.data || [], msgs: m.data || [] })
  }
  useEffect(() => { cargar() }, [])
  if (!d) return <Cargando />
  const nombre = (id) => d.perfiles.find((p) => p.id === id)?.nombre || 'Sin asignar'
  const ultimo = (id) => d.msgs.find((m) => m.cuenta_id === id)?.fecha
  async function copiar(t, k) {
    try { await navigator.clipboard.writeText(t); setCopiado(k); setTimeout(() => setCopiado(''), 1500) } catch { /* sin portapapeles */ }
  }

  return (
    <>
      <Cabecera titulo="Facebook e Instagram" sub="Cuentas conectadas y quién atiende los mensajes y comentarios">
        <button className="btn primario" onClick={() => setEdit({})}>+ Agregar cuenta</button>
      </Cabecera>
      <Error msg={err} />
      <div className="card">
        <div className="tabla-wrap"><table>
          <thead><tr><th>Cuenta</th><th>Red</th><th>Atiende</th><th>Último aviso</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {d.cuentas.map((c) => (
              <tr key={c.id}>
                <td><b>{c.nombre}</b><span className="sub">ID {c.cuenta_id}</span></td>
                <td><ChipRed p={c.plataforma} /></td>
                <td>{nombre(c.vendedor_id)}</td>
                <td>{ultimo(c.id) ? new Date(ultimo(c.id)).toLocaleString('es-BO') : 'Sin avisos todavía'}</td>
                <td>{c.activo ? <span className="chip verde">Activa</span> : <span className="chip gris">Pausada</span>}</td>
                <td className="r"><button className="btn chico" onClick={() => setEdit(c)}>Editar</button></td>
              </tr>
            ))}
            {!d.cuentas.length && <tr><td colSpan="6" className="vacio">Todavía no hay cuentas conectadas.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="ch"><h2>Cómo conectar la página y el Instagram</h2></div>
        <div className="cb">
          <ol className="crm-pasos">
            <li>En <b>developers.facebook.com</b>, crea una app de tipo <b>Empresa</b> dentro de la cuenta comercial de Disatel y agrega los productos <b>Messenger</b> e <b>Instagram</b>.</li>
            <li>Conecta la página de Facebook de Disatel (y el Instagram vinculado a ella) y genera la <b>clave de acceso de la página</b>. Guárdala en Supabase › Edge Functions › Secrets como <code>FB_PAGINA_DISATEL</code>.</li>
            <li>Guarda también en Supabase la <b>clave secreta de la app</b> (Configuración › Básica) como <code>REDES_APP_SECRET</code>, y una palabra inventada por ti como <code>REDES_VERIFY_TOKEN</code>.</li>
            <li>En <b>Webhooks</b> de la app, pega la URL de abajo y la misma palabra de <code>REDES_VERIFY_TOKEN</code>. Suscribe la página a <code>messages, message_echoes, feed</code> e Instagram a <code>messages, comments</code>.</li>
            <li>Aquí, agrega dos cuentas: la página (Facebook) y el Instagram, cada una con su ID, el vendedor que atiende y el nombre del secreto.</li>
          </ol>
          <div className="wa-dato"><span>URL del webhook</span><code>{WEBHOOK}</code><button className="btn chico" onClick={() => copiar(WEBHOOK, 'url')}>{copiado === 'url' ? 'Copiado' : 'Copiar'}</button></div>
          <p className="crm-sub">Permisos que pide la app: pages_messaging, pages_manage_metadata, pages_read_engagement, pages_read_user_content, pages_manage_engagement, instagram_basic, instagram_manage_messages, instagram_manage_comments. Para recibir mensajes de cualquier persona, Meta puede pedir revisar la app.</p>
        </div>
      </div>

      {edit && <EditarCuenta c={edit} perfiles={d.perfiles} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); cargar() }} />}
    </>
  )
}

function EditarCuenta({ c, perfiles, onClose, onSaved }) {
  const [f, setF] = useState({ plataforma: c.plataforma || 'facebook', cuenta_id: c.cuenta_id || '', nombre: c.nombre || '', vendedor_id: c.vendedor_id || '', secreto: c.secreto || 'FB_PAGINA_DISATEL', activo: c.activo ?? true })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  async function guardar() {
    setErr('')
    const cuenta_id = f.cuenta_id.replace(/\D/g, '')
    if (!cuenta_id) return setErr('Escribe el ID de la cuenta (solo números).')
    if (!f.nombre.trim()) return setErr('Escribe un nombre para reconocer la cuenta.')
    const secreto = f.secreto.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9_]*$/.test(secreto) || secreto.startsWith('SUPABASE_')) return setErr('El nombre del secreto solo lleva letras, números y guion bajo (ej.: FB_PAGINA_DISATEL).')
    const fila = { plataforma: f.plataforma, cuenta_id, nombre: f.nombre.trim(), vendedor_id: f.vendedor_id || null, secreto, activo: f.activo }
    const { error } = c.id ? await supabase.from('redes_cuentas').update(fila).eq('id', c.id) : await supabase.from('redes_cuentas').insert(fila)
    error ? setErr(error.message.includes('duplicate') ? 'Esa cuenta ya está conectada.' : error.message) : onSaved()
  }
  return (
    <Modal titulo={c.id ? c.nombre : 'Agregar cuenta'} onClose={onClose}
      pie={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primario" onClick={guardar}>Guardar</button></>}>
      <Error msg={err} />
      <div className="form">
        <Campo label="Red" full>
          <div className="segmento">{Object.entries(RED).map(([k, t]) => <button key={k} type="button" className={f.plataforma === k ? 'on' : ''} onClick={() => setF((x) => ({ ...x, plataforma: k }))}>{t}</button>)}</div>
        </Campo>
        <Campo label={f.plataforma === 'facebook' ? 'ID de la página' : 'ID de la cuenta de Instagram'} ayuda={f.plataforma === 'facebook' ? 'En la página: Información › Transparencia, o en la app de Meta' : 'Instagram Business Account ID, en la app de Meta'}>
          <input type="text" inputMode="numeric" value={f.cuenta_id} onChange={set('cuenta_id')} />
        </Campo>
        <Campo label="Nombre" ayuda="Ej.: Disatel Bolivia"><input type="text" value={f.nombre} onChange={set('nombre')} /></Campo>
        <Campo label="Quién atiende" ayuda="Los mensajes y prospectos nuevos van a este vendedor">
          <select value={f.vendedor_id} onChange={set('vendedor_id')}><option value="">Sin asignar</option>{perfiles.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
        </Campo>
        <Campo label="Nombre del secreto con la clave de la página" ayuda="El mismo para Facebook e Instagram"><input type="text" value={f.secreto} onChange={set('secreto')} /></Campo>
        <label className="check full"><input type="checkbox" checked={f.activo} onChange={set('activo')} /> Cuenta activa</label>
      </div>
    </Modal>
  )
}
