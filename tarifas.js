// Tarifario de cotizaciones DISATEL.
// Los valores vigentes se editan en Cotizaciones → Configuración (se guardan en la base).
// CONFIG_BASE es el punto de partida y el respaldo si la base no tiene configuración.

export const CONFIG_BASE = {
  validezDias: 15,
  contratoMeses: 12,
  umbralBonificar: 20, // con más de esta cantidad de unidades se pueden bonificar los accesorios
  planes: {
    personal: {
      nombre: 'Personal',
      equipo: 'venta', // el equipo se vende al cliente
      limite: 4, // primer tramo: de 1 hasta este número de vehículos
      tramos: [
        { equipo: 390, mes: 85, roaming: 110, descSemestral: 0.05, descAnual: 0.1 },
        { equipo: 390, mes: 65, roaming: 100, descSemestral: 0.05, descAnual: 0.1 },
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
      limite: 30,
      tramos: [
        { equipo: 0, mes: 96, roaming: 110, descSemestral: 0.05, descAnual: 0.1 },
        { equipo: 0, mes: 85, roaming: 100, descSemestral: 0.05, descAnual: 0.1 },
      ],
      condiciones: [
        'El equipo GPS se entrega en comodato, sin costo de equipo.',
        'El servicio de monitoreo se paga a mes vencido.',
      ],
    },
  },
  accesorios: [
    { id: 'relay', nombre: 'Corte de motor (relay)', precio: 90 },
    { id: 'temperatura', nombre: 'Sensor de temperatura', precio: 250 },
    { id: 'buzzer', nombre: 'Buzzer', precio: 50 },
    { id: 'llave', nombre: 'Llave magnética', precio: 50 },
    { id: 'puerta', nombre: 'Sensor de puerta', precio: 200 },
  ],
}

export const INCLUYE = [
  'Rastreo GPS en tiempo real en la plataforma LOC-AID',
  'Alertas y geocercas',
  'Reportes de recorridos, paradas y uso',
  'Acceso desde la aplicación móvil',
  'Soporte técnico local en Santa Cruz',
]

const num = (v, d) => (v === '' || v == null || isNaN(Number(v)) ? d : Number(v))

// Completa una configuración guardada con los valores base (por si le falta algún dato)
export function normalizarConfig(c) {
  const b = CONFIG_BASE
  if (!c || typeof c !== 'object') return structuredClone(b)
  const plan = (k) => {
    const pb = b.planes[k], pc = c.planes?.[k] || {}
    return {
      ...pb,
      limite: Math.max(1, Math.floor(num(pc.limite, pb.limite))),
      tramos: pb.tramos.map((tb, i) => {
        const tc = pc.tramos?.[i] || {}
        return {
          equipo: num(tc.equipo, tb.equipo), mes: num(tc.mes, tb.mes), roaming: num(tc.roaming, tb.roaming),
          descSemestral: num(tc.descSemestral, tb.descSemestral), descAnual: num(tc.descAnual, tb.descAnual),
        }
      }),
      condiciones: Array.isArray(pc.condiciones) ? pc.condiciones.filter((x) => String(x).trim()) : pb.condiciones,
    }
  }
  return {
    validezDias: Math.max(1, Math.floor(num(c.validezDias, b.validezDias))),
    contratoMeses: Math.max(1, Math.floor(num(c.contratoMeses, b.contratoMeses))),
    umbralBonificar: Math.max(0, Math.floor(num(c.umbralBonificar, b.umbralBonificar))),
    planes: { personal: plan('personal'), empresa: plan('empresa') },
    accesorios: Array.isArray(c.accesorios)
      ? c.accesorios.filter((a) => a && String(a.nombre || '').trim()).map((a) => ({ id: String(a.id), nombre: String(a.nombre).trim(), precio: num(a.precio, 0) }))
      : b.accesorios,
  }
}

// Nombre legible de cada tramo según el límite configurado
export const nombreTramo = (plan, i) => (i === 0 ? `1 a ${plan.limite} vehículos` : `${plan.limite + 1} o más vehículos`)

const r2 = (n) => Math.round(n * 100) / 100

// Calcula la cotización completa a partir de lo que carga el vendedor y la configuración vigente
export function cotizar({ tipo, unidades, conRoaming, accesorios, bonificar }, config = CONFIG_BASE) {
  const cfg = config.planes?.personal?.limite ? config : normalizarConfig(config)
  const plan = cfg.planes[tipo] || cfg.planes.personal
  const n = Math.max(0, Math.floor(Number(unidades) || 0))
  const r = Math.min(n, Math.max(0, Math.floor(Number(conRoaming) || 0)))
  const iTramo = n <= plan.limite ? 0 : 1
  const tramo = { ...plan.tramos[iTramo], nombre: nombreTramo(plan, iTramo) }
  const puedeBonificar = n > cfg.umbralBonificar
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
  for (const a of cfg.accesorios) {
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
    plan, tramo, unidades: n, conRoaming: r, puedeBonificar, bonificado: bonif, umbralBonificar: cfg.umbralBonificar,
    inicial, totalInicial, mensual, totalMensual, formasPago,
    condiciones: [
      ...plan.condiciones,
      `Contrato mínimo de ${cfg.contratoMeses} meses.`,
      'Precios expresados en bolivianos (Bs).',
    ],
  }
}
