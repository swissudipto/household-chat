import { Component, ElementRef, OnInit, effect, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ChatService } from '../services/chat.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css',
})
export class ChatComponent implements OnInit {
  chat = inject(ChatService);
  sidebarOpen = signal(false);
  private list = viewChild.required<ElementRef<HTMLElement>>('list');

  constructor() {
    effect(() => {
      this.chat.messages();
      this.chat.sending();
      setTimeout(() => {
        const el = this.list().nativeElement;
        el.scrollTop = el.scrollHeight;
      });
    });
  }
  ngOnInit(): void {
    //this.newChat();
  }

  send(box: HTMLInputElement) {
    const text = box.value.trim();
    if (!text || this.chat.sending()) return;
    box.value = '';
    this.chat.send(text);
  }

  sendPrompt(text: string) {
    if (this.chat.sending()) return;
    this.chat.send(text);
  }

  newChat() {
    this.chat.createConversation();
    this.closeSidebar();
  }

  selectChat(id: string) {
    this.chat.selectConversation(id);
    this.closeSidebar();
  }

  toggleSidebar() {
    this.sidebarOpen.update(open => !open);
  }

  closeSidebar() {
    this.sidebarOpen.set(false);
  }
}
