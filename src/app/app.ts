import { Component, inject } from '@angular/core';
import { ChatService } from './services/chat.service';
import { ChatComponent } from './chat/chat.component';
import { LoginComponent } from './login/login.component';

@Component({
  selector: 'app-root',
  imports: [ChatComponent, LoginComponent],
  template: `
    @if (chat.isAuthed()) { <app-chat /> } @else { <app-login /> }
  `,
  styles: `:host { display: block; height: 100%; }`,
})
export class App {
  chat = inject(ChatService);
}
