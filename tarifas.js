// Tarifario de cotizaciones DISATEL.
// Para cambiar precios, descuentos o condiciones, editar solo este archivo.

export const CONTRATO_MESES = 12
export const VALIDEZ_DIAS = 15
// Con más de esta cantidad de unidades el vendedor puede bonificar los accesorios
export const UMBRAL_BONIFICAR = 20

export const PLANES = {
  personal: {
    nombre: 'Personal',
    equipo: 'venta', // el equipo se vende al cliente
    tramos: [
      { hasta: 4, nombre: '1 a 4 vehículos', equipo: 390, mes: 85, roaming: 110, descSemestral: 0.05, descAnual: 0.1 },
      // PENDIENTE DE CONFIRMAR: descuentos de 5 o más (en la planilla están vacíos)
      { hasta: Infinity, nombre: '5 o más vehículos', equipo: 390, mes: 65, roaming: 100, descSemestral: 0.05, descAnual: 0.1 },
    ],
    condiciones: [
      'El equipo GPS se vende al cliente y queda de su propiedad.',
      'El equipo se paga al momento de la instalación.',
      'El servicio de monitoreo se paga por mes adelantado.',
    ],
  },
  empresa: {
    nombre: 'Empresa (SRL o SA)',
    equipo: 'comodato', // el equipo se entrega en comodato
    tramos: [
      { hasta: 30, nombre: '1 a 30 unidades', equipo: 0, mes: 96, roaming: 110, descSemestral: 0.05, descAnual: 0.1 },
      // PENDIENTE DE CONFIRMAR: descuentos de 31 o más (en la planilla están vacíos)
      { hasta: Infinity, nombre: '31 unidades o más', equipo: 0, mes: 85, roaming: 100, descSemestral: 0.05, descAnual: 0.1 },
    ],
    condiciones: [
      'El equipo GPS se entrega en comodato, sin costo de equipo.',
      'El servicio de monitoreo se paga a mes vencido.',
    ],
  },
}

export const ACCESORIOS = [
  { id: 'relay', nombre: 'Corte de motor (relay)', precio: 90 },
  { id: 'temperatura', nombre: 'Sensor de temperatura', precio: 250 },
  { id: 'buzzer', nombre: 'Buzzer', precio: 50 },
  { id: 'llave', nombre: 'Llave magnética', precio: 50 },
  { id: 'puerta', nombre: 'Sensor de puerta', precio: 200 },
]

export const INCLUYE = [
  'Rastreo GPS en tiempo real en la plataforma LOC-AID',
  'Alertas y geocercas',
  'Reportes de recorridos, paradas y uso',
  'Acceso desde la aplicación móvil',
  'Soporte técnico local en Santa Cruz',
]

const r2 = (n) => Math.round(n * 100) / 100

// Calcula la cotización completa a partir de lo que carga el vendedor
export function cotizar({ tipo, unidades, conRoaming, accesorios, bonificar }) {
  const plan = PLANES[tipo]
  const n = Math.max(0, Math.floor(Number(unidades) || 0))
  const r = Math.min(n, Math.max(0, Math.floor(Number(conRoaming) || 0)))
  const tramo = plan.tramos.find((t) => n <= t.hasta)
  const puedeBonificar = n > UMBRAL_BONIFICAR
  const bonif = puedeBonificar && !!bonificar

  // Inversión inicial (pago único)
  const inicial = []
  inicial.push({
    concepto: plan.equipo === 'venta' ? 'Equipo GPS (venta)' : 'Equipo GPS (en comodato)',
    cant: n,
    unit: tramo.equipo,
    total: r2(n * tramo.equipo),
    nota: plan.equipo === 'comodato' ? 'Sin costo' : '',
  })
  for (const a of ACCESORIOS) {
    const c = Math.max(0, Math.floor(Number(accesorios?.[a.id]) || 0))
    if (!c) continue
    inicial.push({ concepto: a.nombre, cant: c, unit: a.precio, total: bonif ? 0 : r2(c * a.precio), nota: bonif ? 'Bonificado' : '' })
  }
  const totalInicial = r2(inicial.reduce((s, l) => s + l.total, 0))

  // Servicio mensual
  const mensual = []
  if (n - r > 0) mensual.push({ concepto: 'Monitoreo mensual', cant: n - r, unit: tramo.mes, total: r2((n - r) * tramo.mes) })
  if (r > 0) mensual.push({ concepto: 'Monitoreo mensual con roaming', cant: r, unit: tramo.roaming, total: r2(r * tramo.roaming) })
  const totalMensual = r2(mensual.reduce((s, l) => s + l.total, 0))

  const formasPago = [
    { nombre: 'Mensual', meses: 1, desc: 0 },
    { nombre: 'Semestral', meses: 6, desc: tramo.descSemestral },
    { nombre: 'Anual', meses: 12, desc: tramo.descAnual },
  ].filter((f) => f.meses === 1 || f.desc > 0).map((f) => {
    const total = r2(totalMensual * f.meses * (1 - f.desc))
    return { ...f, total, porMes: r2(total / f.meses) }
  })

  return {
    plan, tramo, unidades: n, conRoaming: r, puedeBonificar, bonificado: bonif,
    inicial, totalInicial, mensual, totalMensual, formasPago,
    condiciones: [
      ...plan.condiciones,
      `Contrato mínimo de ${CONTRATO_MESES} meses.`,
      'Precios expresados en bolivianos (Bs).',
    ],
  }
}
