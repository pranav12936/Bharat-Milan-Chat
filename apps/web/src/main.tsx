
import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { createRoot } from 'react-dom/client';
import './styles.css';

const api = (
  import.meta.env.VITE_CHAT_API_URL || 'http://localhost:3001'
).replace(/\/+$/, '');

const mainAppOrigin = (
  import.meta.env.VITE_BHARAT_MILAN_ORIGIN ||
  'http://localhost:3000'
).replace(/\/+$/, '');

const mainApi = (
  import.meta.env.VITE_BHARAT_MILAN_API_URL ||
  (mainAppOrigin === 'https://bharat-milan.onrender.com'
    ? 'https://bharat-milan-api.onrender.com'
    : mainAppOrigin)
).replace(/\/+$/, '');

const allowedMainAppOrigins = new Set([
  mainAppOrigin,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://bharat-milan.onrender.com',
]);

type Me = {
  id: string;
  displayName: string;
};

type Message = {
  id: string;
  mediaType?: 'image' | null;
  content?: string | null;
  createdAt: string;
  senderIdentityId: string;
};

type Conversation = {
  id: string;
};

type BMProfile = {
  fullName?: string | null;
  displayName?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  photoUrl?: string | null;
  profilePhotoUrl?: string | null;
  avatarUrl?: string | null;
  [key: string]: unknown;
};

type BMContact = {
  userId: string;
  profile?: BMProfile | null;
  fullName?: string | null;
  displayName?: string | null;
  name?: string | null;
};

type ContactsResponse = {
  contacts?: BMContact[];
};

type AuthMessage = {
  type: 'BHARAT_MILAN_AUTH';
  token: string;
};

type Page = 'home' | 'chat';
type Theme = 'light' | 'dark';

async function call<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  let body = init.body;

  if (
    method === 'POST' &&
    body == null &&
    !headers.has('content-type')
  ) {
    headers.set('content-type', 'application/json');
    body = '{}';
  }

  const response = await fetch(`${api}${path}`, {
    ...init,
    method,
    headers,
    body,
    credentials: 'include',
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));

    const detail =
      result &&
      typeof result === 'object' &&
      'error' in result &&
      typeof result.error === 'string'
        ? result.error
        : result &&
            typeof result === 'object' &&
            'message' in result &&
            typeof result.message === 'string'
          ? result.message
          : `Request failed (${response.status})`;

    throw new Error(detail);
  }

  if (response.status === 204) return null as T;

  return (await response.json()) as T;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function fetchBharatMilanProfileName(
  token: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${mainApi}/api/profile/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) return null;

    const result: unknown = await response.json();
    if (!result || typeof result !== 'object') return null;

    const data = result as Record<string, unknown>;
    const nested =
      data.profile && typeof data.profile === 'object'
        ? (data.profile as Record<string, unknown>)
        : data;

    const fullName = nonEmptyString(nested.fullName);
    if (fullName) return fullName;

    const displayName = nonEmptyString(nested.displayName);
    if (displayName) return displayName;

    const name = nonEmptyString(nested.name);
    if (name) return name;

    const combined = [
      nonEmptyString(nested.firstName),
      nonEmptyString(nested.lastName),
    ]
      .filter(Boolean)
      .join(' ');

    return combined || null;
  } catch {
    return null;
  }
}

function getContactName(contact: BMContact | null): string {
  if (!contact) return 'Conversation';

  const profile = contact.profile;
  const fullName = nonEmptyString(profile?.fullName);
  if (fullName) return fullName;

  const displayName =
    nonEmptyString(profile?.displayName) ||
    nonEmptyString(contact.displayName);

  if (displayName) return displayName;

  const name =
    nonEmptyString(profile?.name) ||
    nonEmptyString(contact.fullName) ||
    nonEmptyString(contact.name);

  if (name) return name;

  const firstName = nonEmptyString(profile?.firstName);
  const lastName = nonEmptyString(profile?.lastName);
  const combinedName = `${firstName ?? ''} ${lastName ?? ''}`.trim();

  return combinedName || 'Name unavailable';
}

