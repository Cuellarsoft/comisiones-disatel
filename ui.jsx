import { createContext, useContext, useEffect } from 'react'
import { bonoInfo, bs0 } from './lib'

export const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

export function Modal({ titulo, onClose, children, pie, ancho, className = '' }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className={'velo ' + className} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={'modal' + (ancho ? ' ancho' : '')} role="dialog" aria-modal="true">
        <div className="mh no-print">
          <h2>{titulo}</h2>
          <button onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="mb">{children}</div>
        {pie && <div className="mf no-print">{pie}</div>}
      </div>
    </div>
  )
}

export function Cabecera({ titulo, sub, children }) {
  return (
    <div className="cab">
      <div>
        <h1>{titulo}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="acciones">{children}</div>}
    </div>
  )
}

export function Kpi({ l, v, s, tono }) {
  return (
    <div className={'card kpi ' + (tono || '')}>
      <div className="l">{l}</div>
      <div className="v num">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  )
}

export function Campo({ label, ayuda, children, full }) {
  return (
    <div className={'campo' + (full ? ' full' : '')}>
      <label>{label}</label>
      {children}
      {ayuda && <span className="ayuda">{ayuda}</span>}
    </div>
  )
}

export function Error({ msg }) {
  return msg ? <div className="error">{msg}</div> : null
}

export function Cargando() {
  return <div className="vacio">Cargando…</div>
}

// Barra de progreso hacia los bonos del mes
export function BonoBarra({ unidades, bonos }) {
  const info = bonoInfo(unidades, bonos)
  const tope = Math.max(info.max * 1.08, unidades)
  const tiers = [...bonos].sort((a, b) => a.min - b.min)
  return (
    <div className="bono">
      <div className="barra"><i style={{ width: Math.min(100, (unidades / tope) * 100) + '%' }} /></div>
      <div className="marcas">
        {tiers.map((t) => (
          <span key={t.min} className={unidades >= t.min ? 'ok' : ''} style={{ left: (t.min / tope) * 100 + '%' }}>
            <b>{t.min}</b>{bs0(t.bono)}
          </span>
        ))}
      </div>
    </div>
  )
}

export function MiniBarra({ valor, max }) {
  return <div className="mini-barra"><i style={{ width: Math.min(100, (valor / Math.max(max, 1)) * 100) + '%' }} /></div>
}
