export const bs = (n) =>
  'Bs ' + Number(n || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const bs0 = (n) => 'Bs ' + Math.round(Number(n || 0)).toLocaleString('es-BO')

export const pct = (n) => Math.round(Number(n || 0) * 100) + '%'

export const fdate = (d) => {
  if (!d) return '—'
  const [y, m, day] = String(d).slice(0, 10).split('-')
  return `${day}/${m}/${y}`
}

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export const hoyISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// "2026-09" <-> etiquetas
export const mesActual = () => hoyISO().slice(0, 7)
export const mesLabel = (ym) => {
  if (!ym) return ''
  const [y, m] = ym.slice(0, 7).split('-')
  return `${MESES[Number(m) - 1]} ${y}`
}
export const mesCorto = (ym) => {
  const [y, m] = ym.slice(0, 7).split('-')
  return `${MESES[Number(m) - 1].slice(0, 3)} ${y}`
}
export const ultimosMeses = (n = 15) => {
  const out = []
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + 1)
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() - 1)
  }
  return out
}

export const diasDesde = (iso) => {
  if (!iso) return null
  const a = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  const b = new Date(hoyISO() + 'T00:00:00')
  return Math.round((b - a) / 86400000)
}

export const instalada = (v) => !!v.fecha_instalacion && v.activado

// Estado legible de una venta para la tabla
export function estadoVenta(v, plazo = 30) {
  if (v.estado !== 'Activo') return { txt: v.estado, cls: 'gris' }
  if (!v.fecha_instalacion) return { txt: 'Por instalar', cls: 'azul' }
  if (!v.activado) return { txt: 'Instalada · sin activar', cls: 'azul' }
  if (v.fecha_primer_pago) return { txt: 'Pagando', cls: 'verde' }
  const d = diasDesde(v.fecha_instalacion)
  if (d > plazo) return { txt: `Sin pago · ${d} días`, cls: 'rojo' }
  return { txt: `Por cobrar · quedan ${plazo - d} d`, cls: 'ambar' }
}

export const MOTIVOS = { no_pago: 'Sin pago', baja: 'Baja', reintegro: 'Reintegro' }

export function bonoInfo(unidades, bonos = []) {
  const tiers = [...bonos].sort((a, b) => a.min - b.min)
  let actual = null, siguiente = null
  for (const t of tiers) {
    if (unidades >= t.min) actual = t
    else { siguiente = t; break }
  }
  return { actual, siguiente, faltan: siguiente ? siguiente.min - unidades : 0, max: tiers.at(-1)?.min || 1 }
}

export function descargarCSV(nombre, filas) {
  if (!filas.length) return
  const cols = Object.keys(filas[0])
  const esc = (x) => {
    const s = x == null ? '' : String(x)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '﻿' + [cols.join(';'), ...filas.map((f) => cols.map((c) => esc(f[c])).join(';'))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = nombre
  a.click()
}
