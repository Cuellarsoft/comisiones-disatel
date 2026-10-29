import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Cabecera, Campo, Cargando, Error, Modal } from './ui'
import { correo } from './crmLib'

// Casillas de correo (Zoho Mail) desde las que cada vendedor envía sus cotizaciones con el PDF adjunto
export default function ConfigCorreo() {
  const [d, setD] = useState(null)
  const [edit, setEdit] = useState(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [probando, setProbando] = useState(null)

  async function cargar() {
    const [c, p] = await Promise.all([
      supabase.from('correo_cuentas').select('*').order('id'),
      supabase.from('profiles').select('id, nombre, email, activo').order('nombre'),
    ])
    if (c.error) setErr(c.error.message)
    setD({ cuentas: c.data || [], perfiles: p.data || [] })
  }
  useEffect(() => { cargar() }, [])
  if (!d) return <Cargando />
  const nombre = (id) => d.perfiles.find((p) => p.id === id)?.nombre || '—'

  async function probar(c) {
    setErr(''); setOk(''); setProbando(c.id)
    try { await correo({ accion: 'probar', cuenta_id: c.id }); setOk(`Listo: se envió un correo de prueba a ${c.correo}. Revisa esa bandeja.`) }
    catch (e) { setErr(e.message) } finally { setProbando(null) }
  }

  return (
    <>
      <Cabecera titulo="Correo de vendedores" sub="Desde qué casilla sale cada cotización enviada por correo, con el PDF adjunto">
        <button className="btn primario" onClick={() => setEdit({})}>+ Agregar correo</button>
      </Cabecera>
      <Error msg={err} />
      {ok && <div className="ok">{ok}</div>}
      <div className="card">
        <div className="tabla-wrap"><table>
          <thead><tr><th>Correo</th><th>Vendedor</th><th>Servidor</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {d.cuentas.map((c) => (
              <tr key={c.id}>
                <td><b>{c.correo}</b><span className="sub">Sale como “{c.remitente || 'DISATEL Bolivia'}”</span></td>
                <td>{nombre(c.vendedor_id)}</td>
                <td>{c.servidor}:{c.puerto}</td>
                <td>{c.activo ? <span className="chip verde">Activo</span> : <span className="chip gris">Pausado</span>}</td>
                <td className="r"><div className="acciones-fila">
                  <button className="btn chico" disabled={probando === c.id} onClick={() => probar(c)}>{probando === c.id ? 'Enviando…' : 'Enviar prueba'}</button>
                  <button className="btn chico" onClick={() => setEdit(c)}>Editar</button>
                </div></td>
              </tr>
            ))}
            {!d.cuentas.length && <tr><td colSpan="5" className="vacio">Todavía no hay correos conectados. Mientras tanto, “Enviar por correo” abre el programa de correo del vendedor.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="ch"><h2>Cómo conectar un correo de Zoho</h2></div>
        <div className="cb">
          <ol className="crm-pasos">
            <li>En Zoho Mail de esa casilla: <b>Configuración › Cuentas de correo › IMAP/POP/SMTP</b> y verifica que el acceso SMTP esté habilitado.</li>
            <li>En <b>accounts.zoho.com › Seguridad › Contraseñas específicas de aplicación</b>, genera una contraseña nueva con el nombre “Ventas Disatel”.</li>
            <li>En Supabase, en <b>Edge Functions › Secrets</b>, guarda esa contraseña con un nombre como <code>CORREO_VENTAS_BO</code>. No la pegues aquí ni en ningún chat.</li>
            <li>Aquí, agrega el correo, elige el vendedor, escribe el nombre del secreto y toca <b>Enviar prueba</b>.</li>
          </ol>
          <p className="crm-sub">Servidor: <code>smtppro.zoho.com</code> para correos con dominio de la empresa (como @grupodisatel.com); <code>smtp.zoho.com</code> para cuentas personales de Zoho. Puerto 465.</p>
        </div>
      </div>

      {edit && <EditarCuenta c={edit} perfiles={d.perfiles} usados={d.cuentas.filter((x) => x.id !== edit.id).map((x) => x.vendedor_id)} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); cargar() }} />}
    </>
  )
}

function EditarCuenta({ c, perfiles, usados, onClose, onSaved }) {
  const [f, setF] = useState({
    correo: c.correo || '', remitente: c.remitente || '', vendedor_id: c.vendedor_id || '',
    servidor: c.servidor || 'smtppro.zoho.com', puerto: c.puerto || 465, secreto: c.secreto || '', activo: c.activo ?? true,
  })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  function elegirVendedor(e) {
    const p = perfiles.find((x) => x.id === e.target.value)
    setF((x) => ({ ...x, vendedor_id: e.target.value, remitente: x.remitente || (p ? `${p.nombre} · DISATEL` : '') }))
  }
  async function guardar() {
    setErr('')
    const correoLimpio = f.correo.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoLimpio)) return setErr('Escribe un correo válido.')
    if (!f.vendedor_id) return setErr('Elige el vendedor que usa este correo.')
    const secreto = f.secreto.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9_]*$/.test(secreto) || secreto.startsWith('SUPABASE_')) return setErr('El nombre del secreto solo lleva letras, números y guion bajo (ej.: CORREO_VENTAS_BO).')
    const fila = { correo: correoLimpio, remitente: f.remitente.trim() || null, vendedor_id: f.vendedor_id, servidor: f.servidor.trim() || 'smtppro.zoho.com', puerto: Number(f.puerto) || 465, secreto, activo: f.activo }
    const { error } = c.id ? await supabase.from('correo_cuentas').update(fila).eq('id', c.id) : await supabase.from('correo_cuentas').insert(fila)
    error ? setErr(error.message.includes('duplicate') ? 'Ese vendedor ya tiene un correo conectado.' : error.message) : onSaved()
  }
  return (
    <Modal titulo={c.id ? c.correo : 'Agregar correo'} onClose={onClose}
      pie={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primario" onClick={guardar}>Guardar</button></>}>
      <Error msg={err} />
      <div className="form">
        <Campo label="Correo" ayuda="Ej.: ventas.bo@grupodisatel.com" full><input type="email" value={f.correo} onChange={set('correo')} /></Campo>
        <Campo label="Vendedor">
          <select value={f.vendedor_id} onChange={elegirVendedor}>
            <option value="">Elegir…</option>
            {perfiles.filter((p) => p.activo && !usados.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Nombre que ve el cliente" ayuda="Ej.: Jhon Guzmán · DISATEL"><input type="text" value={f.remitente} onChange={set('remitente')} /></Campo>
        <Campo label="Servidor"><input type="text" value={f.servidor} onChange={set('servidor')} /></Campo>
        <Campo label="Puerto"><input type="number" value={f.puerto} onChange={set('puerto')} /></Campo>
        <Campo label="Nombre del secreto con la contraseña" ayuda="Ej.: CORREO_VENTAS_BO (la contraseña se guarda en Supabase)" full><input type="text" value={f.secreto} onChange={set('secreto')} /></Campo>
        <label className="check full"><input type="checkbox" checked={f.activo} onChange={set('activo')} /> Correo activo</label>
      </div>
    </Modal>
  )
}
