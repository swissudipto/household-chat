import { Injectable, computed, signal } from '@angular/core';

export interface Message {
  id: number;
  sender: 'user' | 'bot';
  text: string;
  time: Date;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: Date;
}

// Leave empty for mock mode. Example: 'https://your-api.azurewebsites.net/api'
const API_URL = 'http://localhost:5279/api';
const PASSCODE_KEY = 'household-passcode';
const CONVERSATIONS_KEY = 'household-conversations';
const ACTIVE_CONVERSATION_KEY = 'household-active-conversation';
const LEGACY_CONVERSATION_ID = '00000000-0000-0000-0000-000000000001';

@Injectable({ providedIn: 'root' })
export class ChatService {
  readonly conversations = signal<Conversation[]>(this.readConversations());
  readonly activeConversationId = signal(this.readActiveConversationId());
  readonly currentConversation = computed(() =>
    this.conversations().find(conversation => conversation.id === this.activeConversationId()) ?? null,
  );
  readonly messages = computed(() => this.currentConversation()?.messages ?? []);
  readonly sending = computed(() => this.pendingConversationIds().has(this.activeConversationId()));
  readonly error = computed(() => this.errorsByConversation()[this.activeConversationId()] ?? '');
  private readonly passcode = signal<string | null>(this.readPasscode());
  readonly isAuthed = computed(() => !!this.passcode());
  private readonly pendingConversationIds = signal<Set<string>>(new Set());
  private readonly errorsByConversation = signal<Record<string, string>>({});
  private nextMessageId = this.findNextMessageId();

  constructor() {
    if (!this.conversations().length) this.createConversation('New chat', LEGACY_CONVERSATION_ID);
    else {
      if (!this.conversations().some(conversation => conversation.id === LEGACY_CONVERSATION_ID)) {
        this.conversations.update(conversations => [...conversations, this.newConversation('Earlier chat history', LEGACY_CONVERSATION_ID)]);
        this.persistConversations();
      }
      if (!this.currentConversation()) this.selectConversation(this.conversations()[0].id);
    }
  }

  /** Checks the passcode against the backend (or accepts any value in mock mode). */
  async login(code: string): Promise<boolean> {
    code = code.trim();
    if (!code) return false;
    if (API_URL) {
      try {
        const knownConversations = this.conversations();
        const histories = await Promise.all(knownConversations.map(async conversation => {
          const res = await fetch(`${API_URL}/history?conversationId=${encodeURIComponent(conversation.id)}`, {
            headers: { 'X-Passcode': code },
          });
          if (!res.ok) throw new Error('history request failed');
          const rows: { id: number; sender: 'user' | 'bot'; text: string; timestamp: string }[] = await res.json();
          return [conversation.id, rows.map(row => ({ id: row.id, sender: row.sender, text: row.text, time: new Date(row.timestamp) }))] as const;
        }));
        const historiesByConversation = new Map(histories);
        this.conversations.update(conversations => conversations.map(conversation => {
          const history = historiesByConversation.get(conversation.id) ?? [];
          if (!history.length) return conversation;
          const firstUserMessage = history.find(message => message.sender === 'user');
          return {
            ...conversation,
            title: firstUserMessage ? this.titleFrom(firstUserMessage.text) : conversation.title,
            messages: history,
            updatedAt: history.at(-1)!.time,
          };
        }));
        this.persistConversations();
        this.nextMessageId = this.findNextMessageId();
      } catch {
        return false;
      }
    }

    this.savePasscode(code);
    this.passcode.set(code);
    return true;
  }

  logout(): void {
    this.savePasscode(null);
    this.passcode.set(null);
    this.conversations.set([this.newConversation()]);
    this.activeConversationId.set(this.conversations()[0].id);
    this.persistConversations();
    this.persistActiveConversationId();
    this.errorsByConversation.set({});
    this.pendingConversationIds.set(new Set());
  }

  createConversation(title = 'New chat', id?: string): Conversation {
    const conversation = this.newConversation(title, id);
    this.conversations.update(conversations => [conversation, ...conversations]);
    this.activeConversationId.set(conversation.id);
    this.persistConversations();
    this.persistActiveConversationId();
    return conversation;
  }

  selectConversation(id: string): void {
    if (!this.conversations().some(conversation => conversation.id === id)) return;
    this.activeConversationId.set(id);
    this.persistActiveConversationId();
  }

