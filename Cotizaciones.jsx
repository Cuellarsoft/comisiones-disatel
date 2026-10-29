import { useEffect, useMemo, useRef, useState } from 'react'
import { Cabecera, Campo, Error, useApp } from './ui'
import { cotizar, normalizarConfig } from './tarifas'
import { bsPdf, generarPdf } from './cotizacionPdf'
import { fdate, hoyISO } from './lib'
import { supabase } from './supabase'
import { aBase64, correo, whatsapp } from './crmLib'

// N.º único: fecha, hora y las iniciales del vendedor (dos vendedores no chocan en el mismo minuto)
const nuevoNumero = (nombre = '') => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0')
  const ini = nombre.trim().split(/\s+/).map((x) => x[0] || '').join('').slice(0, 3).toUpperCase() || 'DS'
  return `COT-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${ini}`
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

const VACIO = { cliente: '', atencion: '', telefono: '', email: '', tipo: 'personal', unidades: 1, conRoaming: 0, accesorios: {}, bonificar: false, notas: '', presentacion: true }

export default function Cotizaciones() {
  const { perfil, cotAbrir, setCotAbrir, configCot } = useApp()
  const abierta = cotAbrir?.id ? cotAbrir : null
  const soloLectura = abierta?.estado === 'Vendida'
  // Una cotización vendida conserva los precios con que se vendió; las demás usan la configuración vigente
  const cfg = useMemo(() => (soloLectura && abierta?.datos?.config ? normalizarConfig(abierta.datos.config) : configCot), [soloLectura, abierta, configCot])
  const [clienteId, setClienteId] = useState(() => abierta?.cliente_id || cotAbrir?.cliente_id || null)
  const [correoDirecto, setCorreoDirecto] = useState(null) // correo conectado del vendedor (envío automático con el PDF)
  const [waDirecto, setWaDirecto] = useState(null) // número de WhatsApp conectado del vendedor (envío automático con el PDF)
  const [f, setF] = useState(() => {
    if (!abierta) return cotAbrir?.prefill ? { ...VACIO, ...cotAbrir.prefill } : VACIO
    const { config, ...form } = abierta.datos || {} // eslint-disable-line no-unused-vars
    return { ...VACIO, ...form }
  })
  const [numero, setNumero] = useState(() => abierta?.numero || nuevoNumero(perfil.nombre))
  const [fecha, setFecha] = useState(() => abierta?.fecha || hoyISO())
  const [miTel, setMiTel] = useState(() => leer('cot_mi_telefono'))
  const [pdfUrl, setPdfUrl] = useState('')
  const [err, setErr] = useState('')
  const [aviso, setAviso] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [falta, setFalta] = useState('')
  const [guia, setGuia] = useState(null) // computadora: recordatorio para adjuntar el PDF descargado // celular: segundo paso pendiente al enviar por los dos canales
  const timer = useRef(null)
  const ultimo = useRef({ clave: '', bytes: null })

  const cot = useMemo(() => cotizar(f, cfg), [f, cfg])
  useEffect(() => {
    supabase.from('wa_numeros').select('numero').eq('vendedor_id', perfil.id).eq('activo', true).limit(1)
      .then(({ data }) => setWaDirecto(data?.[0]?.numero || null))
    supabase.from('correo_cuentas').select('correo').eq('vendedor_id', perfil.id).eq('activo', true).limit(1)
      .then(({ data }) => setCorreoDirecto(data?.[0]?.correo || null))
  }, [perfil.id])
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const setAcc = (id, v) => setF((s) => ({ ...s, accesorios: { ...s.accesorios, [id]: v } }))

  const datos = () => ({
    cot, numero, fecha, validoHasta: masDias(fecha, cfg.validezDias),
    cliente: f.cliente.trim() || '[Nombre del cliente]', atencion: f.atencion.trim(), notas: f.notas, presentacion: f.presentacion,
    vendedor: { nombre: perfil.nombre, telefono: miTel.trim(), email: perfil.email },
  })
  const archivo = () => `${f.presentacion ? 'Propuesta' : 'Cotizacion'} DISATEL - ${(f.cliente.trim() || 'cliente').replace(/[\\/:*?"<>|]/g, '')}.pdf`

  const claveActual = JSON.stringify([f, miTel, numero, fecha, cfg])

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
  }, [f, miTel, numero, fecha, cfg]) // eslint-disable-line react-hooks/exhaustive-deps

  function validar() {
    if (!f.cliente.trim()) return 'Escribe el nombre del cliente o la empresa.'
    if (cot.unidades < 1) return 'La cantidad de vehículos debe ser al menos 1.'
    return ''
  }

  // Guarda o actualiza la cotización para verla en "Mis cotizaciones" y poder pasarla a Comisiones
  async function registrar(canal) {
    if (soloLectura) return { cliente_id: clienteId }
    const { data, error } = await supabase.from('cotizaciones').upsert({
      numero, vendedor_id: abierta?.vendedor_id || perfil.id, fecha, ...(clienteId ? { cliente_id: clienteId } : {}),
      cliente: f.cliente.trim(), atencion: f.atencion.trim() || null, telefono: f.telefono.trim() || null, email: f.email.trim() || null,
      tipo: f.tipo, unidades: cot.unidades, con_roaming: cot.conRoaming, datos: { ...f, config: cfg },
      total_inicial: cot.totalInicial, total_mensual: cot.totalMensual, enviada_por: canal,
    }, { onConflict: 'numero' }).select('id, cliente_id').single()
    if (error) throw new globalThis.Error('No se pudo guardar la cotización: ' + error.message)
    if (data?.cliente_id) setClienteId(data.cliente_id)
    return data
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

  async function accion(canalPedido) {
    let canal = canalPedido
    const e = validar()
    setErr(e); setAviso(''); setFalta(''); setGuia(null)
    if (e) return
    setTrabajando(true)
    try {
      const file = await armarArchivo()
      const saludo = f.atencion.trim() || f.cliente.trim()
      const doc = f.presentacion ? 'nuestra propuesta con la cotización' : 'la cotización'
      const veh = `${cot.unidades} ${cot.unidades === 1 ? 'vehículo' : 'vehículos'}`
      const texto = `Hola ${saludo}, le saluda ${perfil.nombre} de DISATEL. Le envío ${doc} N.º ${numero} de rastreo GPS para ${veh}. Quedo atento a cualquier consulta.`
      const asunto = `${f.presentacion ? 'Propuesta' : 'Cotización'} DISATEL N.º ${numero} - ${f.cliente.trim()}`
      const cuerpo = `Estimado(a) ${saludo}:\n\nAdjunto ${doc} N.º ${numero} de nuestro servicio de rastreo GPS y monitoreo para ${veh}.\n\nQuedo atento a cualquier consulta.\n\nSaludos cordiales,\n${perfil.nombre}\nDISATEL Bolivia${miTel.trim() ? '\n' + miTel.trim() : ''}`

      // Se registra una sola vez aunque se envíe por los dos canales
      const etiqueta = { email: 'correo', ambos: 'whatsapp y correo' }[canalPedido] || canalPedido
      let fila = null
      const reg = async () => (fila ||= await registrar(etiqueta))
      const documento = async () => ({ base64: aBase64(new Uint8Array(await file.arrayBuffer())), nombre: file.name, mime: 'application/pdf' })
      const hechos = []

      // WhatsApp conectado: la plataforma envía el PDF directo desde el número del vendedor
      if (waDirecto && (canal === 'whatsapp' || canal === 'ambos')) {
        if (!f.telefono.trim()) throw new globalThis.Error('Escribe el WhatsApp del cliente para enviarle la propuesta.')
        if (canal === 'ambos' && correoDirecto && !f.email.trim()) throw new globalThis.Error('Escribe el correo del cliente para enviarle la propuesta.')
        await reg()
        const r = await whatsapp({ accion: 'enviar', cliente_id: fila.cliente_id, texto, documento: await documento() })
        hechos.push(r.modo === 'plantilla'
          ? `Enviado por WhatsApp desde +${waDirecto} con la plantilla de propuesta (el cliente no había escrito en las últimas 24 h).`
          : `Enviado por WhatsApp desde +${waDirecto} con el PDF adjunto.`)
        setAviso(hechos.join(' '))
        if (canal === 'whatsapp') { setAviso(hechos[0] + ' Lo ves en la conversación del cliente.'); return }
        canal = 'email' // falta el correo
        // Sin correo conectado, en el celular el menú de compartir necesita un toque nuevo: el correo queda como segundo paso
        if (!correoDirecto && esMovil()) { setFalta('email'); return }
      }

      // Correo conectado: sale desde la casilla del vendedor con el PDF adjunto, sin abrir nada
      const enviarCorreo = async () => {
        await reg()
        await correo({ accion: 'enviar', para: f.email.trim(), asunto, texto: cuerpo, documento: await documento() })
        hechos.push(`Enviado por correo desde ${correoDirecto} a ${f.email.trim()} con el PDF adjunto.`)
        setAviso(hechos.join(' '))
      }
      let correoDespues = false
      if (correoDirecto && (canal === 'email' || canal === 'ambos')) {
        if (!f.email.trim()) throw new globalThis.Error('Escribe el correo del cliente para enviarle la propuesta.')
        if (canal === 'email') { await enviarCorreo(); return }
        // Por los dos: primero se abre WhatsApp (necesita el toque del vendedor) y después sale el correo solo
        canal = 'whatsapp'; correoDespues = true
      }

      // Se guarda en paralelo para no demorar el menú de compartir del celular
      const guardado = reg()

      if (canal === 'pdf') { descargar(file); await guardado; return }

      // En el celular: menú de compartir con el PDF adjunto (WhatsApp, Gmail, etc.)
      if (esMovil() && navigator.canShare({ files: [file] })) {
        let compartido = true
        try {
          await navigator.share({ files: [file], title: asunto, text: canal === 'email' ? cuerpo : texto })
        } catch (x) { if (x.name !== 'AbortError') throw x; compartido = false }
        // El celular solo permite un envío por toque: el correo queda como segundo paso
        if (canal === 'ambos' && compartido) setFalta('email')
        await guardado
        if (correoDespues) await enviarCorreo()
        return
      }
      // En la computadora: se descarga el PDF y se abre el chat o el correo para adjuntarlo
      descargar(file)
      if (canal === 'whatsapp' || canal === 'ambos') {
        window.open(`https://wa.me/${telWhatsapp(f.telefono)}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
      }
      if (canal === 'email' || canal === 'ambos') {
        location.href = `mailto:${encodeURIComponent(f.email.trim())}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`
      }
      // WhatsApp Web y el correo no aceptan adjuntos desde otra página: se guía al vendedor para adjuntarlo
      setGuia({ canal, file, texto, asunto, cuerpo })
      await guardado
      if (correoDespues) await enviarCorreo()
    } catch (x) {
      setErr(x.message.startsWith('No se pudo') || x.message.startsWith('Escribe') ? x.message : 'No se pudo enviar la cotización: ' + x.message)
    } finally { setTrabajando(false) }
  }

  function nueva() {
    setCotAbrir?.(null); setClienteId(null)
    setF(VACIO); setNumero(nuevoNumero(perfil.nombre)); setFecha(hoyISO()); setErr(''); setAviso('')
  }

  return (
    <>
      <Cabecera titulo={abierta ? `Cotización ${abierta.cliente}` : 'Nueva cotización'}
        sub={abierta ? `N.º ${numero} · creada el ${fdate(fecha)} · ${abierta.estado}` : `N.º ${numero} · arma la propuesta en PDF con los precios vigentes de DISATEL`}>
        <button className="btn" onClick={nueva}>Nueva cotización</button>
      </Cabecera>
      {soloLectura && <div className="nota" style={{ marginBottom: 16 }}>Esta cotización ya se vendió y pasó a Comisiones. Puedes volver a descargarla o enviarla, pero no modificarla.</div>}

      <div className="cot">
        <div className="cot-form">
          <div className="card"><div className="cb">
            <fieldset className="form" disabled={soloLectura} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
                  {Object.entries(cfg.planes).map(([k, p]) => (
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
                {cfg.accesorios.map((a) => (
                  <label key={a.id}>
                    <span>{a.nombre}<small>{bsPdf(a.precio)} c/u</small></span>
                    <input type="number" min="0" value={f.accesorios[a.id] || ''} placeholder="0" onChange={(e) => setAcc(a.id, e.target.value)} />
                  </label>
                ))}
              </div>
              {cot.puedeBonificar && (
                <label className="check full">
                  <input type="checkbox" checked={f.bonificar} onChange={set('bonificar')} />
                  Bonificar accesorios (más de {cfg.umbralBonificar} unidades)
                </label>
              )}

              <h3>Documento</h3>
              <label className="check full">
                <input type="checkbox" checked={f.presentacion} onChange={set('presentacion')} />
                Incluir la presentación de DISATEL antes de la cotización (quiénes somos, clientes, problemas que resolvemos y garantía de respuesta)
              </label>

              <h3>Tus datos y notas</h3>
              <Campo label="Tu teléfono" ayuda="Sale en el PDF; queda guardado en este equipo" full>
                <input type="text" inputMode="tel" value={miTel} onChange={(e) => { setMiTel(e.target.value); guardar('cot_mi_telefono', e.target.value) }} />
              </Campo>
              <Campo label="Notas para el cliente" ayuda="Opcional; aparece al final del PDF" full>
                <textarea rows="3" value={f.notas} onChange={set('notas')} />
              </Campo>
            </fieldset>
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
              {guia && <GuiaAdjuntar guia={guia} onDescargar={() => descargar(guia.file)} onCerrar={() => setGuia(null)} />}
              {falta === 'email' && (
                <div className="ok cot-paso2">
                  <span>Listo el WhatsApp. Ahora envía la misma cotización por correo.</span>
                  <button className="btn oscuro chico" onClick={() => accion('email')}>Enviar por correo</button>
                </div>
              )}
              {waDirecto && <div className="cot-wa-directo">WhatsApp conectado: la propuesta se envía directo desde +{waDirecto}, con el PDF adjunto.</div>}
              {correoDirecto && <div className="cot-wa-directo">Correo conectado: la propuesta sale desde {correoDirecto}, con el PDF adjunto.</div>}
              <div className="cot-botones">
                <button className="btn primario ambos" disabled={trabajando} onClick={() => accion('ambos')}>Enviar por WhatsApp y correo</button>
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

// Computadora: el PDF ya se descargó; WhatsApp Web y el correo se abren con el mensaje y falta adjuntarlo
function GuiaAdjuntar({ guia, onDescargar, onCerrar }) {
  const wa = guia.canal === 'whatsapp' || guia.canal === 'ambos'
  const correo = guia.canal === 'email' || guia.canal === 'ambos'
  const puedeCompartir = !!navigator.canShare?.({ files: [guia.file] })
  async function compartir() {
    try { await navigator.share({ files: [guia.file], title: guia.asunto, text: correo && !wa ? guia.cuerpo : guia.texto }) } catch { /* cancelado */ }
  }
  return (
    <div className="guia-adjuntar" role="status">
      <div className="ga-cab"><b>Falta un paso: adjuntar el PDF</b><button onClick={onCerrar} aria-label="Cerrar">×</button></div>
      <p>El PDF <b>{guia.file.name}</b> se guardó en tu carpeta <b>Descargas</b>
        {wa && correo ? ' y se abrieron WhatsApp y tu correo con el mensaje listo.' : wa ? ' y se abrió WhatsApp con el mensaje listo.' : ' y se abrió tu correo con el mensaje listo.'}</p>
      <ol>
        {wa && <li><b>WhatsApp:</b> en el chat, haz clic en <b>+</b> (o en el clip) → <b>Documento</b> y elige el PDF. También puedes arrastrarlo al chat desde las descargas del navegador.</li>}
        {correo && <li><b>Correo:</b> usa <b>Adjuntar archivo</b> y elige el mismo PDF.</li>}
        <li>Revisa que el PDF aparezca adjunto y envía.</li>
      </ol>
      <div className="ga-botones">
        <button className="btn chico" onClick={onDescargar}>Descargar el PDF otra vez</button>
        {puedeCompartir && <button className="btn chico" onClick={compartir}>Compartir con el PDF adjunto</button>}
      </div>
      {puedeCompartir && <span className="ga-nota">“Compartir” adjunta el PDF directo si tienes instalada la app de WhatsApp o Outlook en esta computadora.</span>}
    </div>
  )
}
