import { Component, inject, signal } from '@angular/core';
import { ChatService } from '../services/chat.service';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private chat = inject(ChatService);
  error = signal('');
  busy = signal(false);

  async submit(value: string) {
    this.busy.set(true);
    this.error.set('');
    const ok = await this.chat.login(value);
    if (!ok) this.error.set('That passcode did not work. Try again.');
    this.busy.set(false);
  }
}
