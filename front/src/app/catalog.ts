import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import type { Storefront } from './admin.service';
import { Observable, catchError, map, of, startWith } from 'rxjs';

export const categories = [
  { slug: 'sneakers', name: 'Кроссовки', image: 'sneakers' },
  { slug: 't-shirts', name: 'Футболки', image: 't-shirt' },
  { slug: 'accessories', name: 'Аксессуары', image: 'tote' },
  { slug: 'hoodies', name: 'Худи', image: 't-shirt' },
  { slug: 'sweatshirts', name: 'Свитшоты', image: 't-shirt' },
  { slug: 'longsleeves', name: 'Лонгсливы', image: 't-shirt' },
  { slug: 'headwear', name: 'Головные уборы', image: 'cap' },
];
export interface ProductImage { carousel?: boolean; url: string; alt: string; kind: 'front' | 'detail' | 'label'; }
export interface Product {
  id: number; name: string; price_cents: number | null; category: string; brands: string[];
  sizes: string[]; description: string; theme: string; images: ProductImage[]; is_demo: boolean; sold: boolean;
}
export interface LoadState<T> { loading: boolean; data: T | null; error: string; notFound: boolean; }
export function loadState<T>(request: Observable<T>): Observable<LoadState<T>> {
  return request.pipe(
    map(data => ({ loading: false, data, error: '', notFound: false })),
    catchError((error: HttpErrorResponse) => of({ loading: false, data: null,
      error: 'Не удалось загрузить данные. Попробуйте ещё раз.', notFound: error.status === 404 })),
    startWith({ loading: true, data: null, error: '', notFound: false }),
  );
}
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  recordView(id:number) { this.http.post('/api/auth/product-views/'+id,{}).subscribe({error:()=>{}}); }
  list(category = '', sold = false) { return this.http.get<Product[]>('/api/products', { params: { ...(category ? {category} : {}), sold } }); }
  page(category: string, sold: boolean, sort: string, limit: number, offset: number, brands: string[] = [], sizes: string[] = []) { return this.http.get<{items: Product[]; total: number; brands: string[]; sizes: string[]}>('/api/products/page', {params:{...(category ? {category} : {}), sold, sort, limit, offset, brands: JSON.stringify(brands), sizes: JSON.stringify(sizes)}}); }
  storefront() { return this.http.get<Storefront>('/api/storefront'); }
  product(id: string) { return this.http.get<Product>(`/api/products/${encodeURIComponent(id)}`); }
}
export const categoryName = (slug: string) => categories.find(category => category.slug === slug)?.name ?? 'Каталог';

export function previewUrl(url: string): string {
  return /^\/api\/media\/[a-f0-9]{64}$/i.test(url) ? url+'/preview' : url;
}