  async send(text: string): Promise<void> {
    text = text.trim();
    const conversationId = this.activeConversationId();
    if (!text || this.pendingConversationIds().has(conversationId)) return;
    this.errorsByConversation.update(errors => ({ ...errors, [conversationId]: '' }));
    this.push(conversationId, 'user', text);
    this.pendingConversationIds.update(pending => new Set(pending).add(conversationId));
    try {
      this.push(conversationId, 'bot', await this.fetchReply(text));
    } catch (e) {
      if ((e as Error).message === 'unauthorized') { this.logout(); return; }
      this.errorsByConversation.update(errors => ({
        ...errors,
        [conversationId]: "Couldn't reach the assistant. Check your connection and try again.",
      }));
    } finally {
      this.pendingConversationIds.update(pending => {
        const next = new Set(pending);
        next.delete(conversationId);
        return next;
      });
    }
  }

  private async fetchReply(text: string): Promise<string> {
    if (!API_URL) {
      await new Promise(resolve => setTimeout(resolve, 600));
      return `Mock reply: you said "${text}". Connect the backend in chat.service.ts.`;
    }
    const res = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Passcode': this.passcode() ?? '' },
      body: JSON.stringify({ conversationId: this.conversations().find(conversation => conversation.id === this.activeConversationId())?.id, text }),
    });
    if (res.status === 401) throw new Error('unauthorized');
    if (!res.ok) throw new Error('request failed');
    return (await res.json()).reply;
  }

  private push(conversationId: string, sender: Message['sender'], text: string): void {
    const message: Message = { id: this.nextMessageId++, sender, text, time: new Date() };
    this.conversations.update(conversations => conversations.map(conversation => {
      if (conversation.id !== conversationId) return conversation;
      const messages = [...conversation.messages, message];
      const firstUserMessage = messages.find(item => item.sender === 'user');
      return {
        ...conversation,
        title: firstUserMessage ? this.titleFrom(firstUserMessage.text) : conversation.title,
        messages,
        updatedAt: message.time,
      };
    }));
    this.persistConversations();
  }

  private updateConversation(id: string, getMessages: (messages: Message[]) => Message[], updatedAt: Date): void {
    this.conversations.update(conversations => conversations.map(conversation => {
      if (conversation.id !== id) return conversation;
      const messages = getMessages(conversation.messages);
      const firstUserMessage = messages.find(message => message.sender === 'user');
      return {
        ...conversation,
        title: firstUserMessage ? this.titleFrom(firstUserMessage.text) : conversation.title,
        messages,
        updatedAt,
      };
    }));
    this.persistConversations();
  }

  private newConversation(title = 'New chat', id?: string): Conversation {
    return { id: id ?? this.createId(), title, messages: [], updatedAt: new Date() };
  }

  private createId(): string {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const random = Math.random() * 16 | 0;
      return (char === 'x' ? random : (random & 0x3 | 0x8)).toString(16);
    });
  }

  private titleFrom(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length > 34 ? `${normalized.slice(0, 34).trimEnd()}…` : normalized;
  }

  private findNextMessageId(): number {
    return Math.max(0, ...this.conversations().flatMap(conversation => conversation.messages.map(message => message.id))) + 1;
  }

  private readConversations(): Conversation[] {
    try {
      const stored = localStorage.getItem(CONVERSATIONS_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored) as Array<Omit<Conversation, 'updatedAt' | 'messages'> & { updatedAt: string; messages: Array<Omit<Message, 'time'> & { time: string }> }>;
      return parsed.map(conversation => ({
        ...conversation,
        updatedAt: new Date(conversation.updatedAt),
        messages: conversation.messages.map(message => ({ ...message, time: new Date(message.time) })),
      }));
    } catch { return []; }
  }

  private readActiveConversationId(): string {
    try { return localStorage.getItem(ACTIVE_CONVERSATION_KEY) ?? ''; } catch { return ''; }
  }

  private readPasscode(): string | null {
    try { return localStorage.getItem(PASSCODE_KEY); } catch { return null; }
  }

  private persistConversations(): void {
    try { localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(this.conversations())); } catch { /* storage unavailable */ }
  }

  private persistActiveConversationId(): void {
    try { localStorage.setItem(ACTIVE_CONVERSATION_KEY, this.activeConversationId()); } catch { /* storage unavailable */ }
  }

  private savePasscode(code: string | null): void {
    try { code ? localStorage.setItem(PASSCODE_KEY, code) : localStorage.removeItem(PASSCODE_KEY); } catch { /* private mode */ }
  }
}
