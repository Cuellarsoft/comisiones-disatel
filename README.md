# Comisiones Disatel

Plataforma de comisiones del equipo de ventas (React + Vite + Supabase).

- `supabase/instalar.sql`: crea tablas, reglas de comisión/clawback/liquidación, seguridad por usuario y la carga inicial (admin + Jhon + ventas de la planilla). Se ejecuta una sola vez en Supabase → SQL Editor.
- Publicación: subir esta carpeta a un repositorio de GitHub e importarlo en Vercel (framework: Vite, sin variables de entorno).

## Reglas
- Comisión por unidad instalada y activada: precio mensual × % de la modalidad (se fija al registrar la venta).
- Bono mensual por unidades instaladas en el mes (tramos en Parámetros).
- Clawback por falta de pago: instalado y sin primer pago pasado el plazo (30 días) → 100 %. Si paga después → reintegro.
- Clawback por baja: mes 1 100 %, mes 2 50 %, mes 3 25 % (salvo "Causa Disatel / excepción").
- Liquidación mensual: comisiones no pagadas + bono − clawbacks pendientes + saldo negativo anterior.
