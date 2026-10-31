import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
export interface CustomerSession { username: string; csrf_token: string; }
@Injectable({ providedIn:'root' })
export class CustomerService {
  private readonly http = inject(HttpClient);
  readonly session = signal<CustomerSession | null>(null);
  readonly ready = signal(false);
  private restoring: Promise<void> | null = null;
  restore(): Promise<void> {
    return this.restoring ??= this.restoreSession().finally(() => { this.ready.set(true); this.restoring = null; });
  }
  private async restoreSession() {
    try { this.session.set(await firstValueFrom(this.http.get<CustomerSession>('/api/auth/session'))); }
    catch (error) { if (!(error instanceof HttpErrorResponse && error.status === 401)) throw error; this.session.set(null); }
  }
  async authenticate(mode: 'register' | 'login', username: string, password: string, confirmation: string) {
    const session = await firstValueFrom(this.http.post<CustomerSession>('/api/auth/' + mode, {username, password, password_confirmation:confirmation}));
    this.session.set(session);
  }
  async logout() {
    try { await firstValueFrom(this.http.post('/api/auth/logout', {}, {headers:{'X-CSRF-Token':this.session()?.csrf_token ?? ''}})); }
    catch (error) { if (!(error instanceof HttpErrorResponse && error.status === 401)) throw error; }
    this.session.set(null);
  }
}
