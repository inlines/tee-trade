import { RequestsService } from './app/requests.service';
import { ChatToasts } from './app/chat-toasts';
import { Component, inject } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeRu from '@angular/common/locales/ru';
import { RouterLink, RouterLinkActive, RouterOutlet, Routes, provideRouter, withInMemoryScrolling } from '@angular/router';
import { ChatNotifications } from './app/chat-notifications';
import { NotificationSound } from './app/notification-sound.service';
import { ChatSidebar } from './app/chat-sidebar';
import { ChatDialog } from './app/chat-dialog';
import { ChatService } from './app/chat.service';
import { CustomerService } from './app/customer.service';
import { AdminService } from './app/admin.service';
import { CatalogMenu } from './app/catalog-menu';
import { HomePage, CatalogPage, ProductPage, AboutPage, NotFoundPage } from './app/pages';
registerLocaleData(localeRu);
const routes: Routes = [
  { path: '', component: HomePage, title: 'Tee Trade — вещи с характером' },
  { path: 'catalog', component: CatalogPage, title: 'Каталог — Tee Trade' },
  { path: 'catalog/:category', component: CatalogPage, title: 'Каталог — Tee Trade' },
  { path: 'product/:id', component: ProductPage, title: 'Товар — Tee Trade' },
  { path: 'about', component: AboutPage, title: 'О нас — Tee Trade' },
  { path: 'account', loadComponent: () => import('./app/account-page').then(module => module.AccountPage), title: 'Аккаунт — Tee Trade' },
  { path: 'admin', loadComponent: () => import('./app/admin-page').then(module => module.AdminPage), title: 'Управление — Tee Trade' },
  { path: '**', component: NotFoundPage, title: 'Страница не найдена — Tee Trade' },
];
@Component({
  selector: 'app-root', imports: [RouterOutlet, RouterLink, RouterLinkActive, CatalogMenu, ChatDialog, ChatSidebar, ChatNotifications, ChatToasts],
  template: `<a class="skip-link" href="#main">Перейти к содержимому</a>
    <header class="site-header"><div class="header-main"><a class="wordmark" routerLink="/" aria-label="Tee Trade — главная">TEE TRADE<span>®</span></a>
      <nav aria-label="Основное меню"><a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}" ariaCurrentWhenActive="page">Главная</a><app-catalog-menu /><a routerLink="/about" routerLinkActive="active" ariaCurrentWhenActive="page">О нас</a>@if (admin.session()) { <a routerLink="/admin" routerLinkActive="active" ariaCurrentWhenActive="page">Админка</a><app-chat-notifications [adminSide]="true" /> } @else { <a routerLink="/account" routerLinkActive="active" ariaCurrentWhenActive="page">{{ customer.session() ? customer.session()!.username : 'Войти / Регистрация' }}</a>@if(customer.session()){<app-chat-notifications />} }</nav>
    </div></header>
    <main id="main" tabindex="-1"><router-outlet /></main>
    <footer><a class="wordmark" routerLink="/">TEE TRADE<span>®</span></a><nav aria-label="Меню в подвале"><a routerLink="/catalog">Каталог</a><a routerLink="/about">О нас</a></nav><span>© 2026 Tee Trade</span></footer>
    @if(!chat.drawer() && !chat.selected() && !requests.formOpen()){<app-chat-toasts />}
    @if(chat.drawer() && (admin.session() || customer.session())){<app-chat-sidebar [admin]="!!admin.session()" />}
    @for (selected of chat.active(); track selected.chat.id + ':' + selected.admin) { <app-chat-dialog [chat]="selected.chat" [admin]="selected.admin" /> }`,
})
class App {
  readonly sound = inject(NotificationSound);
  readonly chat = inject(ChatService);
  readonly requests=inject(RequestsService);
  readonly admin = inject(AdminService);
  readonly customer = inject(CustomerService);
  constructor() { void this.admin.restore().catch(() => {}); void this.customer.restore().catch(() => {}); }
}
bootstrapApplication(App, { providers: [provideHttpClient(), provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }))] }).catch(console.error);
