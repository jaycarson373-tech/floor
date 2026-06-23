"use client";

import { useEffect, useRef, useState } from "react";
import type { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SupabaseClient = ReturnType<typeof createSupabaseBrowserClient>;

type ChatMessage = {
  id: string;
  wallet: string | null;
  body: string;
  created_at: string;
};

const MAX_BODY_LENGTH = 200;
const MAX_DISPLAY = 80;

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function sanitize(text: string) {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default function ChatPanel({
  supabase,
  playerName,
}: {
  supabase: SupabaseClient;
  playerName: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [tableError, setTableError] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Load recent messages
  useEffect(() => {
    let active = true;

    async function load() {
      const { data, error } = await supabase
        .from("messages")
        .select("id, wallet, body, created_at")
        .order("created_at", { ascending: false })
        .limit(MAX_DISPLAY);

      if (error) {
        if (error.code === "42P01" || error.message?.includes("does not exist")) {
          setTableError(true);
        }
        return;
      }
      if (!active) return;
      setMessages((data ?? []).reverse() as ChatMessage[]);
    }

    load();
    return () => { active = false; };
  }, [supabase]);

  // Realtime subscription
  useEffect(() => {
    if (tableError) return;

    const channel = supabase
      .channel("messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as ChatMessage;
          setMessages((prev) => {
            const next = [...prev, msg];
            return next.slice(-MAX_DISPLAY);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, tableError]);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const body = input.trim().slice(0, MAX_BODY_LENGTH);
    if (!body || sending) return;

    setSending(true);
    setInput("");

    await supabase.from("messages").insert({
      wallet: playerName.slice(0, 32),
      body,
    });

    setSending(false);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (tableError) {
    return (
      <div className="chat-panel">
        <div className="chat-error">
          <strong>Chat unavailable</strong>
          <span>
            The <code>messages</code> table does not exist yet.
            Ask your backend / Codex to run the migration:
          </span>
          <pre className="chat-migration">
{`create table public.messages (
  id uuid primary key default gen_random_uuid(),
  wallet text,
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create policy "Anyone can insert"
  on public.messages for insert
  with check (true);
create policy "Anyone can read"
  on public.messages for select
  using (true);`}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages" aria-live="polite" aria-label="PumpSt chat">
        {messages.length === 0 && (
          <p className="chat-empty">No messages yet. Say something.</p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className="chat-msg">
            <span className="chat-name">{msg.wallet ?? "anon"}</span>
            <span className="chat-time">{formatTime(msg.created_at)}</span>
            <p
              className="chat-body"
              // We sanitize manually above so dangerouslySetInnerHTML is safe here
              dangerouslySetInnerHTML={{ __html: sanitize(msg.body) }}
            />
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => { e.preventDefault(); send(); }}
      >
        <input
          className="chat-input"
          type="text"
          placeholder="Say something..."
          maxLength={MAX_BODY_LENGTH}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={sending}
          aria-label="Chat message"
        />
        <button
          className="chat-send"
          type="submit"
          disabled={!input.trim() || sending}
          aria-label="Send message"
        >
          Send
        </button>
      </form>
    </div>
  );
}
