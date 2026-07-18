import {
  Archive02Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  Attachment01Icon,
  Clock01Icon,
  InboxIcon,
  Mail02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  Search01Icon,
  SentIcon,
  Settings02Icon,
  StarIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ReactNode } from 'react'

export type WorkspaceLinearState =
  | 'populated'
  | 'empty'
  | 'loading'
  | 'error'
  | 'labels-loading'
  | 'labels-error'
  | 'conversation'
  | 'search'
  | 'drafts'
  | 'drafts-empty'
  | 'drafts-loading'
  | 'command-issue'
  | 'gmail-issue'
  | 'refresh-cache-error'
  | 'offline'
  | 'refreshing'
  | 'refresh-failed'
  | 'refresh-complete'
  | 'refresh-cancelled'
  | 'refresh-deferred'
  | 'refresh-active'
  | 'archive-undo'
import './workspace-linear-redesign.css'

const threads = [
  {
    sender: 'Maya Chen',
    subject: 'Launch checklist and final copy',
    preview: 'Everything is ready on my side. Please check the attached launch checklist.',
    time: '8:30 AM',
    unread: true,
    tag: 'Launch',
  },
  {
    sender: 'Pine & Co.',
    subject: 'Invoice for July',
    preview: 'Attached is the July invoice. Payment remains due on August 1.',
    time: 'Yesterday',
    tag: 'Finance',
  },
  {
    sender: 'Studio team',
    subject: 'Friday team notes',
    preview: 'Decisions, open questions, and owners from Friday afternoon.',
    time: 'Jul 9',
    unread: true,
    tag: 'Team',
  },
  {
    sender: 'Harper Stone',
    subject: 'Copy review: homepage',
    preview: 'I made the headings more direct and consolidated the proof points.',
    time: 'Jul 8',
    tag: 'Review',
  },
  {
    sender: 'Noah Williams',
    subject: 'Re: Q3 planning',
    preview: 'Tuesday works. I added an agenda and the latest revenue numbers.',
    time: 'Jul 8',
    tag: 'Planning',
  },
  {
    sender: 'Rowan Bell',
    subject: 'Updated brand assets',
    preview: 'The exports now include the monochrome logo and social crops.',
    time: 'Jul 7',
    tag: 'Design',
  },
]

function Icon({
  icon,
  size = 15,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  size?: number
}) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.7} aria-hidden="true" />
}

function IconButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button className="linear-redesign__icon-button" type="button" aria-label={label}>
      {children}
    </button>
  )
}

function sidebarStatus(state: WorkspaceLinearState): string {
  switch (state) {
    case 'offline':
      return 'Offline cache retained'
    case 'refreshing':
      return 'Refreshing…'
    case 'refresh-failed':
      return 'Gmail could not be reached'
    case 'refresh-complete':
      return 'Refresh complete.'
    case 'refresh-cancelled':
      return 'Refresh cancelled.'
    case 'refresh-deferred':
      return 'Refresh deferred until 9:45 AM'
    case 'refresh-active':
      return 'Refresh already active.'
    case 'refresh-cache-error':
      return 'Refresh failed · Using saved mailbox data'
    default:
      return 'Synced just now'
  }
}

