import { useEffect, useState } from 'react'
import { supabase, SUPABASE_URL } from './supabase'
import { Cabecera, Campo, Cargando, Error, Modal } from './ui'
import { whatsapp } from './crmLib'

const WEBHOOK = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`

export default function ConfigWhatsapp() {
  const [d, setD] = useState(null)
  const [edit, setEdit] = useState(null)
  const [err, setErr] = useState('')
  const [copiado, setCopiado] = useState('')
  const [ok, setOk] = useState('')
  const [conectando, setConectando] = useState(null)

  async function conectarWebhook(n) {
    setErr(''); setOk(''); setConectando(n.id)
    try { await whatsapp({ accion: 'webhook', numero_id: n.id }); setOk(`Listo: los mensajes de +${n.numero} ahora llegan a la plataforma.`) }
    catch (e) { setErr(e.message) } finally { setConectando(null) }
  }

  async function cargar() {
    const [n, p, m] = await Promise.all([
      supabase.from('wa_numeros').select('*').order('id'),
      supabase.from('profiles').select('id, nombre, activo').order('nombre'),
      supabase.from('wa_mensajes').select('wa_numero_id, fecha').order('fecha', { ascending: false }).limit(200),
    ])
    if (n.error) setErr(n.error.message)
    setD({ numeros: n.data || [], perfiles: p.data || [], msgs: m.data || [] })
  }
  useEffect(() => { cargar() }, [])
  if (!d) return <Cargando />
  const nombre = (id) => d.perfiles.find((p) => p.id === id)?.nombre || 'Sin asignar'
  const ultimo = (id) => d.msgs.find((m) => m.wa_numero_id === id)?.fecha

  async function copiar(t, k) {
    try { await navigator.clipboard.writeText(t); setCopiado(k); setTimeout(() => setCopiado(''), 1500) } catch { /* sin portapapeles */ }
  }

  return (
    <>
      <Cabecera titulo="WhatsApp" sub="Números conectados y a qué vendedor pertenecen sus conversaciones">
        <button className="btn primario" onClick={() => setEdit({})}>+ Agregar número</button>
      </Cabecera>
      <Error msg={err} />
      {ok && <div className="ok">{ok}</div>}
      <div className="card">
        <div className="tabla-wrap"><table>
          <thead><tr><th>Número</th><th>Vendedor</th><th>Conexión</th><th>Último mensaje</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {d.numeros.map((n) => (
              <tr key={n.id}>
                <td><b>+{n.numero}</b><span className="sub">ID {n.phone_number_id}</span></td>
                <td>{nombre(n.vendedor_id)}</td>
                <td>{n.proveedor === '360dialog' ? 'Socio oficial (360dialog)' : 'Meta directo'}</td>
                <td>{ultimo(n.id) ? new Date(ultimo(n.id)).toLocaleString('es-BO') : 'Sin mensajes todavía'}</td>
                <td>{n.activo ? <span className="chip verde">Activo</span> : <span className="chip gris">Pausado</span>}</td>
                <td className="r"><div className="acciones-fila">
                  {n.proveedor === '360dialog' && <button className="btn chico" disabled={conectando === n.id} onClick={() => conectarWebhook(n)}>{conectando === n.id ? 'Conectando…' : 'Conectar mensajes'}</button>}
                  <button className="btn chico" onClick={() => setEdit(n)}>Editar</button>
                </div></td>
              </tr>
            ))}
            {!d.numeros.length && <tr><td colSpan="6" className="vacio">Todavía no hay números conectados.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="ch"><h2>Datos para configurar en Meta</h2></div>
        <div className="cb wa-config">
          <div className="wa-dato"><span>URL del webhook</span><code>{WEBHOOK}</code><button className="btn chico" onClick={() => copiar(WEBHOOK, 'url')}>{copiado === 'url' ? 'Copiado' : 'Copiar'}</button></div>
          <div className="wa-dato"><span>Campos a suscribir</span><code>messages, smb_message_echoes, history, smb_app_state_sync, account_update</code></div>
          <p className="crm-sub">Con 360dialog (coexistencia) no hace falta copiar nada: guarda el número y toca “Conectar mensajes”. Con Meta directo, pega esta URL en el panel de la app de Meta.</p>
          <p className="crm-sub">Las claves de acceso se guardan como secretos en Supabase, nunca en esta pantalla.</p>
          <h4>Plantillas para crear en Meta (idioma: Español)</h4>
          <div className="wa-plantilla">
            <b>propuesta_disatel</b> · encabezado: Documento
            <p>Hola {'{{1}}'}, le saluda {'{{2}}'} de DISATEL. Le envío la propuesta de rastreo GPS que conversamos. Quedo atento a sus consultas.</p>
          </div>
          <div className="wa-plantilla">
            <b>seguimiento_disatel</b> · sin encabezado
            <p>Hola {'{{1}}'}, le escribe {'{{2}}'} de DISATEL. ¿Pudo revisar la propuesta que le enviamos? Quedo atento para ayudarle.</p>
          </div>
        </div>
      </div>

      {edit && <EditarNumero n={edit} perfiles={d.perfiles} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); cargar() }} />}
    </>
  )
}

function EditarNumero({ n, perfiles, onClose, onSaved }) {
  const [f, setF] = useState({ numero: n.numero || '', phone_number_id: n.phone_number_id || '', vendedor_id: n.vendedor_id || '', proveedor: n.proveedor || 'meta', secreto: n.secreto || '', activo: n.activo ?? true })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  async function guardar() {
    setErr('')
    let numero = f.numero.replace(/\D/g, '')
    if (numero.length === 8) numero = '591' + numero
    if (!numero || !f.phone_number_id.trim()) return setErr('El número y su ID de Meta son obligatorios.')
    if (f.proveedor === '360dialog' && !f.secreto.trim()) return setErr('Indica el nombre del secreto con la clave del socio para este número.')
    const fila = { numero, phone_number_id: f.phone_number_id.trim(), vendedor_id: f.vendedor_id || null, proveedor: f.proveedor, secreto: f.proveedor === '360dialog' ? f.secreto.trim() : null, activo: f.activo }
    const { error } = n.id ? await supabase.from('wa_numeros').update(fila).eq('id', n.id) : await supabase.from('wa_numeros').insert(fila)
    error ? setErr(error.message) : onSaved()
  }
  return (
    <Modal titulo={n.id ? `Número +${n.numero}` : 'Agregar número de WhatsApp'} onClose={onClose}
      pie={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primario" onClick={guardar}>Guardar</button></>}>
      <Error msg={err} />
      <div className="form">
        <Campo label="Número de WhatsApp" ayuda="Ej.: 77311700 (se agrega el 591)"><input type="text" value={f.numero} onChange={set('numero')} /></Campo>
        <Campo label="ID del número en Meta" ayuda="“Phone number ID” en el administrador de WhatsApp"><input type="text" value={f.phone_number_id} onChange={set('phone_number_id')} /></Campo>
        <Campo label="Vendedor" ayuda="Las conversaciones de este número van a sus clientes" full>
          <select value={f.vendedor_id} onChange={set('vendedor_id')}><option value="">Sin asignar</option>{perfiles.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
        </Campo>
        <Campo label="Conexión">
          <select value={f.proveedor} onChange={set('proveedor')}><option value="meta">Meta directo</option><option value="360dialog">Socio oficial (360dialog)</option></select>
        </Campo>
        {f.proveedor === '360dialog' && <Campo label="Nombre del secreto con la clave" ayuda="Ej.: WA_360_77311700"><input type="text" value={f.secreto} onChange={set('secreto')} /></Campo>}
        <label className="check full"><input type="checkbox" checked={f.activo} onChange={set('activo')} /> Número activo</label>
      </div>
    </Modal>
  )
}
