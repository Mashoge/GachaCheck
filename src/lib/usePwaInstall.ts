import { useCallback, useEffect, useState } from 'react'

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string }

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<InstallChoice>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return displayMode || iosStandalone
}

/** Exposes the Chromium install prompt only after the browser says installation is available. */
export function usePwaInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)
  const [status, setStatus] = useState('')

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      const candidate = event as BeforeInstallPromptEvent
      if (typeof candidate.prompt !== 'function') return
      event.preventDefault()
      setInstallPrompt(candidate)
    }

    const onAppInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
      setStatus('GachaCheck was installed.')
    }

    const displayMode = window.matchMedia('(display-mode: standalone)')
    const onDisplayModeChange = (event: MediaQueryListEvent) => setInstalled(event.matches)

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    displayMode.addEventListener?.('change', onDisplayModeChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
      displayMode.removeEventListener?.('change', onDisplayModeChange)
    }
  }, [])

  const install = useCallback(async () => {
    const pending = installPrompt
    if (!pending) return

    // The event is single-use. Clear it before prompting so repeated taps cannot reuse it.
    setInstallPrompt(null)
    setStatus('')
    try {
      await pending.prompt()
      const choice = await pending.userChoice
      if (choice.outcome === 'accepted') {
        setInstalled(true)
        setStatus('GachaCheck was installed.')
      } else {
        setStatus('Installation was dismissed.')
      }
    } catch {
      setStatus('Installation could not start. Use your browser menu to install GachaCheck.')
    }
  }, [installPrompt])

  return { canInstall: !!installPrompt && !installed, install, status }
}