function Sidebar({ state }: { state: WorkspaceLinearState }) {
  return (
    <aside className="linear-redesign__sidebar">
      <button className="linear-redesign__workspace-switcher" type="button">
        <span>MR</span>
        <strong>MailRovers</strong>
        <Icon icon={ArrowDown01Icon} size={12} />
      </button>

      <button className="linear-redesign__command" type="button">
        <Icon icon={Search01Icon} />
        <span>Search</span>
        <kbd>⌘ K</kbd>
      </button>

      {state === 'labels-loading' ? (
        <p className="linear-redesign__state-note">Loading labels…</p>
      ) : null}
      <nav aria-label="Workspace navigation">
        {state === 'labels-error' ? null : (
          <button className="is-active" type="button">
            <Icon icon={InboxIcon} />
            <span>Inbox</span>
            <small>4</small>
          </button>
        )}
        <button type="button">
          <Icon icon={StarIcon} />
          <span>Starred</span>
        </button>
        <button type="button">
          <Icon icon={Clock01Icon} />
          <span>Snoozed</span>
        </button>
        <button type="button">
          <Icon icon={SentIcon} />
          <span>Sent</span>
        </button>
        <button type="button">
          <Icon icon={Mail02Icon} />
          <span>Drafts</span>
          <small>2</small>
        </button>
      </nav>

      <div className="linear-redesign__section-label">Workspaces</div>
      <nav aria-label="Mail workspaces">
        <button type="button">
          <i className="is-violet" />
          <span>Launch</span>
        </button>
        <button type="button">
          <i className="is-amber" />
          <span>Finance</span>
        </button>
        <button type="button">
          <i className="is-teal" />
          <span>Studio</span>
        </button>
      </nav>

      <button className="linear-redesign__compose" type="button">
        <Icon icon={PencilEdit02Icon} />
        <span>New message</span>
        <kbd>C</kbd>
      </button>

      <footer>
        <span className="linear-redesign__avatar">AM</span>
        <div>
          <strong>Alex Morgan</strong>
          <small>{sidebarStatus(state)}</small>
        </div>
        <IconButton label="Open settings">
          <Icon icon={Settings02Icon} />
        </IconButton>
      </footer>
    </aside>
  )
}

function InboxList({ state }: { state: WorkspaceLinearState }) {
  const title =
    state === 'search' ? 'Search' : state.startsWith('drafts') ? 'Local drafts' : 'Inbox'
  const statusMessage =
    state === 'loading'
      ? 'Loading mail…'
      : state === 'error'
        ? 'Unable to load local mail.'
        : state === 'empty'
          ? 'No conversations in this view.'
          : state === 'drafts-empty'
            ? 'No local drafts.'
            : undefined
  return (
    <section className="linear-redesign__inbox" aria-label={title}>
      <header>
        <div>
          <p>{state === 'search' ? 'Local results' : 'Workspace'}</p>
          <h1>
            {title} <span>{state === 'empty' || state === 'drafts-empty' ? 0 : 4}</span>
          </h1>
        </div>
        <IconButton label="Inbox actions">
          <Icon icon={MoreHorizontalIcon} />
        </IconButton>
      </header>
      <div className="linear-redesign__list-toolbar">
        <span>
          {state === 'drafts-loading'
            ? '0 saved on this Mac'
            : state.startsWith('drafts')
              ? '2 saved on this Mac'
              : '38 conversations'}
        </span>
        <button type="button">
          Newest <Icon icon={ArrowDown01Icon} size={11} />
        </button>
      </div>
      <div className="linear-redesign__thread-list">
        {statusMessage ? (
          <p className="linear-redesign__empty" role={state === 'error' ? 'alert' : undefined}>
            {statusMessage}
          </p>
        ) : null}
        {statusMessage === undefined
          ? threads.slice(0, state.startsWith('drafts') ? 2 : undefined).map((thread, index) => (
              <button
                className={`linear-redesign__thread${index === 0 ? ' is-selected' : ''}${thread.unread ? ' is-unread' : ''}`}
                type="button"
                aria-label={`Open conversation: ${thread.subject}`}
                aria-pressed={index === 0}
                key={thread.subject}
              >
                <span className="linear-redesign__unread-dot" />
                <div>
                  <div className="linear-redesign__sender-row">
                    <strong>{thread.sender}</strong>
                    <time>{thread.time}</time>
                  </div>
                  <p className="linear-redesign__subject">{thread.subject}</p>
                  <p className="linear-redesign__preview">{thread.preview}</p>
                  <span className="linear-redesign__tag">{thread.tag}</span>
                </div>
              </button>
            ))
          : null}
      </div>
    </section>
  )
}

