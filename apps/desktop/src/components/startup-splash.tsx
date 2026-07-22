import logo from '@/assets/logo.png'
import '../../boot-splash.css'

/** Full-viewport centered logo + shine; styles shared via `startup-splash-shared.css`. */
export function StartupSplash() {
  return (
    <main className="mailrovers-startup-splash startup-splash-surface" aria-busy="true">
      <div className="startup-splash-logo">
        <img src={logo} alt="MailRovers" width={72} height={72} />
      </div>
    </main>
  )
}
