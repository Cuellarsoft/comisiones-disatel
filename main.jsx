import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Privacidad from './Privacidad'
import './styles.css'

// La política de privacidad es pública: se ve sin iniciar sesión
const publica = location.pathname.replace(/\/+$/, '') === '/privacidad'
ReactDOM.createRoot(document.getElementById('root')).render(publica ? <Privacidad /> : <App />)
