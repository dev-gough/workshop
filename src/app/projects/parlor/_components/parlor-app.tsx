'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, ImageIcon, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { useHeaderConfig } from '@/components/header-config';
import { Button } from '@/components/ui/button';

interface User {
  id: number;
  name: string;
  color: string;
}

interface Chat {
  id: number;
  title: string;
  hidden: boolean;
  updatedAt: string;
  mine: boolean;
  owner: User;
}

interface Message {
  id: number;
  role: 'user' | 'assistant';
  kind: 'text' | 'image';
  content: string;
  thinking: string | null;
  model: string | null;
  imageUrl: string | null;
  pending?: boolean;
}

type Mode = 'chat' | 'image';

function ago(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(seconds) || seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function Avatar({ user, size = 'md' }: { user: { name: string; color: string }; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${dim}`}
      style={{ background: user.color }}
      title={user.name}
    >
      {user.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function ParlorApp() {
  useHeaderConfig({ scopeClass: 'parlor-theme' });
  const router = useRouter();
  const search = useSearchParams();
  const requested = Number(search.get('c'));
  const requestedId = Number.isInteger(requested) && requested > 0 ? requested : null;

  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [active, setActive] = useState<Chat | null>(null);
  const [mode, setMode] = useState<Mode>('chat');
  const [models, setModels] = useState<{ chat: string[]; image: string[]; error: string | null }>({
    chat: [], image: [], error: null,
  });
  const [model, setModel] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const shown = useRef<number | null>(null);

  const loadChats = useCallback(async () => {
    const res = await fetch('/api/parlor/chats');
    if (res.status === 401) { setUser(null); return; }
    if (!res.ok) return;
    const body = await res.json() as { chats: Chat[] };
    setChats(body.chats);
  }, []);

  const openChat = useCallback(async (id: number) => {
    const res = await fetch(`/api/parlor/chats/${id}`);
    if (res.status === 404) {
      setActive(null);
      setMessages([]);
      setMissing(true);
      return;
    }
    if (res.status === 401) { setUser(null); return; }
    if (!res.ok) return;
    const body = await res.json() as { chat: Chat; messages: Message[] };
    setMissing(false);
    setActive(body.chat);
    setMessages(body.messages);
    setChats((prev) => {
      const rest = prev.filter((chat) => chat.id !== body.chat.id);
      return [body.chat, ...rest];
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/parlor/session');
      if (cancelled) return;
      if (res.ok) {
        const body = await res.json() as { user: User };
        setUser(body.user);
      }
      setBooting(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadChats();
    void fetch('/api/parlor/models').then(async (res) => {
      if (!res.ok) return;
      const body = await res.json() as { chat: string[]; image: string[]; error: string | null };
      setModels(body);
    });
    const savedMode = localStorage.getItem('parlor_mode');
    if (savedMode === 'image' || savedMode === 'chat') setMode(savedMode);
  }, [user, loadChats]);

  useEffect(() => {
    const list = mode === 'image' ? models.image : models.chat;
    const saved = localStorage.getItem(mode === 'image' ? 'parlor_image_model' : 'parlor_chat_model');
    setModel(saved && list.includes(saved) ? saved : (list[0] ?? ''));
  }, [mode, models]);

  useEffect(() => {
    if (!user) return;
    if (requestedId == null) {
      if (shown.current == null) return;
      shown.current = null;
      setActive(null);
      setMessages([]);
      setMissing(false);
      return;
    }
    if (shown.current === requestedId) return;
    shown.current = requestedId;
    void openChat(requestedId);
  }, [user, requestedId, openChat]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, busy]);

  const choices = mode === 'image' ? models.image : models.chat;
  const reading = active != null && !active.mine;

  function selectChat(id: number | null) {
    if (busy) return;
    setListOpen(false);
    setError(null);
    setConfirmDelete(null);
    router.replace(id == null ? '/projects/parlor' : `/projects/parlor?c=${id}`, { scroll: false });
  }

  function chooseMode(next: Mode) {
    setMode(next);
    localStorage.setItem('parlor_mode', next);
  }

  function chooseModel(next: string) {
    setModel(next);
    localStorage.setItem(mode === 'image' ? 'parlor_image_model' : 'parlor_chat_model', next);
  }

  async function signIn(name: string, password: string) {
    setError(null);
    const res = await fetch('/api/parlor/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
    });
    const body = await res.json() as { user?: User; error?: string };
    if (!res.ok || !body.user) {
      setError(body.error ?? 'Could not sign in.');
      return;
    }
    setUser(body.user);
  }

  async function signOut() {
    await fetch('/api/parlor/session', { method: 'DELETE' });
    setUser(null);
    setChats([]);
    setActive(null);
    setMessages([]);
    router.replace('/projects/parlor', { scroll: false });
  }

  async function hideChat(chat: Chat) {
    const res = await fetch(`/api/parlor/chats/${chat.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: !chat.hidden }),
    });
    if (!res.ok) return;
    const body = await res.json() as { chat: Chat };
    setChats((prev) => prev.map((row) => row.id === chat.id ? body.chat : row));
    setActive((current) => current?.id === chat.id ? body.chat : current);
  }

  async function deleteChat(id: number) {
    const res = await fetch(`/api/parlor/chats/${id}`, { method: 'DELETE' });
    if (!res.ok) return;
    setChats((prev) => prev.filter((chat) => chat.id !== id));
    setConfirmDelete(null);
    if (active?.id === id) selectChat(null);
  }

  async function send() {
    const content = draft.trim();
    if (!content || busy || reading || !model) return;
    setBusy(true);
    setError(null);
    setDraft('');
    const chatId = active?.id ?? null;

    if (mode === 'image') {
      const res = await fetch('/api/parlor/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, mode, model, content }),
      });
      const body = await res.json() as { error?: string; chat?: Chat; messages?: Message[] };
      setBusy(false);
      if (!res.ok || !body.chat || !body.messages) {
        setDraft(content);
        setError(body.error ?? 'The laptop couldn’t draw that.');
        return;
      }
      setActive(body.chat);
      setMessages((prev) => chatId == null ? body.messages! : [...prev, ...body.messages!]);
      setChats((prev) => [body.chat!, ...prev.filter((chat) => chat.id !== body.chat!.id)]);
      if (chatId == null) {
        shown.current = body.chat.id;
        router.replace(`/projects/parlor?c=${body.chat.id}`, { scroll: false });
      }
      return;
    }

    const pendingUser: Message = {
      id: -1, role: 'user', kind: 'text', content, thinking: null, model, imageUrl: null, pending: true,
    };
    setMessages((prev) => [...prev, pendingUser]);
    const res = await fetch('/api/parlor/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, mode: 'chat', model, content }),
    });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({ error: 'The laptop stopped answering.' })) as { error?: string };
      setMessages((prev) => prev.filter((message) => message !== pendingUser));
      setDraft(content);
      setError(body.error ?? 'The laptop stopped answering.');
      setBusy(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let assistant: Message = {
      id: -2, role: 'assistant', kind: 'text', content: '', thinking: '', model, imageUrl: null, pending: true,
    };
    let started = false;
    try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: {
          type: string;
          chat?: Chat;
          message?: Message;
          content?: string;
          thinking?: string;
          error?: string;
          dropped?: boolean;
        };
        try {
          event = JSON.parse(line) as typeof event;
        } catch {
          continue;
        }
        if (event.type === 'chat' && event.chat && event.message) {
          setActive(event.chat);
          setChats((prev) => [event.chat!, ...prev.filter((chat) => chat.id !== event.chat!.id)]);
          setMessages((prev) => prev.map((message) => message.id === -1 ? event.message! : message));
          if (chatId == null) {
            shown.current = event.chat.id;
            router.replace(`/projects/parlor?c=${event.chat.id}`, { scroll: false });
          }
        } else if (event.type === 'delta') {
          if (!started) {
            started = true;
            setMessages((prev) => [...prev, assistant]);
          }
          assistant = {
            ...assistant,
            content: assistant.content + (event.content ?? ''),
            thinking: (assistant.thinking ?? '') + (event.thinking ?? ''),
          };
          const next = assistant;
          setMessages((prev) => prev.map((message) => message.id === -2 ? next : message));
        } else if (event.type === 'done' && event.message) {
          const saved = event.message;
          setMessages((prev) => prev.map((message) => message.id === -2 ? saved : message));
          if (event.error) setError(event.error);
        } else if (event.type === 'error') {
          if (event.dropped) {
            setMessages((prev) => prev.filter((message) => message.id !== -1 && message.id !== -2));
            setDraft(content);
            if (chatId == null) {
              shown.current = null;
              setActive(null);
              router.replace('/projects/parlor', { scroll: false });
            }
          }
          setError(event.error ?? 'The laptop stopped answering.');
        }
      }
    }
    } catch {
      setError('The reply stopped halfway.');
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  const placeholder = useMemo(() => {
    if (reading) return 'This one belongs to someone else.';
    if (mode === 'image') return 'Describe the picture…';
    return 'Say something…';
  }, [reading, mode]);

  return (
    <div className="parlor-theme relative flex h-[calc(100vh-57px)] overflow-hidden">
      <aside className={`absolute inset-y-0 left-0 z-30 w-72 flex-col border-r border-border bg-background md:static ${listOpen ? 'flex' : 'hidden md:flex'}`}>
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="parlor-lamp" />
              <h1 className="ws-serif text-xl font-semibold tracking-tight">The Parlor</h1>
            </div>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">House chats</p>
          </div>
          <Button type="button" size="icon" variant="ghost" aria-label="New chat" onClick={() => selectChat(null)} disabled={!user}>
            <Plus />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {chats.map((chat) => {
            const selected = active?.id === chat.id;
            return (
              <div
                key={chat.id}
                className={`group mb-0.5 flex items-center gap-2 rounded-md px-2 py-2 ${selected ? 'bg-card' : 'hover:bg-card/70'} ${chat.hidden ? 'opacity-70' : ''}`}
              >
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => selectChat(chat.id)}>
                  <Avatar user={chat.owner} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{chat.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {chat.owner.name} · {ago(chat.updatedAt)}
                      {chat.hidden ? ' · only you' : ''}
                    </span>
                  </span>
                </button>
                {chat.mine && (
                  <span className="flex shrink-0 gap-0.5 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-within:opacity-100">
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                      aria-label={chat.hidden ? 'Show this chat to the house' : 'Hide this chat from the house'}
                      onClick={() => void hideChat(chat)}
                    >
                      {chat.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    {confirmDelete === chat.id ? (
                      <button
                        type="button"
                        className="rounded px-1.5 text-[11px] text-destructive hover:bg-destructive/10"
                        onClick={() => void deleteChat(chat.id)}
                      >
                        Delete
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                        aria-label="Delete chat"
                        onClick={() => setConfirmDelete(chat.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                )}
              </div>
            );
          })}
          {user && chats.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">The room is quiet.</p>
          )}
        </div>

        {user && (
          <div className="flex items-center gap-2 border-t border-border px-3 py-3">
            <Avatar user={user} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm">{user.name}</span>
            <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        )}
      </aside>

      {listOpen && (
        <button type="button" className="absolute inset-0 z-20 bg-black/40 md:hidden" aria-label="Close chats" onClick={() => setListOpen(false)} />
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
          <Button type="button" size="sm" variant="ghost" onClick={() => setListOpen(true)}>Chats</Button>
          <span className="truncate text-sm">{active?.title ?? 'New chat'}</span>
        </div>

        {!user && !booting && (
          <SignIn error={error} onSubmit={signIn} />
        )}

        {user && (
          <>
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
              <div className="mx-auto flex max-w-2xl flex-col gap-4">
                {missing && (
                  <p className="text-center text-sm text-muted-foreground">That chat isn’t on the table.</p>
                )}
                {!active && messages.length === 0 && !missing && (
                  <div className="pt-16 text-center">
                    <span className="parlor-lamp mx-auto mb-4" />
                    <h2 className="ws-serif text-3xl font-semibold">Pull up a chair</h2>
                    <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                      Talk with a model on the laptop, or ask it to draw. Chats you hide stay on your list. Nobody else can open them.
                    </p>
                  </div>
                )}
                {reading && active && (
                  <p className="text-center text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {active.owner.name}’s chat — you’re reading
                  </p>
                )}
                {messages.map((message) => (
                  <MessageSlip key={message.id} message={message} />
                ))}
              </div>
            </div>

            <form
              className="border-t border-border px-4 py-3"
              onSubmit={(event) => { event.preventDefault(); void send(); }}
            >
              <div className="mx-auto max-w-2xl">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="flex rounded-md border border-border bg-card p-0.5">
                    <ModeButton current={mode} value="chat" label="Talk" icon={<MessageSquare className="h-3.5 w-3.5" />} onPick={chooseMode} />
                    <ModeButton current={mode} value="image" label="Draw" icon={<ImageIcon className="h-3.5 w-3.5" />} onPick={chooseMode} />
                  </div>
                  <select
                    value={model}
                    onChange={(event) => chooseModel(event.target.value)}
                    disabled={choices.length === 0}
                    className="h-8 max-w-[16rem] rounded-md border border-border bg-card px-2 text-sm"
                    aria-label="Model"
                  >
                    {choices.length === 0 && <option value="">No model yet</option>}
                    {choices.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                  {models.error && <span className="text-[11px] text-muted-foreground">{models.error}</span>}
                  {!models.error && mode === 'image' && models.image.length === 0 && (
                    <span className="text-[11px] text-muted-foreground">No image model on the laptop yet.</span>
                  )}
                </div>
                {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
                <div className="flex items-end gap-2">
                  <textarea
                    ref={box}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    rows={2}
                    placeholder={placeholder}
                    disabled={reading || busy}
                    className="min-h-[3rem] flex-1 resize-none rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  <Button type="submit" disabled={reading || busy || !draft.trim() || !model}>
                    {busy ? '…' : mode === 'image' ? 'Draw' : 'Send'}
                  </Button>
                </div>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

function ModeButton({ current, value, label, icon, onPick }: {
  current: Mode;
  value: Mode;
  label: string;
  icon: ReactNode;
  onPick: (mode: Mode) => void;
}) {
  const on = current === value;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onPick(value)}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
    >
      {icon}
      {label}
    </button>
  );
}

function MessageSlip({ message }: { message: Message }) {
  const mine = message.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-lg border border-border px-3 py-2 ${mine ? 'bg-muted' : 'bg-card'}`}>
        {message.thinking && (
          <details className="mb-2 text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">Thinking</summary>
            <p className="mt-1 whitespace-pre-wrap">{message.thinking}</p>
          </details>
        )}
        {message.kind === 'image' && message.imageUrl ? (
          // Session-gated file; next/image would try to optimize it without the cookie.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={message.imageUrl} alt={message.content || 'Generated image'} className="max-h-[28rem] rounded-md" />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        )}
        {message.model && (
          <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{message.model}</p>
        )}
      </div>
    </div>
  );
}

function SignIn({ error, onSubmit }: { error: string | null; onSubmit: (name: string, password: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <form
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6"
        onSubmit={(event) => { event.preventDefault(); void onSubmit(name, password); }}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="parlor-lamp" />
          <h2 className="ws-serif text-2xl font-semibold">Who’s sitting down?</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          A name and a password. A new name takes a seat. The same name next time needs the same password.
        </p>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          autoFocus
          className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={!name.trim() || password.length < 4}>
          Sit down
        </Button>
      </form>
    </div>
  );
}