function getAvatarLetter(name: string): string {
  return name.trim().charAt(0).toUpperCase() || 'B';
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [bmContacts, setBmContacts] = useState<BMContact[]>([]);
  const [bmSelected, setBmSelected] = useState<BMContact | null>(null);
  const [bmIntegrated, setBmIntegrated] = useState(false);
  const [authenticating, setAuthenticating] = useState(true);
  const chatRequestId = useRef(0);
  const [conversation, setConversation] =
    useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');

  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('bm-chat-theme') === 'dark'
        ? 'dark'
        : 'light';
    } catch {
      return 'light';
    }
  });

  const [showDetails, setShowDetails] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [page, setPage] = useState<Page>(
    window.location.pathname.startsWith('/chat/') ? 'chat' : 'home',
  );

  const authRequestId = useRef(0);
  const authInProgress = useRef(false);
  const successfulToken = useRef<string | null>(null);
  const busyRef = useRef(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const otherUser = bmSelected?.userId ?? '';
  const otherName = getContactName(bmSelected);

  const addMessage = useCallback((message: Message) => {
    if (!message?.id) return;

    setMessages((current) => {
      const updated = [
        ...current.filter((item) => item.id !== message.id),
        message,
      ];

      return updated.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() -
          new Date(b.createdAt).getTime(),
      );
    });
  }, []);

  const getPhotoUrl = useCallback(async (id: string) => {
    const result = await call<{ url: string }>(
      `/media/${encodeURIComponent(id)}/url`,
    );

    if (!result?.url) {
      throw new Error('The server did not return a photo URL.');
    }

    return result.url;
  }, []);

  // Bharat Milan authentication handoff.
  useEffect(() => {
    let cancelled = false;

    const receive = async (event: MessageEvent) => {
      if (!allowedMainAppOrigins.has(event.origin)) return;

      const trustedWindow =
        event.source === window.parent ||
        event.source === window.opener;

      if (!trustedWindow) return;

      const data = event.data as Partial<AuthMessage> | null;

      if (
        !data ||
        data.type !== 'BHARAT_MILAN_AUTH' ||
        typeof data.token !== 'string' ||
        !data.token.trim()
      ) {
        return;
      }

      const token = data.token.trim();

      if (authInProgress.current) return;
      if (successfulToken.current === token && bmIntegrated) return;

      authInProgress.current = true;
      const requestId = ++authRequestId.current;

      setAuthenticating(true);
      setError('');
      setBusy(true);

      try {
        const response = await fetch(`${api}/auth/bharat-milan`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          credentials: 'include',
          body: '{}',
        });

        if (!response.ok) {
          throw new Error(
            'Chat sign-in failed. Return to Bharat Milan and try again.',
          );
        }

        const identity = await call<Me>('/me');

        if (!identity?.id) {
          throw new Error('The chat server returned an invalid account.');
        }

        const bharatMilanName = await fetchBharatMilanProfileName(token);

        const signedInMember: Me = {
          ...identity,
          displayName:
            bharatMilanName ||
            (identity.displayName &&
            identity.displayName !== 'Bharat Milan Member'
              ? identity.displayName
              : 'Name unavailable'),
        };

        const contactsResponse = await fetch(
          `${mainApi}/api/chat/contacts`,
          {
            headers: {
              authorization: `Bearer ${token}`,
            },
            credentials: 'include',
          },
        );

        if (!contactsResponse.ok) {
          throw new Error(
            'Could not load accepted-interest contacts. Please try again.',
          );
        }

        const payload =
          (await contactsResponse.json()) as ContactsResponse;

        const contacts = Array.isArray(payload.contacts)
          ? payload.contacts.filter(
              (contact) =>
                typeof contact?.userId === 'string' &&
                contact.userId.trim().length > 0,
            )
          : [];

        if (cancelled || requestId !== authRequestId.current) return;

        setMe(signedInMember);
        setBmContacts(contacts);
        setBmSelected(null);
        setConversation(null);
        setMessages([]);
        setDraft('');
        setSearch('');
        setPage('home');
        setShowDetails(false);
        setShowSettings(false);
        setBmIntegrated(true);

        successfulToken.current = token;
        setAuthenticating(false);
        window.history.replaceState({}, '', '/');
      } catch (err) {
        if (!cancelled && requestId === authRequestId.current) {
          setError(
            err instanceof Error
              ? err.message
              : 'Bharat Milan authentication failed.',
          );
          setAuthenticating(false);
        }
      } finally {
        authInProgress.current = false;

        if (!cancelled && requestId === authRequestId.current) {
          setBusy(false);
        }
      }
    };

    window.addEventListener('message', receive);

    const parentWindow =
      window.parent !== window ? window.parent : window.opener;

    if (parentWindow) {
      parentWindow.postMessage(
        { type: 'BHARAT_MILAN_CHAT_READY' },
        mainAppOrigin,
      );
    }

    return () => {
      cancelled = true;
      window.removeEventListener('message', receive);
    };
  }, [bmIntegrated]);

  useEffect(() => {
    try {
      localStorage.setItem('bm-chat-theme', theme);
    } catch {
      // Theme remains available for the current session.
    }
  }, [theme]);

  useEffect(() => {
    const handlePopState = () => {
      const isChat = window.location.pathname.startsWith('/chat/');
      setPage(isChat && conversation ? 'chat' : 'home');
      setShowDetails(false);
      setShowSettings(false);
      setError('');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [conversation]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }, [messages]);

  // Live message updates.
  useEffect(() => {
    if (!conversation) return;

    let socket: ReturnType<typeof io> | undefined;
    let cancelled = false;

    call<{ token: string }>('/auth/socket-token')
      .then(({ token }) => {
        if (cancelled || !token) return;

        socket = io(api, {
          auth: { token },
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: 5,
        });

        socket.on('message:created', addMessage);
        socket.on('media:created', addMessage);

        socket.on('error:access', () => {
          setError('You no longer have access to this conversation.');
          setConversation(null);
          setMessages([]);
          setPage('home');
          window.history.replaceState({}, '', '/');
        });

        socket.on('connect', () => {
          socket?.emit('conversation:join', conversation.id);
        });

        socket.on('connect_error', () => {
          setError(
            'Live updates are temporarily unavailable. Check your connection.',
          );
        });
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            'Could not establish a live connection. Please try again.',
          );
        }
      });

    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [conversation?.id, addMessage]);

  const logout = async () => {
    if (busyRef.current) return;

    busyRef.current = true;
    setBusy(true);
    setError('');

    try {
      await call('/auth/logout', { method: 'POST' });

      authRequestId.current += 1;
      successfulToken.current = null;

      setMe(null);
      setBmContacts([]);
      setBmSelected(null);
      setBmIntegrated(false);
      setConversation(null);
      setMessages([]);
      setDraft('');
      setSearch('');
      setPage('home');
      setShowDetails(false);
      setShowSettings(false);
      setAuthenticating(true);

      window.history.replaceState({}, '', '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logout failed.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // Opening a contact also opens its conversation immediately.
 
const openChat = async (contact: BMContact | null = bmSelected) => {
  if (!me || !bmIntegrated || !contact?.userId) {
    setError('Choose an accepted-interest contact to continue.');
    return;
  }

  // Give each selection its own request ID.
  const requestId = ++chatRequestId.current;

  busyRef.current = true;
  setBusy(true);
  setError('');
  setBmSelected(contact);
  setShowDetails(false);
  setShowSettings(false);

  try {
    const c = await call<Conversation>(
      `/conversations/with/${encodeURIComponent(contact.userId)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: getContactName(contact),
        }),
      },
    );

    if (requestId !== chatRequestId.current) return;

    if (!c?.id) {
      throw new Error('The server did not return a conversation.');
    }

    const existing = await call<Message[]>(
      `/conversations/${encodeURIComponent(c.id)}/messages`,
    );

    if (requestId !== chatRequestId.current) return;

    if (!Array.isArray(existing)) {
      throw new Error('Could not load conversation messages.');
    }

    setConversation(c);
    setMessages(
      [...existing].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() -
          new Date(b.createdAt).getTime(),
      ),
    );

    setDraft('');
    setPage('chat');

    window.history.pushState(
      {},
      '',
      `/chat/${encodeURIComponent(contact.userId)}`,
    );

    try {
      await call(
        `/conversations/${encodeURIComponent(c.id)}/read`,
        { method: 'POST' },
      );
    } catch {
      // Keep the conversation open if marking messages as read fails.
    }
  } catch (err) {
    if (requestId === chatRequestId.current) {
      setError(err instanceof Error ? err.message : 'Chat unavailable.');
    }
  } finally {
    if (requestId === chatRequestId.current) {
      busyRef.current = false;
      setBusy(false);
    }
  }
};


 
const selectContact = (contact: BMContact) => {
  setBmSelected(contact);
  setError('');
  setShowDetails(false);
  setShowSettings(false);

  if (bmSelected?.userId === contact.userId && conversation) {
    setPage('chat');
    return;
  }

  void openChat(contact);
};


  const sendText = async () => {
    if (busyRef.current || !conversation || !draft.trim()) return;

    const content = draft.trim();

    if (content.length > 5000) {
      setError('Messages must be 5,000 characters or fewer.');
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError('');

    try {
      const message = await call<Message>(
        `/conversations/${encodeURIComponent(conversation.id)}/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content }),
        },
      );

      addMessage(message);
      setDraft('');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not send the message.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const sendPhoto = async (file?: File) => {
    if (!file || !conversation || busyRef.current) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG, or WebP image.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('The photo must be 5 MB or smaller.');
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError('');

    try {
      const form = new FormData();
      form.append('media', file);

      const message = await call<Message>(
        `/conversations/${encodeURIComponent(conversation.id)}/media`,
        { method: 'POST', body: form },
      );

      addMessage(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo upload failed.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const goToContacts = () => {
    setPage('home');
    setShowDetails(false);
    setShowSettings(false);
    window.history.pushState({}, '', '/');
  };

  const sharedPhotos = messages.filter(
    (message) => message.mediaType === 'image',
  );

  const filteredContacts = bmContacts.filter((contact) =>
    getContactName(contact).toLowerCase().includes(search.trim().toLowerCase()),
  );

  if (authenticating || !me || !bmIntegrated) {
    return (
      <main className={`auth-screen theme-${theme}`}>
        <style>{layoutOverrides}</style>
        <div className="auth-card">
          <div className="auth-brand">B<span>M</span></div>
          <p>Authenticating you, please wait…</p>
          {error && <p className="chat-error" role="alert">{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className={`workspace-page theme-${theme}`}>
      <style>{layoutOverrides}</style>

      <div className={`workspace-shell ${page === 'chat' && conversation ? 'chat-active' : ''}`}>
        <nav className="app-rail" aria-label="Main navigation">
          <div className="brand-mark" title="Bharat Milan Chat">B<span>M</span></div>

          <button
            className="rail-button active"
            type="button"
            aria-label="Chats"
            title="Chats"
            onClick={goToContacts}
          >
            ▣<small>Chats</small>
          </button>

          <button
            className="rail-button"
            type="button"
            aria-label="Shared photos"
            title="Shared photos"
            onClick={() => {
              if (conversation) setShowDetails(true);
              else setError('Open a conversation to view shared photos.');
            }}
          >
            ▧<small>Photos</small>
          </button>

          <button
            className="rail-button"
            type="button"
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            title="Settings"
          >
            ⚙<small>Settings</small>
          </button>

          <div className="rail-bottom">
            <div className="mini-avatar">{getAvatarLetter(me.displayName)}</div>
            <span className="online-dot" />
          </div>
        </nav>

        <aside className="contacts-panel">
          <div className="contacts-topline">
            <div>
              <p className="eyebrow">BHARAT MILAN</p>
              <h1>Chats</h1>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowSettings(true)}
              aria-label="Open settings"
            >
              ⋮
            </button>
          </div>

          <label className="chat-search">
            <span>⌕</span>
            <input
              aria-label="Search contacts"
              placeholder="Search chats…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <div className="contacts-list">
            {filteredContacts.map((contact) => {
              const name = getContactName(contact);
              const selected = bmSelected?.userId === contact.userId;

              return (
                <button
                  key={contact.userId}
                  type="button"
                  data-contact-name={name.toLowerCase()}
                  className={`contact-list-item ${selected ? 'selected' : ''}`}
                  onClick={() => selectContact(contact)}
                  disabled={busy}
                  aria-current={selected ? 'true' : undefined}
                >
                  <div className="contact-avatar">
                    {getAvatarLetter(name)}
                  </div>
                  <div className="contact-list-copy">
                    <strong>{name}</strong>
                    <span>
                      {selected && busy
                        ? 'Opening conversation…'
                        : 'Accepted-interest connection'}
                    </span>
                  </div>
                  <span className="contact-presence" />
                </button>
              );
            })}

            {filteredContacts.length === 0 && (
              <div className="contacts-empty">
                <span>♡</span>
                <strong>
                  {bmContacts.length === 0
                    ? 'No connections yet'
                    : 'No matching contacts'}
                </strong>
                <p>
                  {bmContacts.length === 0
                    ? 'Accepted-interest contacts from Bharat Milan will appear here.'
                    : 'Try another name.'}
                </p>
              </div>
            )}
          </div>

          <div className="current-user">
            <div className="contact-avatar">
              {getAvatarLetter(me.displayName)}
            </div>
            <div>
              <strong>{me.displayName}</strong>
              <span>Your account</span>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => void logout()}
              disabled={busy}
              aria-label="Log out"
            >
              ⇥
            </button>
          </div>
        </aside>

        {page === 'chat' && conversation ? (
          <section className="chat-window">
            <header className="chat-header">
              <button
                type="button"
                className="back-button"
                onClick={goToContacts}
                aria-label="Back to contacts"
              >
                ←
              </button>

              <div className="contact-avatar">
                {getAvatarLetter(otherName)}
              </div>

              <div className="contact-details">
                <strong>{otherName}</strong>
                <span>Private conversation</span>
              </div>

              <div className="header-actions">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    setShowDetails((value) => !value);
                    setShowSettings(false);
                  }}
                  aria-label="Chat details and shared photos"
                  title="Chat details"
                >
                  ▤
                </button>

                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    setShowSettings(true);
                    setShowDetails(false);
                  }}
                  aria-label="Appearance settings"
                  title="Appearance"
                >
                  ⚙
                </button>
              </div>
            </header>

            <div className="chat-notice">
              <span aria-hidden="true">🔒</span>
              <span>
                Only authorized participants can access this conversation.
              </span>
            </div>

            <div className="chat-messages" aria-live="polite">
              {messages.length === 0 ? (
                <div className="empty-chat">
                  <div className="empty-chat-icon">♡</div>
                  <h2>Say hello</h2>
                  <p>Send your first message or share a photo.</p>
                </div>
              ) : (
                messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    mine={message.senderIdentityId === me.id}
                    getPhotoUrl={getPhotoUrl}
                  />
                ))
              )}
              <div ref={messageEndRef} />
            </div>

            {error && <p className="chat-error" role="alert">{error}</p>}

            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendText();
              }}
            >
              <label className={`media-picker ${busy ? 'disabled' : ''}`}>
                <span className="picker-icon">＋</span>
                <span>Photo</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void sendPhoto(file);
                  }}
                />
              </label>

              <input
                className="message-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Write a message…"
                aria-label="Type a message"
                maxLength={5000}
                disabled={busy}
              />

              <button type="submit" disabled={busy || !draft.trim()}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            </form>
          </section>
        ) : (
          <section
            className="workspace-empty-pane"
            aria-label="Choose a conversation"
          />
        )}

        {showDetails && conversation && (
          <aside className="chat-sidebar">
            <div className="sidebar-heading">
              <div>
                <p className="eyebrow">CONVERSATION</p>
                <h2>Chat details</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowDetails(false)}
                aria-label="Close chat details"
              >
                ×
              </button>
            </div>

            <div className="sidebar-contact">
              <div className="contact-avatar large">
                {getAvatarLetter(otherName)}
              </div>
              <h3>{otherName}</h3>
              <p>Private conversation</p>
            </div>

            <div className="sidebar-section">
              <h3>
                <span>Shared photos</span>
                <span className="count-pill">{sharedPhotos.length}</span>
              </h3>
              <div className="shared-photo-grid">
                {sharedPhotos.length ? (
                  sharedPhotos.map((message) => (
                    <SharedPhoto
                      key={message.id}
                      message={message}
                      getPhotoUrl={getPhotoUrl}
                    />
                  ))
                ) : (
                  <p className="muted-text">
                    Photos shared in this conversation will appear here.
                  </p>
                )}
              </div>
            </div>

            <div className="sidebar-section">
              <h3>Quick actions</h3>
              <button
                type="button"
                className="sidebar-action"
                onClick={() => {
                  setShowDetails(false);
                  document.querySelector<HTMLInputElement>('.message-input')?.focus();
                }}
              >
                <span>✎</span> Write a message
              </button>
              <button
                type="button"
                className="sidebar-action"
                onClick={() => {
                  document.querySelector<HTMLInputElement>('.media-picker input')?.click();
                }}
              >
                <span>▧</span> Share a photo
              </button>
              <button
                type="button"
                className="sidebar-action"
                onClick={() => {
                  setShowDetails(false);
                  setShowSettings(true);
                }}
              >
                <span>⚙</span> Appearance settings
              </button>
            </div>
          </aside>
        )}
      </div>

      {showSettings && (
        <div
          className="settings-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowSettings(false);
            }
          }}
        >
          <section
            className="settings-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="sidebar-heading">
              <div>
                <p className="eyebrow">MAKE IT YOURS</p>
                <h2 id="settings-title">Appearance</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowSettings(false)}
                aria-label="Close settings"
              >
                ×
              </button>
            </div>

            <p className="muted-text">
              Choose your preferred theme. Your selection is saved on this device.
            </p>

            <div className="theme-options">
              <button
                type="button"
                className={`theme-option ${theme === 'light' ? 'selected' : ''}`}
                onClick={() => setTheme('light')}
                aria-pressed={theme === 'light'}
              >
                <span className="theme-preview light-preview">
                  <span /><span /><span />
                </span>
                <span className="theme-option-label">
                  <strong>Light theme</strong>
                  <small>Warm, bright and welcoming</small>
                </span>
                <span className="theme-check">{theme === 'light' ? '✓' : ''}</span>
              </button>

              <button
                type="button"
                className={`theme-option ${theme === 'dark' ? 'selected' : ''}`}
                onClick={() => setTheme('dark')}
                aria-pressed={theme === 'dark'}
              >
                <span className="theme-preview dark-preview">
                  <span /><span /><span />
                </span>
                <span className="theme-option-label">
                  <strong>Dark theme</strong>
                  <small>Soft, darker surfaces</small>
                </span>
                <span className="theme-check">{theme === 'dark' ? '✓' : ''}</span>
              </button>
            </div>

            <div className="settings-note">
              <span>♡</span>
              <p>Bharat Milan Chat — your conversations, your way.</p>
            </div>

            <button
              type="button"
              className="ghost logout-button"
              onClick={() => void logout()}
              disabled={busy}
            >
              Log out
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

