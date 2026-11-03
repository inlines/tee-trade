import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { CustomerService } from './customer.service';
@Component({
  selector:'app-account', imports:[FormsModule, RouterLink],
  template:`<section class="account-panel">
    @if (!auth.ready()) { <p role="status">Проверяем вход…</p> }
    @else if (auth.session(); as session) {
      <p class="eyebrow">ВАШ АККАУНТ</p><h1>{{ session.username }}</h1>
      <p>Вы вошли в аккаунт.</p>
      <a class="button dark" [routerLink]="returnPath">{{ returnPath === '/catalog' ? 'Перейти в каталог' : 'Вернуться к товару' }}</a>
      <button class="text-link account-logout" (click)="logout()" [disabled]="busy()">Выйти</button>
    } @else {
      <p class="eyebrow">TEE TRADE / АККАУНТ</p>
      <h1>{{ mode() === 'register' ? 'Регистрация' : 'Вход' }}</h1>
      <div class="account-switch" aria-label="Вход или регистрация">
        <button type="button" [class.active]="mode() === 'register'" [attr.aria-pressed]="mode() === 'register'" (click)="switchMode('register')" [disabled]="busy()">Регистрация</button>
        <button type="button" [class.active]="mode() === 'login'" [attr.aria-pressed]="mode() === 'login'" (click)="switchMode('login')" [disabled]="busy()">Вход</button>
      </div>
      <form #form="ngForm" (ngSubmit)="submit()">
        <fieldset [disabled]="busy()">
          <label>Логин<input name="username" [(ngModel)]="username" required minlength="3" maxlength="40" autocomplete="username" autocapitalize="none" spellcheck="false" aria-describedby="username-hint"></label>
          <p class="account-hint" id="username-hint">3–40 букв, цифр, точек, дефисов или подчёркиваний.</p>
          <label>Пароль<input name="password" type="password" [(ngModel)]="password" required [minlength]="mode() === 'register' ? 8 : 1" maxlength="512" [autocomplete]="mode() === 'register' ? 'new-password' : 'current-password'"></label>
          @if (mode() === 'register') {
            <p class="account-hint">Не менее 8 символов.</p>
            <label>Подтверждение пароля<input name="confirmation" type="password" [(ngModel)]="confirmation" required maxlength="512" autocomplete="new-password"></label>
          }
          <button class="button dark" type="submit" [disabled]="busy() || form.invalid">{{ busy() ? 'Подождите…' : mode() === 'register' ? 'Зарегистрироваться' : 'Войти' }}</button>
        </fieldset>
      </form>
    }
    @if (error()) { <p class="account-error" role="alert">{{ error() }}</p> }
  </section>`,
  styles:[`
    :host{display:block}.account-panel{max-width:480px;margin:55px auto;padding:32px;background:#eeede7}
    h1{font-size:36px;margin:18px 0 24px;overflow-wrap:anywhere}.account-panel>p{margin-bottom:24px;font-size:14px}
    label{display:flex;flex-direction:column;gap:8px;margin:20px 0 10px;font-size:13px}input{width:100%;padding:13px;border:1px solid #c9cdbf;background:#fff;border-radius:0;font:inherit}
    fieldset{padding:0;border:0;min-width:0}.account-hint{font-size:11px;color:var(--muted)}.button{margin-top:20px;width:100%}
    .account-switch{display:flex;gap:24px;border-bottom:1px solid var(--line)}.account-switch button{border:0;background:none;padding:12px 0;color:var(--muted);font-size:13px}.account-switch .active{color:var(--ink);border-bottom:2px solid var(--ink)}
    button:disabled{opacity:.5;cursor:not-allowed}.account-error{background:#f6e6e1;color:#852e22;padding:16px;margin-top:20px}.account-logout{margin-top:24px}
    @media(max-width:500px){.account-panel{padding:24px;margin:30px auto}}
  `],
})
export class AccountPage {
  readonly auth = inject(CustomerService);
  private readonly route = inject(ActivatedRoute);
  readonly mode = signal<'register'|'login'>(this.route.snapshot.queryParamMap.get('mode') === 'login' ? 'login' : 'register');
  readonly busy = signal(false); readonly error = signal('');
  username=''; password=''; confirmation='';
  readonly returnPath = /^\/product\/\d+$/.test(this.route.snapshot.queryParamMap.get('returnTo') ?? '') ? this.route.snapshot.queryParamMap.get('returnTo')! : '/catalog';
  constructor() { void this.auth.restore().catch(() => this.error.set('Не удалось проверить вход. Обновите страницу.')); }
  switchMode(mode:'register'|'login') { this.mode.set(mode); this.password=''; this.confirmation=''; this.error.set(''); }
  private showError(error:unknown) { this.error.set(error instanceof HttpErrorResponse && typeof error.error === 'string' && !error.error.startsWith('<') ? error.error : 'Не удалось выполнить запрос. Попробуйте ещё раз.'); }
  async submit() {
    if (this.busy()) return;
    this.error.set('');
    if (this.mode() === 'register' && this.password !== this.confirmation) { this.error.set('Пароли не совпадают.'); return; }
    this.busy.set(true);
    try { await this.auth.authenticate(this.mode(), this.username, this.password, this.confirmation); this.password=''; this.confirmation=''; }
    catch (error) { this.showError(error); }
    finally { this.busy.set(false); }
  }
  async logout() { this.busy.set(true); this.error.set(''); try { await this.auth.logout(); } catch(error) {this.showError(error);} finally {this.busy.set(false);} }
}
