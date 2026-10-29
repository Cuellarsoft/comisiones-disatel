import logo from './logo.png'

// Página pública (sin iniciar sesión): ventas-disatel.vercel.app/privacidad
// Meta la pide como "Privacy Policy URL" y "Data deletion instructions URL" para revisar la app de Facebook e Instagram.
export const DATOS = {
  razonSocial: '[razón social]',
  direccion: '[dirección], Santa Cruz de la Sierra, Bolivia',
  correo: '[correo de contacto]',
  telefono: '[teléfono]',
  meses: 24,
  actualizado: '29 de octubre de 2026',
}

export default function Privacidad() {
  const d = DATOS
  return (
    <div className="priv">
      <header className="priv-cab">
        <img src={logo} alt="DISATEL" />
      </header>
      <main className="priv-hoja">
        <h1>Política de privacidad</h1>
        <p className="priv-sub">DISATEL Bolivia · Última actualización: {d.actualizado}</p>

        <p>{d.razonSocial} (“DISATEL Bolivia”), con domicilio en {d.direccion}, es responsable de los datos personales que recibe cuando una persona se comunica con nosotros por WhatsApp, Facebook, Instagram, correo electrónico o teléfono.</p>

        <h2>Qué datos recibimos</h2>
        <ul>
          <li>Nombre e identificador público de la cuenta con la que nos escribe en Facebook, Instagram o WhatsApp, y su número de teléfono cuando nos escribe por WhatsApp.</li>
          <li>El contenido de los mensajes y comentarios que nos envía o deja en nuestras publicaciones.</li>
          <li>Los datos que usted mismo nos da para cotizar: correo, empresa, cantidad de vehículos u otros.</li>
        </ul>

        <h2>Para qué los usamos</h2>
        <ul>
          <li>Responder sus consultas y enviarle cotizaciones de nuestros servicios de rastreo GPS y monitoreo.</li>
          <li>Dar seguimiento comercial a su solicitud y atenderle como cliente.</li>
          <li>Llevar el registro interno de nuestras conversaciones con clientes y prospectos.</li>
        </ul>
        <p>No vendemos ni alquilamos sus datos, y no los usamos para publicidad de terceros.</p>

        <h2>Con quién los compartimos</h2>
        <p>Solo con los proveedores que nos permiten operar: Meta (Facebook, Instagram y WhatsApp), nuestro proveedor de mensajería de WhatsApp, nuestro proveedor de base de datos y alojamiento web, y nuestro proveedor de correo. Cada uno trata los datos solo para prestarnos su servicio.</p>

        <h2>Cuánto tiempo los guardamos</h2>
        <p>Mientras exista una relación comercial o una consulta abierta, y hasta {d.meses} meses después del último contacto. Luego los eliminamos.</p>

        <h2 id="eliminar">Cómo pedir que eliminemos sus datos</h2>
        <p>Puede pedirnos ver, corregir o eliminar sus datos en cualquier momento:</p>
        <ol>
          <li>Escríbanos a <b>{d.correo}</b> o por WhatsApp al <b>{d.telefono}</b>.</li>
          <li>Indique su nombre y la cuenta o número con el que nos escribió (Facebook, Instagram o WhatsApp).</li>
          <li>Eliminamos sus datos en un plazo máximo de 30 días y le confirmamos por el mismo medio.</li>
        </ol>

        <h2>Contacto</h2>
        <p>DISATEL Bolivia · {d.correo} · {d.telefono} · {d.direccion}</p>
      </main>
    </div>
  )
}
