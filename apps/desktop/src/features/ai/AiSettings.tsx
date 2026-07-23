import type { MailboxId } from '@mailrovers/mail-domain'
import { SquareLock01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button.js'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.js'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field.js'
import { Input } from '@/components/ui/input.js'
import { Spinner } from '@/components/ui/spinner.js'
import { desktopBridge } from '../../desktop-bridge.js'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-5-mini'

type AiConfiguration = Awaited<ReturnType<typeof desktopBridge.getAiConfiguration>>

function AiSettingsForm({
  mailboxId,
  configuration,
  onClose,
}: {
  mailboxId: MailboxId
  configuration: AiConfiguration
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving'>('idle')
  const [error, setError] = useState<string>()
  const hasStoredKey = configuration.hasApiKey
  const saveLabel = hasStoredKey ? 'Replace API key' : 'Save API key'

  const save = async () => {
    const trimmed = apiKey.trim()
    if (trimmed.length === 0) return
    setStatus('saving')
    setError(undefined)
    try {
      await desktopBridge.saveAiConfiguration({
        mailboxId,
        baseUrl: configuration.baseUrl ?? DEFAULT_BASE_URL,
        model: configuration.model ?? DEFAULT_MODEL,
        apiKey: trimmed,
      })
      setApiKey('')
      await queryClient.invalidateQueries({ queryKey: ['ai-configuration', mailboxId] })
      onClose()
    } catch (caught) {
      setStatus('idle')
      setError(caught instanceof Error ? caught.message : 'Could not save AI settings.')
    }
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <DialogHeader>
        <DialogTitle>OpenAI API key</DialogTitle>
        <DialogDescription>
          Paste your OpenAI API key for this mailbox. If you already saved one, this replaces it.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="ai-api-key">API key</FieldLabel>
          <Input
            id="ai-api-key"
            type="password"
            autoComplete="off"
            autoFocus
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={hasStoredKey ? 'Enter a new key to replace the stored one' : 'sk-…'}
          />
          <FieldDescription>
            {hasStoredKey
              ? 'A key is already stored for this mailbox. Saving replaces it permanently.'
              : 'Required to summarize conversations and draft replies.'}
          </FieldDescription>
        </Field>
        <div className="flex flex-col gap-2 rounded-lg border px-4 py-3">
          <p className="flex items-center gap-2 font-medium">
            <HugeiconsIcon icon={SquareLock01Icon} size={14} strokeWidth={2} aria-hidden="true" />
            How we store your key
          </p>
          <p className="text-sm text-muted-foreground">
            Encrypted with this Mac&apos;s Keychain and kept only on your device. After you save, we
            can&apos;t read it back—and it&apos;s sent only to OpenAI when you use AI.
          </p>
        </div>
      </FieldGroup>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={status === 'saving' || apiKey.trim().length === 0}>
          {status === 'saving' ? <Spinner data-icon="inline-start" /> : null}
          {status === 'saving' ? 'Saving…' : saveLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function AiSettingsDialog({
  mailboxId,
  open,
  onOpenChange,
}: {
  mailboxId: MailboxId
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const configuration = useQuery({
    queryKey: ['ai-configuration', mailboxId],
    queryFn: () => desktopBridge.getAiConfiguration(mailboxId),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {configuration.data === undefined ? (
          <>
            <DialogHeader>
              <DialogTitle>OpenAI API key</DialogTitle>
              <DialogDescription>
                Paste your OpenAI API key for this mailbox. If you already saved one, this replaces
                it.
              </DialogDescription>
            </DialogHeader>
            <p role={configuration.isError ? 'alert' : undefined}>
              {configuration.isError ? 'Could not load AI settings.' : 'Loading AI settings…'}
            </p>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Close</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <AiSettingsForm
            key={`${mailboxId}-${configuration.data.hasApiKey ? 'configured' : 'empty'}-${open}`}
            mailboxId={mailboxId}
            configuration={configuration.data}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
