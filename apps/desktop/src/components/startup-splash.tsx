import logo from '@/assets/logo.png'
import '../../boot-splash.css'

/** Same full-viewport centered logo + shine as the Electron BrowserView splash. */
export function StartupSplash() {
  return (
    <main className="mailrovers-startup-splash" aria-busy="true">
      <div className="startup-splash-logo">
        <img src={logo} alt="MailRovers" width={72} height={72} />
      </div>
    </main>
  )
}
