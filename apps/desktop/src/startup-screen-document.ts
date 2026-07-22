/** Script-free Electron startup HTML. Shine rules stay aligned with `boot-splash.css`. */
export function createStartupScreenDocument(logoSrc: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
    <meta name="color-scheme" content="light dark">
    <title>MailRovers</title>
    <style>
      :root { color: light-dark(#171717, #fafafa); background: light-dark(#fff, #242424); }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; }
      main { text-align: center; }
      .logo-shine {
        position: relative;
        display: inline-block;
        line-height: 0;
        overflow: hidden;
        border-radius: 18px;
      }
      .logo-shine img {
        display: block;
        width: 72px;
        height: 72px;
      }
      .logo-shine::after {
        content: '';
        position: absolute;
        inset: 0;
        background-image: linear-gradient(
          120deg,
          rgba(255, 255, 255, 0) 35%,
          rgba(255, 255, 255, 0.85) 50%,
          rgba(255, 255, 255, 0) 65%
        );
        background-size: 200% auto;
        animation: shine 2s linear infinite;
        pointer-events: none;
        mix-blend-mode: soft-light;
      }
      @keyframes shine {
        0% { background-position: 150% center; }
        100% { background-position: -50% center; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="logo-shine">
        <img src="${logoSrc}" alt="MailRovers" width="72" height="72">
      </div>
    </main>
  </body>
</html>`
}
