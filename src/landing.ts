import './styles.css'

const KEY = 'groomingflow-lang'

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function pickLanguage(): 'el' | 'en' {
  const stored = readStored()
  const raw = (stored ?? navigator.language ?? 'en').toLowerCase()
  return raw.startsWith('el') ? 'el' : 'en'
}

const lang = pickLanguage()
document.documentElement.lang = lang
document.querySelectorAll<HTMLElement>('[data-lang]').forEach((el) => {
  el.hidden = el.dataset.lang !== lang
})
document.querySelectorAll<HTMLButtonElement>('[data-set-lang]').forEach((button) => {
  button.setAttribute('aria-pressed', String(button.dataset.setLang === lang))
  button.addEventListener('click', () => {
    try {
      localStorage.setItem(KEY, button.dataset.setLang ?? 'en')
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    location.reload()
  })
})
