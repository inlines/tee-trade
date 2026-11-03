import { RequestList } from './request-list';
import { effect } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AdminService, ProductDraft, StorefrontSettings } from './admin.service';
import { ChatService } from './chat.service';
import { Product, ProductImage, categories } from './catalog';

@Component({
  selector: 'app-admin', imports: [FormsModule, RouterLink, CurrencyPipe, RequestList],
  templateUrl: './admin-page.html', styleUrl: './admin-page.css',
})
export class AdminPage {
  readonly api = inject(AdminService);
  private readonly chatApi = inject(ChatService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly categories = categories;
  readonly checking = signal(true);
  readonly busy = signal(false);
  readonly uploading = signal(false);
  readonly dragging = signal(false);
  readonly uploadProgress = signal('');
  readonly error = signal('');
  readonly notice = signal('');
  readonly tab = signal<'products' | 'storefront' | 'requests'>('products');
  readonly products = signal<Product[]>([]);
  readonly search = signal('');
  readonly filtered = computed(() => this.products().filter(p => `${p.name} ${p.brand}`.toLowerCase().includes(this.search().toLowerCase())));
  readonly editor = signal(false);
  readonly editId = signal<number | null>(null);
  readonly images = signal<ProductImage[]>([]);
  readonly settings = signal<StorefrontSettings | null>(null);
  readonly dirtyProduct = signal(false);
  readonly dirtySettings = signal(false);
  username = ''; password = ''; price: number | null = null;
  draft: ProductDraft = this.emptyDraft();
  carouselChoice = ''; featuredChoice = '';

  readonly queryParams=toSignal(this.route.queryParamMap);
  constructor() { effect(()=>{if(this.queryParams()?.has('request'))this.tab.set('requests');});void this.initialize(); }
  selectTab(tab:'products'|'storefront') {
    this.tab.set(tab);
    void this.router.navigate([], {relativeTo:this.route,queryParams:{request:null},queryParamsHandling:'merge',replaceUrl:true});
  }
  private emptyDraft(): ProductDraft { return { name:'', category:'', brand:'', release_year:null, description:'', theme:'', price_cents:null, images:[], is_demo:false }; }
  private async initialize() {
    try { await this.api.restore(); if (this.api.session()) await this.load(); }
    catch (error) { this.handleError(error); }
    finally { this.checking.set(false); }
  }
  private async load() {
    const [products, settings] = await Promise.all([this.api.list(), this.api.settings()]);
    this.products.set(products); this.settings.set(settings);
    const chatId = this.route.snapshot.queryParamMap.get('chat');
    if(chatId){
      const chat=(await this.chatApi.list(true)).find(chat=>chat.id===Number(chatId));
      if(chat)this.chatApi.open(chat,true);else this.error.set('Чат не найден.');
    }
    const requestedId = this.route.snapshot.queryParamMap.get('edit');
    if (requestedId !== null) {
      const product = products.find(item => item.id === Number(requestedId));
      if (product) this.startEdit(product);
      else this.error.set('Товар для редактирования не найден.');
    }
  }
  private handleError(error: unknown) {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) this.api.session.set(null);
      this.error.set(typeof error.error === 'string' && !error.error.startsWith('<') ? error.error : error.status === 413 ? 'Максимальный размер фотографии — 8 МБ.' : 'Не удалось выполнить запрос. Проверьте соединение и попробуйте снова.');
    } else this.error.set(error instanceof Error ? error.message : 'Не удалось выполнить действие.');
  }
  async login() {
    this.error.set(''); this.busy.set(true);
    try { await this.api.login(this.username, this.password); this.password = ''; await this.load(); }
    catch (error) { this.handleError(error); }
    finally { this.busy.set(false); }
  }
  async logout() {
    if ((this.dirtyProduct() || this.dirtySettings()) && !window.confirm('Выйти без сохранения изменений?')) return;
    this.busy.set(true); this.error.set('');
    try { await this.api.logout(); this.editor.set(false); this.images.set([]); this.products.set([]); this.settings.set(null); this.notice.set(''); this.dirtyProduct.set(false); this.dirtySettings.set(false); }
    catch (error) { this.handleError(error); }
    finally { this.busy.set(false); }
  }
  startEdit(product?: Product) {
    if (this.dirtyProduct() && !window.confirm('Отменить несохранённые изменения товара?')) return;
    this.editId.set(product?.id ?? null);
    this.draft = product ? { ...product, images: [] } : this.emptyDraft();
    this.price = product?.price_cents == null ? null : product.price_cents / 100;
    this.images.set(this.normalizeImages(product ? product.images : []));
    this.editor.set(true); this.error.set(''); this.notice.set(''); this.dirtyProduct.set(false);
  }
  closeEditor() {
    if (this.dirtyProduct() && !window.confirm('Отменить несохранённые изменения товара?')) return;
    this.editor.set(false); this.dirtyProduct.set(false); this.error.set('');
    void this.router.navigate([], { relativeTo: this.route, queryParams: { edit: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []); input.value = '';
    await this.uploadFiles(files);
  }
  dragOver(event: DragEvent) { event.preventDefault(); if(!this.busy()&&!this.uploading()) {this.dragging.set(true); if(event.dataTransfer)event.dataTransfer.dropEffect='copy';} }
  dragLeave(event: DragEvent) { if(!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node|null))this.dragging.set(false); }
  drop(event: DragEvent) { event.preventDefault(); this.dragging.set(false); void this.uploadFiles(Array.from(event.dataTransfer?.files??[])); }
  private async uploadFiles(files: File[]) {
    if (!files.length || this.busy() || this.uploading()) return;
    this.error.set('');
    if (this.images().length + files.length > 12) { this.error.set('Можно добавить не более 12 фотографий.'); return; }
    if (files.some(file => file.size > 8 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(file.type))) { this.error.set('Выберите JPEG, PNG или WebP размером до 8 МБ.'); return; }
    this.uploading.set(true);
    try {
      for (const [index,file] of files.entries()) {
        this.uploadProgress.set(`Загружаем фото ${index+1} из ${files.length}…`);
        const { url } = await this.api.upload(file);
        const role = this.images().some(image => image.kind === 'front') ? 'detail' : 'front';
        this.images.update(images => this.normalizeImages([...images, { url, kind: role, alt: `${this.draft.name || 'Товар'} — фото ${this.images().length+1}` }]));
        this.dirtyProduct.set(true);
      }
    } catch (error) { this.handleError(error); }
    finally { this.uploading.set(false); this.uploadProgress.set(''); }
  }
  private normalizeImages(images: ProductImage[]): ProductImage[] {
    const cover=Math.max(0,images.findIndex(image=>image.kind==='front'));
    const carousel=images.findIndex(image=>image.carousel);
    return images.map((image,i)=>({...image,kind:i===cover?'front':'detail',carousel:i===(carousel<0?cover:carousel)}));
  }
  changeRole(index: number, role: ProductImage['kind']) {
    this.images.update(images => images.map((image, i) => ({ ...image, kind: i === index ? role : role === 'front' && image.kind === 'front' ? 'detail' : image.kind })));
    this.dirtyProduct.set(true);
  }
  setCarousel(index: number) { this.images.update(images=>images.map((image,i)=>({...image,carousel:i===index}))); this.dirtyProduct.set(true); }
  changeAlt(index: number, alt: string) { this.images.update(images => images.map((image, i) => i === index ? { ...image, alt } : image)); this.dirtyProduct.set(true); }
  removeImage(index: number) { this.images.update(images => this.normalizeImages(images.filter((_, i) => i !== index))); this.dirtyProduct.set(true); }
  moveImage(index: number, direction: number) {
    this.images.update(images => { const result = [...images]; const target = index + direction; if (target >= 0 && target < result.length) [result[index], result[target]] = [result[target], result[index]]; return result; }); this.dirtyProduct.set(true);
  }
  async saveProduct() {
    this.error.set(''); this.notice.set('');
    const price = Number(this.price);
    if (!Number.isFinite(price) || price < 0 || price > 21474836.47) { this.error.set('Укажите корректную цену.'); return; }
    this.busy.set(true);
    try {
      const product = await this.api.saveProduct(this.editId(), { ...this.draft, price_cents:this.price == null ? null : Math.round(price * 100), images:this.images() });
      this.products.update(products => [product, ...products.filter(p => p.id !== product.id)]);
      this.editId.set(product.id); this.draft = { ...product }; this.dirtyProduct.set(false);
      this.notice.set('Товар сохранён и доступен в каталоге.');
    } catch (error) { this.handleError(error); }
    finally { this.busy.set(false); }
  }
  async deleteProduct(product: Product) {
    if (this.busy() || this.uploading()) return;
    if (!window.confirm(`Удалить товар «${product.name}»? Он будет удалён из каталога и подборок на главной. Это действие нельзя отменить.`)) return;
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      await this.api.deleteProduct(product.id);
      this.products.update(products => products.filter(item => item.id !== product.id));
      this.settings.update(settings => {
        if (!settings) return null;
        const carousel = settings.carousel_product_ids.filter(id => id !== product.id);
        const featured = settings.featured_product_ids.filter(id => id !== product.id);
        return { ...settings, carousel_product_ids: carousel, featured_product_ids: featured,
          carousel_enabled: settings.carousel_enabled && carousel.length > 0,
          popular_enabled: settings.popular_enabled && featured.length > 0 };
      });
      if (this.editId() === product.id) {
        this.editor.set(false); this.editId.set(null); this.images.set([]); this.dirtyProduct.set(false);
      }
      this.notice.set('Товар удалён из каталога и витрины.');
    } catch (error) { this.handleError(error); }
    finally { this.busy.set(false); }
  }
  productName(id: number) { return this.products().find(product => product.id === id)?.name ?? `Товар №${id}`; }
  productCover(product: Product) { return product.images.find(image => image.kind === 'front')?.url ?? product.images[0]?.url ?? '/images/no-photo.svg'; }
  patchSettings<K extends keyof StorefrontSettings>(key: K, value: StorefrontSettings[K]) { this.settings.update(settings => settings ? { ...settings, [key]:value } : null); this.dirtySettings.set(true); }
  addSelection(key: 'carousel_product_ids' | 'featured_product_ids', value: string) {
    const id = Number(value); const selected = this.settings()?.[key] ?? [];
    if (!id || selected.includes(id) || selected.length >= 24) return;
    this.patchSettings(key, [...selected, id]);
    if (key === 'carousel_product_ids') this.carouselChoice = ''; else this.featuredChoice = '';
  }
  removeSelection(key: 'carousel_product_ids' | 'featured_product_ids', index: number) { this.patchSettings(key, this.settings()![key].filter((_, i) => i !== index)); }
  moveSelection(key: 'carousel_product_ids' | 'featured_product_ids', index: number, direction: number) {
    const values = [...this.settings()![key]]; const target = index + direction;
    if (target < 0 || target >= values.length) return;
    [values[index], values[target]] = [values[target], values[index]]; this.patchSettings(key, values);
  }
  toggleCategory(slug: string, checked: boolean) { const values = this.settings()!.categories; this.patchSettings('categories', checked ? [...values, slug] : values.filter(value => value !== slug)); }
  moveCategory(index: number, direction: number) { const values = [...this.settings()!.categories]; const target = index + direction; if (target < 0 || target >= values.length) return; [values[index], values[target]] = [values[target], values[index]]; this.patchSettings('categories', values); }
  categoryName(slug: string) { return categories.find(category => category.slug === slug)?.name ?? slug; }
  async saveSettings() {
    if (!this.settings()) return;
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try { this.settings.set(await this.api.saveSettings(this.settings()!)); this.dirtySettings.set(false); this.notice.set('Витрина сохранена. Изменения видны на главной странице.'); }
    catch (error) { this.handleError(error); }
    finally { this.busy.set(false); }
  }
}
