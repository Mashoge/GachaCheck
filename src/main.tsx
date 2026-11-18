import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App'
import { browserSaveData, readChoice, resolveDataSaver } from './lib/dataSaver'

// THM-7/THM-10: mark Data saver before the first frame, so what it turns off is never shown at all
document.documentElement.toggleAttribute('data-saver', resolveDataSaver(readChoice(), browserSaveData()))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)