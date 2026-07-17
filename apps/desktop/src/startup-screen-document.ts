export const startupScreenDocument = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <meta name="color-scheme" content="light dark">
    <title>MailRovers</title>
    <style>
      :root { font: 15px system-ui, sans-serif; color: #171717; background: #fff; }
      @media (prefers-color-scheme: dark) { :root { color: #fafafa; background: #242424; } }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; }
      main { text-align: center; }
      h1 { margin: 0 0 8px; font-size: 20px; font-weight: 650; }
      p { margin: 0; color: #737373; }
    </style>
  </head>
  <body><main><h1>MailRovers</h1><p>Opening your mailbox…</p></main></body>
</html>`
