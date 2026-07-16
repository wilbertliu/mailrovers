function emailDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>html{color:#202722;background:#fff;font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}body{margin:0;overflow-wrap:anywhere}a{color:#315f46}img{max-width:100%;height:auto}blockquote{margin-inline:0;padding-inline-start:14px;border-inline-start:1px solid #d9dfda;color:#5e6861}pre{white-space:pre-wrap}</style></head><body>${html}</body></html>`
}

export function EmailFrame({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      className="min-h-70 w-full"
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={emailDocument(html)}
    />
  )
}
