import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Product, ProductImage } from './catalog';

export interface AdminSession { username: string; csrf_token: string; }
export interface ProductDraft {
  name: string; category: string; brand: string; release_year: number | null; description: string;
  theme: string; price_cents: number | null; images: ProductImage[]; is_demo: boolean;
}
export interface StorefrontSettings {
  carousel_product_ids: number[]; featured_product_ids: number[]; categories: string[];
  arrivals_title: string; arrivals_subtitle: string; popular_title: string;
  manifesto_eyebrow: string; manifesto_title: string; manifesto_link_text: string;
  carousel_enabled: boolean; categories_enabled: boolean; popular_enabled: boolean; manifesto_enabled: boolean;
}
export interface Storefront { settings: StorefrontSettings; carousel: Product[]; featured: Product[]; }
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);
  readonly session = signal<AdminSession | null>(null);
  private headers() { return { 'X-CSRF-Token': this.session()?.csrf_token ?? '' }; }
  private restoring: Promise<void> | null = null;
  restore(): Promise<void> {
    return this.restoring ??= this.restoreSession().finally(() => { this.restoring = null; });
  }
  private async restoreSession() {
    try { this.session.set(await firstValueFrom(this.http.get<AdminSession>('/api/admin/session'))); }
    catch (error) { if (!(error instanceof HttpErrorResponse && error.status === 401)) throw error; this.session.set(null); }
  }
  async login(username: string, password: string) {
    this.session.set(await firstValueFrom(this.http.post<AdminSession>('/api/admin/login', { username, password })));
  }
  async logout() { await firstValueFrom(this.http.post('/api/admin/logout', {}, { headers: this.headers() })); this.session.set(null); }
  list() { return firstValueFrom(this.http.get<Product[]>('/api/admin/products')); }
  settings() { return firstValueFrom(this.http.get<StorefrontSettings>('/api/admin/storefront')); }
  saveProduct(id: number | null, draft: ProductDraft) {
    return firstValueFrom(id === null
      ? this.http.post<Product>('/api/admin/products', draft, { headers: this.headers() })
      : this.http.put<Product>(`/api/admin/products/${id}`, draft, { headers: this.headers() }));
  }
  deleteProduct(id: number) { return firstValueFrom(this.http.delete<void>(`/api/admin/products/${id}`, { headers: this.headers() })); }
  saveSettings(settings: StorefrontSettings) { return firstValueFrom(this.http.put<StorefrontSettings>('/api/admin/storefront', settings, { headers: this.headers() })); }
  async upload(file: File) {
    const body = new FormData(); body.append('file', file);
    return firstValueFrom(this.http.post<{ url: string }>('/api/admin/uploads', body, { headers: this.headers() }));
  }
}
