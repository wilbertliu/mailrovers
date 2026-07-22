import logo from '@/assets/logo.png'

/** Same full-viewport centered logo + shine as the Electron startup document. */
export function StartupSplash() {
  return (
    <main
      className="pointer-events-none fixed inset-0 grid place-items-center"
      aria-busy="true"
    >
      <div className="startup-splash-logo">
        <img src={logo} alt="MailRovers" width={72} height={72} />
      </div>
    </main>
  )
}
