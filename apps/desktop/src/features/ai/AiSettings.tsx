import type { MailboxId } from '@mailrovers/mail-domain'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { desktopBridge } from '../../desktop-bridge.js'

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
    <section className="conversation-list-panel ai-settings" aria-labelledby="ai-settings-title">
      <header className="list-header">
        <div>
          <h1 id="ai-settings-title">AI provider</h1>
          <p>Configured for this mailbox</p>
        </div>
        <button type="button" className="text-button" onClick={onClose}>
          Done
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label>
          <span>Base URL</span>
          <input
            type="url"
            required
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </label>
        <label>
          <span>Model</span>
          <input
            required
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Provider model identifier"
          />
        </label>
        <label>
          <span>API key</span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              configuration.data?.hasApiKey ? 'Stored securely. Enter to replace.' : 'Required'
            }
          />
        </label>
        <p className="ai-settings-note">
          MailRovers sends only the selected conversation to this provider. The key is encrypted on
          this Mac and cannot be read back.
        </p>
        {error ? (
          <p className="error-message" role="alert">
            {error}
          </p>
        ) : null}
        <div className="button-row">
          <button
            type="submit"
            disabled={
              status === 'saving' ||
              !baseUrl ||
              !model ||
              (!apiKey && !configuration.data?.hasApiKey)
            }
          >
            {status === 'saving' ? 'Saving…' : 'Save settings'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!configuration.data?.hasApiKey || status === 'testing'}
            onClick={() => void validate()}
          >
            {status === 'testing' ? 'Testing…' : 'Test connection'}
          </button>
        </div>
        <output className="ai-settings-status" aria-live="polite">
          {status === 'valid' || configuration.data?.state === 'valid'
            ? 'Connection verified.'
            : status === 'saved'
              ? 'Settings saved.'
              : configuration.data?.hasApiKey
                ? 'API key stored securely.'
                : ''}
        </output>
        {configuration.data?.hasApiKey ? (
          <button
            type="button"
            className="text-button remove-ai-settings"
            onClick={() => void clear()}
          >
            Remove AI configuration
          </button>
        ) : null}
      </form>
    </section>
  )
}
