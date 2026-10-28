import { useEffect, useMemo, useRef, useState } from 'react'
import { Cabecera, Campo, Error, useApp } from './ui'
import { ACCESORIOS, PLANES, UMBRAL_BONIFICAR, VALIDEZ_DIAS, cotizar } from './tarifas'
import { bsPdf, generarPdf } from './cotizacionPdf'
import { hoyISO } from './lib'

const nuevoNumero = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0')
  return `COT-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
const masDias = (iso, n) => {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const leer = (k) => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const guardar = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } }
const telWhatsapp = (t) => {
  let d = String(t || '').replace(/\D/g, '')
  if (d.length === 8) d = '591' + d
  return d
}
const esMovil = () => window.matchMedia?.('(pointer: coarse)').matches && !!navigator.canShare

const VACIO = { cliente: '', atencion: '', telefono: '', email: '', tipo: 'personal', unidades: 1, conRoaming: 0, accesorios: {}, bonificar: false, notas: '' }

export default function Cotizaciones() {
  const { perfil } = useApp()
  const [f, setF] = useState(VACIO)
  const [numero, setNumero] = useState(nuevoNumero)
  const [miTel, setMiTel] = useState(() => leer('cot_mi_telefono'))
  const [pdfUrl, setPdfUrl] = useState('')
  const [err, setErr] = useState('')
  const [aviso, setAviso] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const timer = useRef(null)
  const ultimo = useRef({ clave: '', bytes: null })

  const fecha = hoyISO()
  const cot = useMemo(() => cotizar(f), [f])
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const setAcc = (id, v) => setF((s) => ({ ...s, accesorios: { ...s.accesorios, [id]: v } }))

  const datos = () => ({
    cot, numero, fecha, validoHasta: masDias(fecha, VALIDEZ_DIAS),
    cliente: f.cliente.trim() || '[Nombre del cliente]', atencion: f.atencion.trim(), notas: f.notas,
    vendedor: { nombre: perfil.nombre, telefono: miTel.trim(), email: perfil.email },
  })
  const archivo = () => `Cotizacion DISATEL - ${(f.cliente.trim() || 'cliente').replace(/[\\/:*?"<>|]/g, '')}.pdf`

  const claveActual = JSON.stringify([f, miTel, numero])

  // Vista previa del PDF (se regenera al cambiar los datos)
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const bytes = await generarPdf(datos())
        ultimo.current = { clave: claveActual, bytes }
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        setPdfUrl((ant) => { if (ant) URL.revokeObjectURL(ant); return url })
      } catch (e) { setErr('No se pudo generar la vista previa: ' + e.message) }
    }, 350)
    return () => clearTimeout(timer.current)
  }, [f, miTel, numero]) // eslint-disable-line react-hooks/exhaustive-deps

  function validar() {
    if (!f.cliente.trim()) return 'Escribe el nombre del cliente o la empresa.'
    if (cot.unidades < 1) return 'La cantidad de vehículos debe ser al menos 1.'
    return ''
  }

  async function armarArchivo() {
    // Se reutiliza el PDF ya generado para que el menú de compartir del celular abra sin demora
    const bytes = ultimo.current.clave === claveActual ? ultimo.current.bytes : await generarPdf(datos())
    return new File([bytes], archivo(), { type: 'application/pdf' })
  }
  function descargar(file) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(file)
    a.download = file.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }

  async function accion(canal) {
    const e = validar()
    setErr(e); setAviso('')
    if (e) return
    setTrabajando(true)
    try {
      const file = await armarArchivo()
      const saludo = f.atencion.trim() || f.cliente.trim()
      const veh = `${cot.unidades} ${cot.unidades === 1 ? 'vehículo' : 'vehículos'}`
      const texto = `Hola ${saludo}, le saluda ${perfil.nombre} de DISATEL. Le envío la cotización N.º ${numero} de rastreo GPS para ${veh}. Quedo atento a cualquier consulta.`
      const asunto = `Cotización DISATEL N.º ${numero} - ${f.cliente.trim()}`
      const cuerpo = `Estimado(a) ${saludo}:\n\nAdjunto la cotización N.º ${numero} de nuestro servicio de rastreo GPS y monitoreo para ${veh}.\n\nQuedo atento a cualquier consulta.\n\nSaludos cordiales,\n${perfil.nombre}\nDISATEL Bolivia${miTel.trim() ? '\n' + miTel.trim() : ''}`

      if (canal === 'pdf') { descargar(file); return }

      // En el celular: menú de compartir con el PDF adjunto (WhatsApp, Gmail, etc.)
      if (esMovil() && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: asunto, text: canal === 'whatsapp' ? texto : cuerpo })
        } catch (x) { if (x.name !== 'AbortError') throw x }
        return
      }
      // En la computadora: se descarga el PDF y se abre el chat o el correo para adjuntarlo
      descargar(file)
      if (canal === 'whatsapp') {
        window.open(`https://wa.me/${telWhatsapp(f.telefono)}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
        setAviso('Se descargó el PDF y se abrió WhatsApp con el mensaje listo. Adjunta el PDF descargado en el chat.')
      } else {
        location.href = `mailto:${encodeURIComponent(f.email.trim())}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`
        setAviso('Se descargó el PDF y se abrió tu correo con el mensaje listo. Adjunta el PDF descargado.')
      }
    } catch (x) {
      setErr('No se pudo preparar la cotización: ' + x.message)
    } finally { setTrabajando(false) }
  }

  function nueva() {
    setF(VACIO); setNumero(nuevoNumero()); setErr(''); setAviso('')
  }

  return (
    <>
      <Cabecera titulo="Cotizaciones" sub={`N.º ${numero} · el PDF se arma con los precios vigentes de DISATEL`}>
        <button className="btn" onClick={nueva}>Nueva cotización</button>
      </Cabecera>

      <div className="cot">
        <div className="cot-form">
          <div className="card"><div className="cb">
            <div className="form">
              <h3>Cliente</h3>
              <Campo label="Cliente o empresa *" full>
                <input type="text" value={f.cliente} onChange={set('cliente')} placeholder="Ej.: Transportes Andinos SRL" />
              </Campo>
              <Campo label="Atención a" ayuda="Persona de contacto (opcional)">
                <input type="text" value={f.atencion} onChange={set('atencion')} />
              </Campo>
              <Campo label="WhatsApp del cliente" ayuda="8 dígitos; se agrega el 591">
                <input type="text" inputMode="tel" value={f.telefono} onChange={set('telefono')} placeholder="7xxxxxxx" />
              </Campo>
              <Campo label="Correo del cliente" full>
                <input type="email" value={f.email} onChange={set('email')} />
              </Campo>

              <h3>Servicio</h3>
              <Campo label="Tipo de cliente" full>
                <div className="segmento">
                  {Object.entries(PLANES).map(([k, p]) => (
                    <button key={k} type="button" className={f.tipo === k ? 'on' : ''} onClick={() => setF((s) => ({ ...s, tipo: k }))}>{p.nombre}</button>
                  ))}
                </div>
              </Campo>
              <Campo label="Cantidad de vehículos *">
                <input type="number" min="1" value={f.unidades} onChange={set('unidades')} />
              </Campo>
              <Campo label="De esos, ¿cuántos con roaming?" ayuda="Para vehículos que salen del país">
                <input type="number" min="0" max={cot.unidades} value={f.conRoaming} onChange={set('conRoaming')} />
              </Campo>
              <div className="full nota">
                Tarifa aplicada: <b>{cot.plan.nombre} · {cot.tramo.nombre}</b> — monitoreo {bsPdf(cot.tramo.mes)}/mes
                {cot.plan.equipo === 'venta' ? `, equipo ${bsPdf(cot.tramo.equipo)} (venta)` : ', equipo en comodato'}.
              </div>

              <h3>Accesorios</h3>
              <div className="full acc">
                {ACCESORIOS.map((a) => (
                  <label key={a.id}>
                    <span>{a.nombre}<small>{bsPdf(a.precio)} c/u</small></span>
                    <input type="number" min="0" value={f.accesorios[a.id] || ''} placeholder="0" onChange={(e) => setAcc(a.id, e.target.value)} />
                  </label>
                ))}
              </div>
              {cot.puedeBonificar && (
                <label className="check full">
                  <input type="checkbox" checked={f.bonificar} onChange={set('bonificar')} />
                  Bonificar accesorios (más de {UMBRAL_BONIFICAR} unidades)
                </label>
              )}

              <h3>Tus datos y notas</h3>
              <Campo label="Tu teléfono" ayuda="Sale en el PDF; queda guardado en este equipo" full>
                <input type="text" inputMode="tel" value={miTel} onChange={(e) => { setMiTel(e.target.value); guardar('cot_mi_telefono', e.target.value) }} />
              </Campo>
              <Campo label="Notas para el cliente" ayuda="Opcional; aparece al final del PDF" full>
                <textarea rows="3" value={f.notas} onChange={set('notas')} />
              </Campo>
            </div>
          </div></div>
        </div>

        <div className="cot-lado">
          <div className="card cot-resumen">
            <div className="ch"><h2>Resumen</h2><span>{cot.unidades} {cot.unidades === 1 ? 'vehículo' : 'vehículos'}</span></div>
            <div className="cb">
              <div className="resumen-liq num">
                <div className="f"><span>Inversión inicial</span><span>{bsPdf(cot.totalInicial)}</span></div>
                <div className="f total"><span>Servicio mensual</span><span>{bsPdf(cot.totalMensual)}</span></div>
                {cot.formasPago.slice(1).map((p) => (
                  <div key={p.nombre} className="f ingreso"><span>{p.nombre} ({Math.round(p.desc * 100)}% desc.)</span><span>{bsPdf(p.total)}</span></div>
                ))}
              </div>
              <Error msg={err} />
              {aviso && <div className="ok">{aviso}</div>}
              <div className="cot-botones">
                <button className="btn whatsapp" disabled={trabajando} onClick={() => accion('whatsapp')}>Enviar por WhatsApp</button>
                <button className="btn oscuro" disabled={trabajando} onClick={() => accion('email')}>Enviar por correo</button>
                <button className="btn" disabled={trabajando} onClick={() => accion('pdf')}>Descargar PDF</button>
                {pdfUrl && <a className="btn ver-pdf" href={pdfUrl} target="_blank" rel="noopener">Ver PDF</a>}
              </div>
            </div>
          </div>
          {pdfUrl && <iframe className="cot-preview" title="Vista previa de la cotización" src={pdfUrl + '#toolbar=0&navpanes=0&view=FitH'} />}
        </div>
      </div>
    </>
  )
}