const layoutOverrides = `
/* Keep the WhatsApp-style contact list beside every conversation. */
.workspace-page,
.auth-screen {
  min-height: 100vh;
  min-height: 100dvh;
}

.workspace-page {
  box-sizing: border-box;
}

.workspace-shell {
  position: relative;
  overflow: hidden;
  min-width: 0;
}

.workspace-empty-pane {
  min-width: 0;
  min-height: 0;
  background: var(--chat-bg, var(--surface, #fff8f0));
  grid-column: 3;
}

.workspace-shell.chat-active .chat-window {
  grid-column: 3;
  grid-row: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border-radius: 0;
  box-shadow: none;
  position: relative;
  z-index: 1;
}

.workspace-shell.chat-active .chat-sidebar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  width: min(340px, 90%);
  max-width: 100%;
  overflow-y: auto;
  box-shadow: -12px 0 35px rgba(41, 37, 34, 0.12);
}

.workspace-shell .contacts-panel {
  min-width: 0;
  min-height: 0;
}

.workspace-shell .contacts-list {
  min-height: 0;
  overflow-y: auto;
}

.workspace-shell .contact-list-item:disabled {
  cursor: wait;
  opacity: 0.8;
}

.auth-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  background: #fff8f0;
  color: #292522;
  font-family: 'DM Sans', sans-serif;
  text-align: center;
}

.auth-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.auth-card p {
  margin: 0;
}

.auth-brand {
  color: #b8324a;
  font-family: 'Playfair Display', serif;
  font-size: 42px;
  font-weight: 700;
  letter-spacing: -3px;
}

.auth-brand span {
  color: #292522;
}

.theme-dark.auth-screen {
  background: #191715;
  color: #fff8f0;
}

@media (max-width: 900px) {
  .workspace-shell.chat-active .chat-window {
    min-width: 0;
  }
}

@media (max-width: 650px) {
  .workspace-shell.chat-active .chat-window {
    grid-column: 2;
    grid-row: 1;
  }

  .workspace-shell.chat-active .workspace-empty-pane {
    grid-column: 2;
  }

  .workspace-shell.chat-active .contacts-panel {
    display: none;
  }

  .workspace-shell.chat-active .chat-window .back-button {
    display: inline-flex;
  }
}
`;

