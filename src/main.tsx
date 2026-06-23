import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import ConfigError from './components/ConfigError'
import { isSupabaseConfigured } from './lib/supabase'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSupabaseConfigured ? <App /> : <ConfigError />}
  </StrictMode>,
)
