import type { MailboxId } from '@mailrovers/mail-domain'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button.js'
import { desktopBridge } from '../../desktop-bridge.js'
import { Input } from '@/components/ui/input.js'

export function AiSettings({ mailboxId, onClose }: { mailboxId: MailboxId; onClose: () => void }) {
  const queryClient = useQueryClient()
  const configuration = useQuery({
    queryKey: ['ai-configuration', mailboxId],
    queryFn: () => desktopBridge.getAiConfiguration(mailboxId),
  })
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'testing' | 'saved' | 'valid'>('idle')
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (configuration.data?.baseUrl) setBaseUrl(configuration.data.baseUrl)
    if (configuration.data?.model) setModel(configuration.data.model)
  }, [configuration.data])

  const save = async () => {
    setStatus('saving')
    setError(undefined)
    try {
      await desktopBridge.saveAiConfiguration({
        mailboxId,
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {}),
      })
      setApiKey('')
      setStatus('saved')
      await queryClient.invalidateQueries({ queryKey: ['ai-configuration', mailboxId] })
    } catch (caught) {
      setStatus('idle')
      setError(caught instanceof Error ? caught.message : 'Could not save AI settings.')
    }
  }

  const validate = async () => {
    setStatus('testing')
    setError(undefined)
    try {
      await desktopBridge.validateAiConfiguration(mailboxId)
      setStatus('valid')
      await queryClient.invalidateQueries({ queryKey: ['ai-configuration', mailboxId] })
    } catch (caught) {
      setStatus('idle')
      setError(caught instanceof Error ? caught.message : 'Could not reach the AI provider.')
    }
  }

  const clear = async () => {
    if (!window.confirm('Remove the AI provider configuration and encrypted API key?')) return
    await desktopBridge.clearAiConfiguration(mailboxId)
    setApiKey('')
    setModel('')
    setBaseUrl('https://api.openai.com/v1')
    setStatus('idle')
    await queryClient.invalidateQueries({ queryKey: ['ai-configuration', mailboxId] })
  }

  return (
    <section
      className="min-w-0 overflow-hidden border-e border-border bg-surface"
      aria-labelledby="ai-settings-title"
    >
      <header className="flex h-19 items-center justify-between border-b border-border bg-surface px-4.5 py-4">
        <div>
          <h1 className="truncate text-lg leading-tight text-foreground" id="ai-settings-title">
            AI provider
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">Configured for this mailbox</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
      </header>
      <form
        className="overflow-y-auto px-4.5 py-5"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label
          htmlFor="ai-base-url"
          className="mb-4 flex flex-col gap-1.5 text-xs font-semibold text-foreground"
        >
          <span>Base URL</span>
          <Input
            id="ai-base-url"
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="url"
            required
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </label>
        <label
          htmlFor="ai-model"
          className="mb-4 flex flex-col gap-1.5 text-xs font-semibold text-foreground"
        >
          <span>Model</span>
          <Input
            id="ai-model"
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Provider model identifier"
          />
        </label>
        <label
          htmlFor="ai-api-key"
          className="mb-4 flex flex-col gap-1.5 text-xs font-semibold text-foreground"
        >
          <span>API key</span>
          <Input
            id="ai-api-key"
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              configuration.data?.hasApiKey ? 'Stored securely. Enter to replace.' : 'Required'
            }
          />
        </label>
        <p className="max-w-[48ch] text-xs leading-5 text-muted-foreground">
          MailRovers sends only the selected conversation to this provider. The key is encrypted on
          this Mac and cannot be read back.
        </p>
        {error ? (
          <p className="mt-3 text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-6.5 flex items-center gap-2">
          <Button
            type="submit"
            disabled={
              status === 'saving' ||
              !baseUrl ||
              !model ||
              (!apiKey && !configuration.data?.hasApiKey)
            }
          >
            {status === 'saving' ? 'Saving…' : 'Save settings'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!configuration.data?.hasApiKey || status === 'testing'}
            onClick={() => void validate()}
          >
            {status === 'testing' ? 'Testing…' : 'Test connection'}
          </Button>
        </div>
        <output className="mt-3 block min-h-4.5 text-xs text-success" aria-live="polite">
          {status === 'valid' || configuration.data?.state === 'valid'
            ? 'Connection verified.'
            : status === 'saved'
              ? 'Settings saved.'
              : configuration.data?.hasApiKey
                ? 'API key stored securely.'
                : ''}
        </output>
        {configuration.data?.hasApiKey ? (
          <Button
            type="button"
            variant="ghost"
            className="mt-4.5 px-0 text-destructive"
            onClick={() => void clear()}
          >
            Remove AI configuration
          </Button>
        ) : null}
      </form>
    </section>
  )
}