function Message({ latest = false }: { latest?: boolean }) {
  return (
    <article className={`linear-redesign__message${latest ? ' is-latest' : ''}`}>
      <header>
        <span className="linear-redesign__message-avatar">MC</span>
        <div>
          <strong>Maya Chen</strong>
          <p>maya@example.com · to Alex Morgan</p>
        </div>
        <time>{latest ? 'Today at 8:30 AM' : 'Yesterday at 4:15 PM'}</time>
      </header>
      <div className="linear-redesign__message-content">
        {latest ? (
          <p>
            Everything is ready on my side. Please check the attached launch checklist before we
            schedule the announcement.
            <br />
            <br />
            Thanks,
            <br />
            Maya
          </p>
        ) : (
          <p>
            Hi Alex,
            <br />
            <br />
            The final review is complete. I left two small notes on the launch email and updated the
            checklist.
            <br />
            <br />
            Maya
          </p>
        )}
        {latest ? (
          <button className="linear-redesign__attachment" type="button">
            <span>
              <Icon icon={Attachment01Icon} />
            </span>
            <div>
              <strong>launch-checklist.pdf</strong>
              <small>242 KB</small>
            </div>
            <b>Open</b>
          </button>
        ) : null}
      </div>
    </article>
  )
}

function Reader({ state }: { state: WorkspaceLinearState }) {
  const showConversation = [
    'populated',
    'conversation',
    'search',
    'command-issue',
    'gmail-issue',
    'archive-undo',
  ].includes(state)
  return (
    <article className="linear-redesign__reader" aria-label="Launch checklist and final copy">
      <header className="linear-redesign__reader-toolbar">
        <IconButton label="Back to inbox">
          <Icon icon={ArrowLeft01Icon} />
        </IconButton>
        <span />
        <IconButton label="Archive conversation">
          <Icon icon={Archive02Icon} />
        </IconButton>
        <IconButton label="Snooze conversation">
          <Icon icon={Clock01Icon} />
        </IconButton>
        <IconButton label="More conversation actions">
          <Icon icon={MoreHorizontalIcon} />
        </IconButton>
      </header>
      {showConversation ? (
        <div className="linear-redesign__reader-scroll">
          <header className="linear-redesign__thread-header">
            <p>
              <span>Inbox</span>
              <b>/</b>
              <span>Launch</span>
            </p>
            <h2>Launch checklist and final copy</h2>
            <div>
              <span>MC</span>
              <span>AM</span>
              <small>2 messages</small>
            </div>
          </header>
          <Message />
          <Message latest />
          <button className="linear-redesign__reply" type="button">
            <span>Reply to Maya…</span>
            <kbd>R</kbd>
          </button>
        </div>
      ) : (
        <div className="linear-redesign__reader-empty">
          <strong>Select a conversation</strong>
          <p>Messages stay on this Mac and open from the local cache.</p>
        </div>
      )}
    </article>
  )
}

function Properties() {
  return (
    <aside className="linear-redesign__properties">
      <header>
        <strong>Details</strong>
        <IconButton label="Close details">
          <Icon icon={ArrowDown01Icon} />
        </IconButton>
      </header>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>
            <i className="is-open" /> Open
          </dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>Normal</dd>
        </div>
        <div>
          <dt>Label</dt>
          <dd>
            <i className="is-violet" /> Launch
          </dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>8:30 AM</dd>
        </div>
      </dl>
      <section>
        <h3>People</h3>
        <span>
          <i>MC</i>
          <b>Maya Chen</b>
        </span>
        <span>
          <i>AM</i>
          <b>Alex Morgan</b>
        </span>
      </section>
      <section>
        <h3>Attachment</h3>
        <button type="button">
          <Icon icon={Attachment01Icon} />
          <span>launch-checklist.pdf</span>
        </button>
      </section>
      <footer>Available offline</footer>
    </aside>
  )
}

export function WorkspaceLinearRedesign({ state = 'populated' }: { state?: WorkspaceLinearState }) {
  const issue =
    state === 'command-issue'
      ? 'Confirm whether this message was sent'
      : state === 'gmail-issue'
        ? 'A Gmail change needs attention'
        : undefined
  return (
    <main className="linear-redesign">
      <section className="linear-redesign__app">
        <Sidebar state={state} />
        <InboxList state={state} />
        <Reader state={state} />
        <Properties />
        {issue ? (
          <aside className="linear-redesign__notice" role="alert">
            <strong>{issue}</strong>
            <p>MailRovers paused instead of risking a duplicate action.</p>
            <button type="button">Dismiss</button>
          </aside>
        ) : null}
        {state === 'archive-undo' ? (
          <aside className="linear-redesign__notice">
            <strong>Conversation archived.</strong>
            <button type="button">Undo archive</button>
          </aside>
        ) : null}
      </section>
    </main>
  )
}
