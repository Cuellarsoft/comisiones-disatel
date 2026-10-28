import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Modal, Campo, Error, useApp } from './ui'
import { bs, hoyISO } from './lib'
import { FilaHistorial } from './Historial'

const CAUSAS = ['Voluntaria', 'Incumplimiento', 'Competencia', 'Causa Disatel / excepción', 'Otra']

export default function VentaModal({ venta, vendedores = [], onClose, onSaved }) {
  const { perfil, params } = useApp()
  const admin = perfil.rol === 'admin'
  const nueva = !venta?.id
  const bloqueada = !admin && venta?.fecha_instalacion
  const [f, setF] = useState(() => ({
    vendedor_id: venta?.vendedor_id || (admin ? vendedores[0]?.id || perfil.id : perfil.id),
    fecha_captacion: venta?.fecha_captacion || hoyISO(),
    cliente: venta?.cliente || '',
    empresa: venta?.empresa || '',
    vehiculo: venta?.vehiculo || '',
    modalidad: venta?.modalidad || 'Postpago',
    precio_mensual: venta?.precio_mensual ?? params.precio_postpago,
    contrato: venta?.contrato || false,
    notas: venta?.notas || '',
    fecha_instalacion: venta?.fecha_instalacion || '',
    activado: venta?.activado ?? false,
    fecha_primer_pago: venta?.fecha_primer_pago || '',
    estado: venta?.estado || 'Activo',
    fecha_baja: venta?.fecha_baja || '',
    causa_baja: venta?.causa_baja || '',
    comision: venta?.comision ?? '',
  }))
  const [hist, setHist] = useState([])
  useEffect(() => {
    if (venta?.id) supabase.from('historial').select('*').eq('tabla', 'ventas').eq('registro_id', venta.id)
      .order('created_at', { ascending: false }).then(({ data }) => setHist(data || []))
  }, [venta?.id])
  const [err, setErr] = useState('')
  const [guardando, setGuardando] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const pctMod = f.modalidad === 'Prepago' ? params.comision_prepago_pct : params.comision_postpago_pct
  const comisionCalc = Math.round(Number(f.precio_mensual || 0) * pctMod * 100) / 100
  const liquidada = !!venta?.liquidacion_id

  function cambiarModalidad(e) {
    const m = e.target.value
    setF((x) => ({ ...x, modalidad: m, precio_mensual: m === 'Prepago' ? params.precio_prepago : params.precio_postpago }))
  }

  async function guardar(e) {
    e?.preventDefault()
    setErr('')
    if (!f.cliente.trim() || !f.vehiculo.trim()) return setErr('Cliente y vehículo son obligatorios')
    const row = {
      fecha_captacion: f.fecha_captacion, cliente: f.cliente.trim(), empresa: f.empresa.trim() || null,
      vehiculo: f.vehiculo.trim().toUpperCase(), modalidad: f.modalidad, precio_mensual: Number(f.precio_mensual),
      contrato: f.contrato, notas: f.notas.trim() || null,
    }
    if (admin) {
      Object.assign(row, {
        vendedor_id: f.vendedor_id,
        fecha_instalacion: f.fecha_instalacion || null,
        activado: f.fecha_instalacion ? f.activado : false,
        fecha_primer_pago: f.fecha_primer_pago || null,
        estado: f.estado,
        fecha_baja: f.estado === 'Activo' ? null : f.fecha_baja || null,
        causa_baja: f.estado === 'Activo' ? null : f.causa_baja || null,
      })
      if (!liquidada) row.comision = f.comision === '' ? null : Number(f.comision)
      if (f.estado !== 'Activo' && !f.fecha_baja) return setErr('Indique la fecha de baja')
    }
    setGuardando(true)
    const q = nueva ? supabase.from('ventas').insert(row) : supabase.from('ventas').update(row).eq('id', venta.id)
    const { error } = await q
    setGuardando(false)
    if (error) return setErr(error.message)
    onSaved?.()
  }

  async function borrar() {
    if (!confirm('¿Eliminar esta venta? No se puede deshacer.')) return
    const { error } = await supabase.from('ventas').delete().eq('id', venta.id)
    if (error) return setErr(error.message)
    onSaved?.()
  }

  const puedeBorrar = !nueva && !liquidada && (admin || !venta.fecha_instalacion)

  return (
    <Modal
      titulo={nueva ? 'Registrar venta' : `${venta.cliente} · ${venta.vehiculo}`}
      onClose={onClose}
      pie={<>
        {puedeBorrar && <button className="btn peligro izq" onClick={borrar}>Eliminar</button>}
        <button className="btn" onClick={onClose}>{bloqueada ? 'Cerrar' : 'Cancelar'}</button>
        {!bloqueada && <button className="btn primario" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>}
      </>}
    >
      <Error msg={err} />
      {bloqueada && <div className="nota" style={{ marginBottom: 14 }}>Esta venta ya fue instalada. Si hay un error, pídale al administrador que la corrija.</div>}
      <form className="form" onSubmit={guardar}>
        <fieldset disabled={!!bloqueada} style={{ display: 'contents' }}>
          {admin && (
            <Campo label="Vendedor" full>
              <select value={f.vendedor_id} onChange={set('vendedor_id')} disabled={liquidada}>
                {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </select>
            </Campo>
          )}
          <Campo label="Cliente (contacto)"><input type="text" value={f.cliente} onChange={set('cliente')} autoFocus={nueva} /></Campo>
          <Campo label="Empresa"><input type="text" value={f.empresa} onChange={set('empresa')} placeholder="Particular" /></Campo>
          <Campo label="Vehículo / placa / ID"><input type="text" value={f.vehiculo} onChange={set('vehiculo')} /></Campo>
          <Campo label="Fecha de captación"><input type="date" value={f.fecha_captacion} onChange={set('fecha_captacion')} /></Campo>
          <Campo label="Tipo de cliente">
            <select value={f.modalidad} onChange={cambiarModalidad}><option value="Postpago">Empresa</option><option value="Prepago">Personal</option></select>
          </Campo>
          <Campo label="Precio mensual (Bs)" ayuda={`Comisión ${Math.round(pctMod * 100)}% = ${bs(comisionCalc)}`}>
            <input type="number" min="0" step="0.01" value={f.precio_mensual} onChange={set('precio_mensual')} disabled={liquidada} />
          </Campo>
          <label className="check full"><input type="checkbox" checked={f.contrato} onChange={set('contrato')} /> Contrato firmado</label>
          <Campo label="Notas" full><textarea rows="2" value={f.notas} onChange={set('notas')} /></Campo>
        </fieldset>

        {admin && <>
          <h3>Instalación y cobranza</h3>
          <Campo label="Fecha de instalación" ayuda="La comisión se gana con la instalación">
            <input type="date" value={f.fecha_instalacion} onChange={set('fecha_instalacion')} disabled={liquidada} />
          </Campo>
          <Campo label="Fecha del 1er pago del cliente" ayuda={`Sin pago a ${params.plazo_pago_dias} días = clawback 100%`}>
            <input type="date" value={f.fecha_primer_pago} onChange={set('fecha_primer_pago')} />
          </Campo>
          <label className="check"><input type="checkbox" checked={f.activado} onChange={set('activado')} disabled={!f.fecha_instalacion || liquidada} /> Equipo activado en plataforma</label>
          <Campo label="Comisión (Bs)" ayuda={liquidada ? 'Ya liquidada, no se puede cambiar' : 'Vacío = cálculo automático'}>
            <input type="number" step="0.01" value={f.comision} onChange={set('comision')} placeholder={String(comisionCalc)} disabled={liquidada} />
          </Campo>
          <h3>Estado del servicio</h3>
          <Campo label="Estado">
            <select value={f.estado} onChange={set('estado')}><option>Activo</option><option>Baja</option><option>Cancelado</option></select>
          </Campo>
          {f.estado !== 'Activo' ? <>
            <Campo label="Fecha de baja"><input type="date" value={f.fecha_baja} onChange={set('fecha_baja')} /></Campo>
            <Campo label="Causa de la baja" full ayuda="“Causa Disatel / excepción” no descuenta comisión">
              <select value={f.causa_baja} onChange={set('causa_baja')}>
                <option value="">—</option>
                {CAUSAS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Campo>
          </> : <div />}
        </>}
      </form>
      {hist.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--rojo)', fontWeight: 700, marginBottom: 8 }}>Historial de esta venta</div>
          <div className="tabla-wrap" style={{ border: '1px solid var(--linea)', borderRadius: 8 }}><table style={{ fontSize: 12.5 }}>
            <tbody>{hist.map((h) => <FilaHistorial key={h.id} h={h} conDetalle={false} />)}</tbody>
          </table></div>
        </div>
      )}
    </Modal>
  )
}