function ChatMessage({
  message,
  mine,
  getPhotoUrl,
}: {
  message: Message;
  mine: boolean;
  getPhotoUrl: (id: string) => Promise<string>;
}) {
  const [src, setSrc] = useState('');
  const [photoError, setPhotoError] = useState(false);

  useEffect(() => {
    if (message.mediaType !== 'image') return;

    let cancelled = false;
    setSrc('');
    setPhotoError(false);

    getPhotoUrl(message.id)
      .then((url) => {
        if (!cancelled) {
          setSrc(url);
          setPhotoError(!url);
        }
      })
      .catch(() => {
        if (!cancelled) setPhotoError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [message.id, message.mediaType, getPhotoUrl]);

  return (
    <article className={`message-row ${mine ? 'mine' : 'theirs'}`}>
      <div className="message-bubble">
        {message.mediaType === 'image' ? (
          src ? (
            <img src={src} alt="Shared photo" />
          ) : (
            <p>{photoError ? 'Photo could not be loaded.' : 'Loading photo…'}</p>
          )
        ) : (
          <p className="message-text">{message.content}</p>
        )}

        <small>
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </small>
      </div>
    </article>
  );
}

function SharedPhoto({
  message,
  getPhotoUrl,
}: {
  message: Message;
  getPhotoUrl: (id: string) => Promise<string>;
}) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc('');
    setFailed(false);

    getPhotoUrl(message.id)
      .then((url) => {
        if (!cancelled) {
          setSrc(url);
          setFailed(!url);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [message.id, getPhotoUrl]);

  return (
    <>
      <button
        type="button"
        className="shared-photo"
        onClick={() => {
          if (src) setPreviewOpen(true);
        }}
        title="View shared photo"
        disabled={!src}
      >
        {src ? (
          <img src={src} alt="Photo shared in conversation" loading="lazy" />
        ) : (
          <span>{failed ? 'Unavailable' : 'Loading…'}</span>
        )}
      </button>

      {previewOpen && src && (
        <div
          className="photo-preview-backdrop"
          onClick={() => setPreviewOpen(false)}
          role="presentation"
        >
          <button
            type="button"
            className="photo-preview-close"
            onClick={() => setPreviewOpen(false)}
            aria-label="Close photo preview"
          >
            ×
          </button>
          <img
            src={src}
            alt="Full-size shared photo"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Could not find the #root element.');
}

createRoot(rootElement).render(<App />);
