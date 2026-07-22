import sharedSplashCss from 'mailrovers:startup-splash-shared-css'

/** Script-free Electron startup HTML. Visuals come from `startup-splash-shared.css`. */
export function createStartupScreenDocument(logoSrc: string): string {
  return `<!doctype html>
<html lang="en" class="startup-splash-surface">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
    <meta name="color-scheme" content="light dark">
    <title>MailRovers</title>
    <style>
      ${sharedSplashCss}
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; }
      main { text-align: center; }
    </style>
  </head>
  <body>
    <main>
      <div class="startup-splash-logo">
        <img src="${logoSrc}" alt="MailRovers" width="72" height="72">
      </div>
    </main>
  </body>
</html>`
}
