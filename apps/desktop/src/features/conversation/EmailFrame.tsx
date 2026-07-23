import { useLayoutEffect, useRef, useState } from 'react'

function emailDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>html{color:#202722;background:#fff;font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}body{margin:0;overflow-wrap:anywhere}a{color:#315f46}img{max-width:100%;height:auto}blockquote{margin-inline:0;padding-inline-start:14px;border-inline-start:1px solid #d9dfda;color:#5e6861}pre{white-space:pre-wrap}</style></head><body>${html}</body></html>`
}

export function measureEmailFrameHeight(iframe: HTMLIFrameElement): number {
  const doc = iframe.contentDocument
  if (!doc?.documentElement) return 0
  const { documentElement, body } = doc
  return Math.ceil(
    Math.max(
      documentElement.scrollHeight,
      documentElement.offsetHeight,
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
    ),
  )
}

export function EmailFrame({ html, title }: { html: string; title: string }) {
  const disposeRef = useRef<(() => void) | undefined>(undefined)
  const [height, setHeight] = useState<number>()

  useLayoutEffect(() => {
    setHeight(undefined)
    return () => {
      disposeRef.current?.()
      disposeRef.current = undefined
    }
  }, [html])

  return (
    <iframe
      className="block w-full border-0"
      style={{ height: height ?? 64 }}
      title={title}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      srcDoc={emailDocument(html)}
      onLoad={(event) => {
        const iframe = event.currentTarget
        disposeRef.current?.()

        const disposers: Array<() => void> = []
        const syncHeight = () => {
          const next = measureEmailFrameHeight(iframe)
          if (next > 0) setHeight(next)
        }

        syncHeight()

        const doc = iframe.contentDocument
        if (doc) {
          for (const img of Array.from(doc.images)) {
            if (img.complete) continue
            const onDone = () => syncHeight()
            img.addEventListener('load', onDone)
            img.addEventListener('error', onDone)
            disposers.push(() => {
              img.removeEventListener('load', onDone)
              img.removeEventListener('error', onDone)
            })
          }

          if (typeof ResizeObserver !== 'undefined' && doc.body) {
            const observer = new ResizeObserver(() => syncHeight())
            observer.observe(doc.body)
            disposers.push(() => observer.disconnect())
          }
        }

        disposeRef.current = () => {
          for (const dispose of disposers) dispose()
        }
      }}
    />
  )
}
