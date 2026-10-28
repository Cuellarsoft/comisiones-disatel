import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import logoUrl from './logo-cotizacion.png'
import { INCLUYE } from './tarifas'
import { fdate } from './lib'

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)
const C = {
  rojo: hex('#E31E24'), tinta: hex('#1F2326'), grafito: hex('#444A4F'), gris: hex('#6B7176'),
  linea: hex('#E4E6E8'), suave: hex('#F4F5F6'), blanco: hex('#FFFFFF'), rojoSuave: hex('#FDECEC'),
}

// Formato de moneda seguro para las fuentes estándar del PDF
export const bsPdf = (n) => 'Bs ' + Number(n || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
// Las fuentes estándar solo admiten caracteres WinAnsi; se reemplaza lo demás
const limpio = (s) => String(s ?? '').replace(/[−]/g, '-').replace(/[  ]/g, ' ').replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, '')

export async function generarPdf(d) {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Cotización ${d.numero} - ${d.cliente}`)
  pdf.setAuthor('DISATEL Bolivia')
  const reg = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await pdf.embedPng(await (await fetch(logoUrl)).arrayBuffer())

  const W = 595.28, H = 841.89, M = 44, ANCHO = W - 2 * M, PIE = 64
  let page = pdf.addPage([W, H])
  let y = M // distancia desde el borde superior

  const txt = (s, x, top, { size = 10, font = reg, color = C.tinta, align = 'left' } = {}) => {
    const t = limpio(s)
    const w = font.widthOfTextAtSize(t, size)
    const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
    page.drawText(t, { x: px, y: H - top - size * 0.8, size, font, color })
    return w
  }
  const lineas = (s, font, size, max) => {
    const out = []
    let cur = ''
    for (const p of limpio(s).split(' ')) {
      const prueba = cur ? cur + ' ' + p : p
      if (font.widthOfTextAtSize(prueba, size) > max && cur) { out.push(cur); cur = p } else cur = prueba
    }
    if (cur) out.push(cur)
    return out
  }
  const rect = (x, top, w, h, color, borde) => page.drawRectangle({
    x, y: H - top - h, width: w, height: h, color, ...(borde ? { borderColor: borde, borderWidth: 1 } : {}),
  })
  const raya = (top, color = C.linea, grosor = 0.8, x1 = M, x2 = W - M) =>
    page.drawLine({ start: { x: x1, y: H - top }, end: { x: x2, y: H - top }, thickness: grosor, color })
  const pie = () => {
    raya(H - PIE + 14)
    txt('DISATEL Bolivia · Siempre una solución inteligente · grupodisatel.com', M, H - PIE + 22, { size: 8, color: C.gris })
    txt(d.numero, W - M, H - PIE + 22, { size: 8, color: C.gris, align: 'right' })
  }
  const espacio = (h) => { if (y + h > H - PIE) { pie(); page = pdf.addPage([W, H]); y = M } }
  const titulo = (s) => { espacio(40); txt(s.toUpperCase(), M, y, { size: 9, font: bold, color: C.rojo }); y += 15 }

  // ---- Encabezado
  const lw = 150, lh = lw * logo.height / logo.width
  page.drawImage(logo, { x: M, y: H - y - lh, width: lw, height: lh })
  txt('COTIZACIÓN', W - M, y + 4, { size: 20, font: bold, color: C.rojo, align: 'right' })
  txt(`N.º ${d.numero}`, W - M, y + 30, { size: 10, font: bold, align: 'right' })
  txt(`Fecha: ${fdate(d.fecha)}`, W - M, y + 44, { size: 9, color: C.gris, align: 'right' })
  txt(`Válida hasta: ${fdate(d.validoHasta)}`, W - M, y + 56, { size: 9, color: C.gris, align: 'right' })
  y += Math.max(lh, 68) + 10
  raya(y, C.rojo, 2)
  y += 14

  // ---- Cliente y vendedor
  const col2 = M + ANCHO * 0.58
  txt('PARA', M, y, { size: 8, font: bold, color: C.gris })
  txt('PREPARADO POR', col2, y, { size: 8, font: bold, color: C.gris })
  let yi = y + 13, yd = y + 13
  for (const l of lineas(d.cliente, bold, 13, ANCHO * 0.55)) { txt(l, M, yi, { size: 13, font: bold }); yi += 16 }
  if (d.atencion) { txt(`Atención: ${d.atencion}`, M, yi, { size: 9.5, color: C.grafito }); yi += 13 }
  txt(`Plan ${d.cot.plan.nombre} · ${d.cot.unidades} ${d.cot.unidades === 1 ? 'vehículo' : 'vehículos'}`, M, yi, { size: 9.5, color: C.grafito }); yi += 13
  txt(d.vendedor.nombre, col2, yd, { size: 11, font: bold }); yd += 15
  if (d.vendedor.telefono) { txt(d.vendedor.telefono, col2, yd, { size: 9.5, color: C.grafito }); yd += 13 }
  if (d.vendedor.email) { txt(d.vendedor.email, col2, yd, { size: 9.5, color: C.grafito }); yd += 13 }
  y = Math.max(yi, yd) + 8

  for (const l of lineas('Le presentamos nuestra propuesta de rastreo GPS y monitoreo vehicular con la plataforma LOC-AID, para que tenga el control de su flota en todo momento.', reg, 10, ANCHO)) {
    txt(l, M, y, { size: 10, color: C.grafito }); y += 14
  }
  y += 8

  // ---- Tablas
  const cols = [
    { t: 'Concepto', x: M + 10, a: 'left' },
    { t: 'Cant.', x: M + ANCHO * 0.58, a: 'right' },
    { t: 'Precio unit.', x: M + ANCHO * 0.78, a: 'right' },
    { t: 'Total', x: W - M - 10, a: 'right' },
  ]
  const tabla = (filas, etiquetaTotal, total) => {
    const F = 18
    espacio(F + F * filas.length + 26)
    rect(M, y, ANCHO, F, C.suave)
    for (const c of cols) txt(c.t, c.x, y + 5, { size: 8.5, font: bold, color: C.gris, align: c.a })
    y += F
    for (const f of filas) {
      txt(f.concepto, cols[0].x, y + 5, { size: 9.5 })
      txt(String(f.cant), cols[1].x, y + 5, { size: 9.5, align: 'right' })
      txt(f.unit ? bsPdf(f.unit) : '-', cols[2].x, y + 5, { size: 9.5, align: 'right', color: C.grafito })
      txt(f.nota && f.total === 0 ? f.nota : bsPdf(f.total), cols[3].x, y + 5, { size: 9.5, align: 'right', font: f.nota && f.total === 0 ? bold : reg, color: f.nota && f.total === 0 ? C.rojo : C.tinta })
      y += F
      raya(y)
    }
    rect(M, y, ANCHO, 24, C.blanco)
    txt(etiquetaTotal, cols[0].x, y + 7, { size: 10, font: bold })
    if (total) txt(bsPdf(total), cols[3].x, y + 7, { size: 11, font: bold, align: 'right' })
    else txt('Sin costo', cols[3].x, y + 7, { size: 11, font: bold, align: 'right', color: C.rojo })
    raya(y, C.tinta, 1.2)
    y += 24 + 12
  }

  titulo('Inversión inicial · pago único')
  tabla(d.cot.inicial, 'Total inversión inicial', d.cot.totalInicial)
  titulo('Servicio de monitoreo')
  tabla(d.cot.mensual, 'Total servicio mensual', d.cot.totalMensual)

  // ---- Formas de pago
  titulo('Formas de pago del servicio')
  espacio(70)
  const fp = d.cot.formasPago, gap = 10, bw = (ANCHO - gap * (fp.length - 1)) / fp.length
  fp.forEach((f, i) => {
    const x = M + i * (bw + gap)
    const destacado = i === fp.length - 1 && fp.length > 1
    rect(x, y, bw, 62, destacado ? C.rojoSuave : C.suave, destacado ? C.rojo : null)
    txt(f.nombre.toUpperCase(), x + 12, y + 10, { size: 8.5, font: bold, color: destacado ? C.rojo : C.gris })
    if (f.desc) txt(`${Math.round(f.desc * 100)}% de descuento`, x + bw - 12, y + 10, { size: 8, font: bold, color: C.rojo, align: 'right' })
    txt(bsPdf(f.total), x + 12, y + 24, { size: 15, font: bold })
    txt(f.meses === 1 ? 'por mes' : `por ${f.meses} meses · ${bsPdf(f.porMes)} al mes`, x + 12, y + 45, { size: 8.5, color: C.grafito })
  })
  y += 62 + 16

  // ---- Incluye y condiciones
  const listaAlto = (items, w) => items.reduce((s, it) => s + lineas(it, reg, 9, w - 10).length * 12 + 3, 0)
  const wL = ANCHO * 0.46, xR = M + ANCHO * 0.52, wR = ANCHO * 0.48
  espacio(18 + Math.max(listaAlto(INCLUYE, wL), listaAlto(d.cot.condiciones, wR)))
  txt('INCLUYE', M, y, { size: 9, font: bold, color: C.rojo })
  txt('CONDICIONES', xR, y, { size: 9, font: bold, color: C.rojo })
  const lista = (items, x, w, top) => {
    for (const it of items) {
      const ls = lineas(it, reg, 9, w - 10)
      txt('•', x, top, { size: 9, color: C.rojo })
      ls.forEach((l, j) => txt(l, x + 10, top + j * 12, { size: 9, color: C.grafito }))
      top += ls.length * 12 + 3
    }
    return top
  }
  const fin = Math.max(lista(INCLUYE, M, wL, y + 16), lista(d.cot.condiciones, xR, wR, y + 16))
  y = fin + 10

  if (d.notas?.trim()) {
    const ls = d.notas.trim().split('\n').flatMap((p) => lineas(p, reg, 9, ANCHO))
    espacio(18 + ls.length * 12)
    txt('NOTAS', M, y, { size: 9, font: bold, color: C.rojo }); y += 16
    for (const l of ls) { txt(l, M, y, { size: 9, color: C.grafito }); y += 12 }
  }

  pie()
  return pdf.save()
}
