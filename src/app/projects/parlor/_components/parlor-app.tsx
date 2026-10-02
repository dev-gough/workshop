'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowDown, Check, ChevronDown, Copy, Eye, EyeOff, ImageIcon, MessageSquare, Plus, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useHeaderConfig } from '@/components/header-config';
import { Button } from '@/components/ui/button';
import { parlorModelLabel } from '@/lib/parlor-models';

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

const STARTERS: Record<Mode, string[]> = {
  chat: [
    'What should we cook tonight if the fridge is mostly odds and ends?',
    'Tell me something worth knowing about the weather this week.',
  ],
  image: [
    'A lamp-lit parlor at dusk, rain on the window, one empty chair',
    'A small lake at evening, seen from a wooden dock',
  ],
};

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
  const [draw, setDraw] = useState<{ phase: 'loading' | 'drawing'; step: number | null; total: number | null; secondsPerStep: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [houseOpen, setHouseOpen] = useState(true);
  const [away, setAway] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const shown = useRef<number | null>(null);
  const stick = useRef(true);

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
    if (localStorage.getItem('parlor_house_open') === '0') setHouseOpen(false);
  }, []);

  useEffect(() => {
    stick.current = true;
    setAway(false);
  }, [active?.id]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTo({ top: el.scrollHeight });
  }, [messages, busy, draw]);

  const choices = mode === 'image' ? models.image : models.chat;
  const reading = active != null && !active.mine;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft, reading]);

  function selectChat(id: number | null) {
    if (busy) return;
    setListOpen(false);
    setError(null);
    setConfirmDelete(null);
    router.replace(id == null ? '/projects/parlor' : `/projects/parlor?c=${id}`, { scroll: false });
    if (id == null) requestAnimationFrame(() => box.current?.focus());
  }

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    stick.current = near;
    setAway((prev) => (prev === !near ? prev : !near));
  }

  function jumpToLatest() {
    const el = scroller.current;
    stick.current = true;
    setAway(false);
    el?.scrollTo({ top: el.scrollHeight });
  }

  function fillStarter(text: string) {
    setDraft(text);
    requestAnimationFrame(() => box.current?.focus());
  }

  function toggleHouse() {
    setHouseOpen((prev) => {
      const next = !prev;
      localStorage.setItem('parlor_house_open', next ? '1' : '0');
      return next;
    });
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
      const pendingUser: Message = {
        id: -1, role: 'user', kind: 'text', content, thinking: null, model, imageUrl: null, pending: true,
      };
      setMessages((prev) => [...prev, pendingUser]);
      setDraw({ phase: 'loading', step: null, total: null, secondsPerStep: null });
      const res = await fetch('/api/parlor/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, mode, model, content }),
      });
      const streamed = (res.headers.get('content-type') ?? '').includes('ndjson');
      if (!streamed) {
        const body = await res.json() as { error?: string; chat?: Chat; messages?: Message[] };
        setDraw(null);
        setBusy(false);
        if (!res.ok || !body.chat || !body.messages) {
          setMessages((prev) => prev.filter((message) => message !== pendingUser));
          setDraft(content);
          setError(body.error ?? 'The laptop couldn’t draw that.');
          return;
        }
        setActive(body.chat);
        setMessages((prev) => chatId == null ? body.messages! : [...prev.filter((message) => message !== pendingUser), ...body.messages!]);
        setChats((prev) => [body.chat!, ...prev.filter((chat) => chat.id !== body.chat!.id)]);
        if (chatId == null) {
          shown.current = body.chat.id;
          router.replace(`/projects/parlor?c=${body.chat.id}`, { scroll: false });
        }
        return;
      }
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: 'The laptop couldn’t draw that.' })) as { error?: string };
        setMessages((prev) => prev.filter((message) => message !== pendingUser));
        setDraft(content);
        setError(body.error ?? 'The laptop couldn’t draw that.');
        setDraw(null);
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
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
              phase?: 'loading' | 'drawing';
              step?: number;
              total?: number;
              secondsPerStep?: number;
              chat?: Chat;
              message?: Message;
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
            } else if (event.type === 'progress') {
              setDraw({
                phase: event.phase === 'drawing' ? 'drawing' : 'loading',
                step: event.step ?? null,
                total: event.total ?? null,
                secondsPerStep: event.secondsPerStep ?? null,
              });
            } else if (event.type === 'done' && event.message) {
              setDraw(null);
              setMessages((prev) => [...prev, event.message!]);
            } else if (event.type === 'error') {
              setDraw(null);
              if (event.dropped) {
                setMessages((prev) => prev.filter((message) => message.id !== -1));
                setDraft(content);
                if (chatId == null) {
                  shown.current = null;
                  setActive(null);
                  router.replace('/projects/parlor', { scroll: false });
                }
              }
              setError(event.error ?? 'The laptop couldn’t draw that.');
            }
          }
        }
      } catch {
        setError('The picture stopped halfway.');
      } finally {
        setDraw(null);
        setBusy(false);
        box.current?.focus();
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
    if (mode === 'image') return 'Describe the picture…';
    return 'Say something…';
  }, [mode]);

  const needle = query.trim().toLowerCase();
  const listed = useMemo(() => {
    const rows = needle
      ? chats.filter((chat) => `${chat.title} ${chat.owner.name}`.toLowerCase().includes(needle))
      : chats;
    return {
      yours: rows.filter((chat) => chat.mine),
      house: rows.filter((chat) => !chat.mine),
    };
  }, [chats, needle]);

  const listening = busy && mode === 'chat' && !messages.some((message) => (
    message.id === -2 && (message.content !== '' || (message.thinking ?? '') !== '')
  ));

  const chair = (chat: Chat) => (
    <ChairRow
      key={chat.id}
      chat={chat}
      selected={active?.id === chat.id}
      confirming={confirmDelete === chat.id}
      onOpen={() => selectChat(chat.id)}
      onHide={() => void hideChat(chat)}
      onAskDelete={() => setConfirmDelete(chat.id)}
      onCancelDelete={() => setConfirmDelete(null)}
      onDelete={() => void deleteChat(chat.id)}
    />
  );

  return (
    <div className="parlor-theme parlor-room relative flex h-[calc(100vh-57px)] overflow-hidden">
      <aside className={`absolute inset-y-0 left-0 z-30 w-72 flex-col border-r border-border bg-background md:static ${listOpen ? 'flex' : 'hidden md:flex'}`}>
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`parlor-lamp ${busy ? 'is-lit' : ''}`} />
              <h1 className="ws-serif text-xl font-semibold tracking-tight">The Parlor</h1>
            </div>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">House chats</p>
          </div>
          <Button type="button" size="icon" variant="ghost" aria-label="New chat" onClick={() => selectChat(null)} disabled={!user || busy}>
            <Plus />
          </Button>
        </div>

        {user && chats.length > 0 && (
          <div className="px-3 pb-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a chair"
              aria-label="Find a chair"
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {listed.yours.length > 0 && (
            <ChairSection label="Your chairs">{listed.yours.map(chair)}</ChairSection>
          )}
          {listed.house.length > 0 && (
            needle ? (
              <ChairSection label="Around the table">{listed.house.map(chair)}</ChairSection>
            ) : (
              <ChairSection label="Around the table" count={listed.house.length} open={houseOpen} onToggle={toggleHouse}>
                {listed.house.map(chair)}
              </ChairSection>
            )
          )}
          {user && chats.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">The room is quiet.</p>
          )}
          {user && chats.length > 0 && listed.yours.length + listed.house.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing under that name.</p>
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
        {!user && !booting && (
          <SignIn error={error} onSubmit={signIn} />
        )}

        {user && (
          <>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Button type="button" size="sm" variant="ghost" className="md:hidden" onClick={() => setListOpen(true)}>Chats</Button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{active?.title ?? (missing ? 'Not at the table' : 'A new chair')}</p>
                {active && (
                  <p className="truncate text-[11px] text-muted-foreground">
                    {active.mine ? 'Your chair' : `${active.owner.name}’s chair`}
                    {active.hidden ? ' · only you' : ''}
                    {reading ? ' · reading' : ''}
                  </p>
                )}
              </div>
            </div>

            <div className="relative min-h-0 flex-1">
              <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-6">
                <div className="mx-auto flex max-w-2xl flex-col gap-4">
                  {missing && (
                    <p className="text-center text-sm text-muted-foreground">That chat isn’t on the table.</p>
                  )}
                  {!active && messages.length === 0 && !missing && (
                    <div className="pt-12 text-center">
                      <span className={`parlor-lamp mx-auto mb-4 ${busy ? 'is-lit' : ''}`} />
                      <h2 className="ws-serif text-3xl font-semibold">Pull up a chair</h2>
                      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                        Talk with a model on the laptop, or ask it to draw. A hidden chat stays on your list. Nobody else can open it.
                      </p>
                      <div className="mx-auto mt-6 flex max-w-md flex-col gap-2">
                        {STARTERS[mode].map((line) => (
                          <button
                            key={line}
                            type="button"
                            onClick={() => fillStarter(line)}
                            className="rounded-lg border border-border bg-card px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground"
                          >
                            {line}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {messages.map((message) => (
                    <MessageSlip
                      key={message.id}
                      message={message}
                      speaker={message.role === 'user' ? (active?.mine === false ? active.owner.name : 'You') : null}
                    />
                  ))}
                  {listening && <Listening />}
                  {draw && <DrawProgress draw={draw} />}
                </div>
              </div>
              {away && (
                <button
                  type="button"
                  onClick={jumpToLatest}
                  className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground shadow-sm hover:text-foreground"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  Latest
                </button>
              )}
            </div>

            {reading && active ? (
              <div className="border-t border-border px-4 py-4">
                <p className="mx-auto max-w-2xl text-center text-sm text-muted-foreground">
                  {active.owner.name} pulled up this chair. You’re welcome to read.
                </p>
              </div>
            ) : (
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
                      disabled={choices.length === 0 || busy}
                      className="h-8 min-w-0 max-w-[16rem] flex-1 rounded-md border border-border bg-card px-2 text-sm sm:flex-none"
                      aria-label="Model"
                    >
                      {choices.length === 0 && <option value="">No model yet</option>}
                      {choices.map((name) => <option key={name} value={name}>{parlorModelLabel(name)}</option>)}
                    </select>
                    {models.error && <span className="text-[11px] text-muted-foreground">{models.error}</span>}
                    {!models.error && mode === 'image' && models.image.length === 0 && (
                      <span className="text-[11px] text-muted-foreground">No image model on the laptop yet.</span>
                    )}
                  </div>
                  {error && <p className="mb-2 text-sm text-destructive" role="alert">{error}</p>}
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
                      rows={1}
                      placeholder={placeholder}
                      disabled={busy}
                      className="max-h-[200px] min-h-[2.5rem] flex-1 resize-none rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
                    />
                    <Button type="submit" className="min-w-[5.5rem]" disabled={busy || !draft.trim() || !model}>
                      {busy ? (mode === 'image' ? 'Drawing' : 'Sending') : mode === 'image' ? 'Draw' : 'Send'}
                    </Button>
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">Enter sends · Shift+Enter for a new line</p>
                </div>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ChairSection({ label, children, open, onToggle, count }: {
  label: string;
  children: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  count?: number;
}) {
  return (
    <section className="mb-3">
      {onToggle ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full items-center gap-1.5 rounded-md px-2 pb-1 text-left text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {count != null && <span className="tabular-nums tracking-normal">{count}</span>}
        </button>
      ) : (
        <h2 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</h2>
      )}
      {(!onToggle || open) && children}
    </section>
  );
}

function ChairRow({ chat, selected, confirming, onOpen, onHide, onAskDelete, onCancelDelete, onDelete }: {
  chat: Chat;
  selected: boolean;
  confirming: boolean;
  onOpen: () => void;
  onHide: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`group mb-0.5 flex items-center gap-2 rounded-md px-2 py-2 ${selected ? 'bg-card shadow-[inset_2px_0_0_var(--parlor-accent)]' : 'hover:bg-card/70'} ${chat.hidden ? 'opacity-70' : ''}`}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onOpen}>
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
        <span className="flex shrink-0 items-center gap-0.5 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-within:opacity-100">
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label={chat.hidden ? 'Show this chat to the house' : 'Hide this chat from the house'}
            onClick={onHide}
          >
            {chat.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          {confirming ? (
            <>
              <button type="button" className="rounded px-1.5 text-[11px] text-destructive hover:bg-destructive/10" onClick={onDelete}>
                Delete
              </button>
              <button type="button" className="rounded px-1.5 text-[11px] text-muted-foreground hover:text-foreground" onClick={onCancelDelete}>
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:text-destructive"
              aria-label="Delete chat"
              onClick={onAskDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function Listening() {
  return (
    <div className="flex justify-start" role="status">
      <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
        <span className="parlor-lamp is-lit" />
        The lamp is listening…
      </div>
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

function DrawProgress({ draw }: { draw: { phase: 'loading' | 'drawing'; step: number | null; total: number | null; secondsPerStep: number | null } }) {
  const known = draw.phase === 'drawing' && draw.step != null && draw.total != null && draw.total > 0;
  const width = known ? `${Math.round((draw.step! / draw.total!) * 100)}%` : '12%';
  const remaining = known && draw.secondsPerStep != null
    ? Math.max(0, Math.round((draw.total! - draw.step!) * draw.secondsPerStep))
    : null;
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-lg border border-border bg-card px-3 py-2">
        <p className="text-sm">
          {known ? `Drawing, step ${draw.step} of ${draw.total}` : 'Loading the model on the laptop…'}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width }} />
        </div>
        {known && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            About {Math.round(draw.secondsPerStep ?? 0)}s per step
            {remaining != null && remaining > 0 ? ` · ${remaining}s left` : ''}
          </p>
        )}
      </div>
    </div>
  );
}

function MessageSlip({ message, speaker }: { message: Message; speaker: string | null }) {
  const mine = message.role === 'user';
  const thought = message.thinking?.trim() ?? '';
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const canCopy = message.kind !== 'image' && message.content.trim() !== '';

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`group/slip min-w-0 max-w-[85%] rounded-lg border border-border px-3 py-2 ${mine ? 'bg-muted' : 'bg-card'}`}>
        {speaker && (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{speaker}</p>
        )}
        {thought !== '' && (
          <details className="mb-2 text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">Thinking</summary>
            <p className="mt-1 whitespace-pre-wrap">{thought}</p>
          </details>
        )}
        {message.kind === 'image' && message.imageUrl ? (
          <button type="button" className="block" onClick={() => setOpen(true)} aria-label="Enlarge picture">
            {/* Session-gated file; next/image would try to optimize it without the cookie. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={message.imageUrl} alt={message.content || 'Generated image'} className="max-h-[28rem] cursor-zoom-in rounded-md" />
          </button>
        ) : message.role === 'assistant' && message.content ? (
          <MarkdownReply text={message.content} />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        )}
        {(message.model || canCopy) && (
        <div className="mt-1 flex items-center gap-2">
          {message.model && (
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{parlorModelLabel(message.model)}</p>
          )}
          {canCopy && (
            <button
              type="button"
              onClick={() => void copy()}
              className="ml-auto rounded p-0.5 text-muted-foreground opacity-100 hover:text-foreground md:opacity-0 md:group-hover/slip:opacity-100 md:focus-visible:opacity-100"
              aria-label={copied ? 'Copied' : 'Copy message'}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
        )}
      </div>
      {open && message.imageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged picture"
          onClick={() => setOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={message.imageUrl}
            alt={message.content || 'Generated image'}
            className="max-h-[90vh] max-w-full rounded-md"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function parlorHref(href: string | undefined): string | undefined {
  if (!href || href.startsWith('/') || href.startsWith('#') || href.startsWith('//')) return undefined;
  try {
    const url = new URL(href);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') return href;
  } catch {
    return undefined;
  }
  return undefined;
}

function MarkdownReply({ text }: { text: string }) {
  return (
    <div className="parlor-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const safe = parlorHref(href);
            if (!safe) return <span>{children}</span>;
            return <a href={safe} target="_blank" rel="noreferrer">{children}</a>;
          },
          img: ({ src, alt }) => {
            const safe = parlorHref(typeof src === 'string' ? src : undefined);
            if (!safe) return null;
            // Model-authored remote image, not a local optimized asset.
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={safe} alt={alt ?? ''} />;
          },
        }}
      >
        {text}
      </ReactMarkdown>
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
