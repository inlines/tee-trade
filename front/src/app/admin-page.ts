import { CatalogEnd } from './catalog-end';
import { BrandPicker } from './brand-picker';
import { RequestList } from './request-list';
import { effect, untracked, DestroyRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Component, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AdminService, ProductDraft, StorefrontSettings } from './admin.service';
import { ChatService } from './chat.service';
import { Product, ProductImage, categories, previewUrl } from './catalog';

@Component({
  selector: 'app-admin', imports: [FormsModule, RouterLink, CurrencyPipe, RequestList, BrandPicker, CatalogEnd],
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
  readonly failedUploads = signal<File[]>([]);
  retryUploads() { void this.uploadFiles(this.failedUploads()); }
  readonly dragging = signal(false);
  readonly uploadProgress = signal('');
  readonly error = signal('');
  readonly notice = signal('');
  readonly tab = signal<'products' | 'archive' | 'storefront' | 'requests'>('products');
  readonly products = signal<Product[]>([]);
  readonly incomplete = signal(false);
  missing(product:Product){return [!product.name.trim()?'название':'',!product.category?'категория':'',!product.brands.length?'бренды':'',!product.size.trim()?'размер':'',!product.description.trim()?'описание':'',!product.theme.trim()?'тематика':'',product.price_cents===null?'цена':'',!product.images.length?'фотографии':''].filter(Boolean).join(', ');}
  readonly brands = signal<string[]>([]);
  readonly search = signal('');
  readonly filtered = this.products;
  readonly listLoading=signal(false);
  readonly listError=signal('');
  readonly hasMore=signal(true);
  readonly total=signal(0);
  private offset=0;
  private listGeneration=0;
  private names = signal(new Map<number,string>());
  async resetProducts(){this.listGeneration++;this.offset=0;this.products.set([]);this.total.set(0);this.hasMore.set(true);this.listLoading.set(false);this.listError.set('');if(this.api.session()&&this.tab()!=='requests')await this.loadMore();}
  async loadMore(){
    if(this.listLoading()||!this.hasMore())return;
    const generation=this.listGeneration;
    this.listLoading.set(true);this.listError.set('');
    try{
      const page=await this.api.page(this.search(),this.tab()==='archive',window.matchMedia('(max-width:700px)').matches?4:8,this.offset,this.tab()==='products'&&this.incomplete());
      if(generation!==this.listGeneration)return;
      this.offset+=page.items.length;this.total.set(page.total);this.hasMore.set(page.items.length>0&&this.offset<page.total);
      this.products.update(rows=>{const ids=new Set(rows.map(p=>p.id));return [...rows,...page.items.filter(p=>!ids.has(p.id))];});
      this.names.update(names=>{const next=new Map(names);page.items.forEach(p=>next.set(p.id,p.name));return next;});
    }catch(e){if(generation===this.listGeneration)this.listError.set('Не удалось загрузить товары. Попробуйте ещё раз.');}
    finally{if(generation===this.listGeneration)this.listLoading.set(false);}
  }
  readonly editor = signal(false);
  readonly editId = signal<number | null>(null);
  readonly images = signal<ProductImage[]>([]);
  readonly settings = signal<StorefrontSettings | null>(null);
  readonly dirtyProduct = signal(false);
  readonly dirtySettings = signal(false);
  username = ''; password = ''; price: number | null = null;
  draft: ProductDraft = this.emptyDraft();

  readonly queryParams=toSignal(this.route.queryParamMap);
  constructor() { effect(()=>{if(this.queryParams()?.has('request'))this.tab.set('requests');});effect(()=>{this.api.session();this.tab();this.search();this.incomplete();untracked(()=>void this.resetProducts());});inject(DestroyRef).onDestroy(()=>this.listGeneration++);void this.initialize(); }
  selectTab(tab:'products'|'archive'|'storefront') {
    this.tab.set(tab);
    void this.router.navigate([], {relativeTo:this.route,queryParams:{request:null},queryParamsHandling:'merge',replaceUrl:true});
  }
  private emptyDraft(): ProductDraft { return { name:'', category:'', brands:[], size:'', description:'', theme:'', price_cents:null, images:[], is_demo:false, sold:false }; }
  private async initialize() {
    try { await this.api.restore(); if (this.api.session()) await this.load(); }
    catch (error) { this.handleError(error); }
    finally { this.checking.set(false); }
  }
  private async load() {
    const [brands, settings] = await Promise.all([this.api.brands(), this.api.settings()]);
    this.brands.set(brands); this.settings.set(settings);
    const labels=await this.api.labels([...new Set([...settings.carousel_product_ids,...settings.featured_product_ids])]);
    this.names.update(names=>{const next=new Map(names);labels.forEach(p=>next.set(p.id,p.name));return next;});
    const chatId = this.route.snapshot.queryParamMap.get('chat');
    if(chatId){
      const chat=(await this.chatApi.list(true)).find(chat=>chat.id===Number(chatId));
      if(chat)this.chatApi.open(chat,true);else this.error.set('Чат не найден.');
    }
    const requestedId = this.route.snapshot.queryParamMap.get('edit');
    if (requestedId !== null) {
      const product = await this.api.product(Number(requestedId));
      if (product?.sold) this.tab.set('archive');
      else if (product) this.startEdit(product);
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
    this.failedUploads.set([]);
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
    this.failedUploads.set([]);
    this.uploading.set(true);
    const failed: File[]=[]; const errors: string[]=[];
    try {
      for (const [index,file] of files.entries()) {
        this.uploadProgress.set(`Загружаем ${index+1} из ${files.length}: ${file.name}`);
        try {
          if(this.images().length>=12)throw new Error('Лимит — 12 фотографий на товар.');
          if(file.size>8*1024*1024)throw new Error('Файл больше 8 МБ.');
          if(!['image/jpeg','image/png','image/webp'].includes(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name))throw new Error('Поддерживаются JPEG, PNG и WebP.');
          const {url}=await this.api.upload(file,percent=>this.uploadProgress.set(`${index+1} из ${files.length}: ${file.name} — ${percent>=100?'обработка на сервере':percent+'%'}`));
          const role=this.images().some(image=>image.kind==='front')?'detail':'front';
          this.images.update(images=>this.normalizeImages([...images,{url,kind:role,alt:`${this.draft.name||'Товар'} — фото ${images.length+1}`} ]));
          this.dirtyProduct.set(true);
        } catch(error) {
          failed.push(file);
          const message=error instanceof Error&&error.name==='TimeoutError'?'Сервер не ответил за 45 секунд. Повторите загрузку.':error instanceof HttpErrorResponse?(typeof error.error==='string'&&!error.error.startsWith('<')?error.error:'Ошибка соединения или сервера.'):error instanceof Error?error.message:'Не удалось загрузить.';
          errors.push(`${file.name}: ${message}`);
          if(error instanceof HttpErrorResponse && [401,403].includes(error.status)) { failed.push(...files.slice(index+1)); break; }
        }
      }
      this.failedUploads.set(failed);
      if(errors.length)this.error.set(errors.join(' '));
    } finally {this.uploading.set(false);this.uploadProgress.set('');}
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
      if (product.sold) { this.editor.set(false); this.tab.set('archive'); }
      this.names.update(names=>new Map(names).set(product.id,product.name)); this.brands.set(await this.api.brands()); await this.resetProducts();
      this.notice.set(product.sold?'Товар сохранён в архиве.':'Товар сохранён и доступен в каталоге.');
    } catch (error) { this.handleError(error); }
    finally { this.busy.set(false); }
  }
  async archiveProduct(product: Product) {
    if (this.busy() || this.uploading() || product.sold) return;
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      const archived = await this.api.archiveProduct(product.id);
      this.products.update(products => products.map(item => item.id === archived.id ? archived : item));
      await this.resetProducts();
      this.notice.set('Товар перенесён в архив и больше не отображается в каталоге.');
    } catch (error) { this.handleError(error); }
    finally { this.busy.set(false); }
  }
  async deleteProduct(product: Product) {
    if (this.busy() || this.uploading()) return;
    if (!window.confirm(`Удалить товар «${product.name}»? Будут удалены его фотографии, чаты, сообщения, заявки и история просмотров. Фото, используемые другими товарами, сохранятся. Это действие нельзя отменить.`)) return;
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
      this.names.update(names=>{const next=new Map(names);next.delete(product.id);return next;}); this.brands.set(await this.api.brands()); await this.resetProducts();
      this.notice.set('Товар и связанные с ним данные удалены.');
    } catch (error) { this.handleError(error); }
    finally { this.busy.set(false); }
  }
  productName(id: number) { return this.names().get(id) ?? `Товар №${id}`; }
  productCover(product: Product) { return previewUrl(product.images.find(image => image.kind === 'front')?.url ?? product.images[0]?.url ?? '/images/no-photo.svg'); }
  patchSettings<K extends keyof StorefrontSettings>(key: K, value: StorefrontSettings[K]) { this.settings.update(settings => settings ? { ...settings, [key]:value } : null); this.dirtySettings.set(true); }
  addSelection(key: 'carousel_product_ids' | 'featured_product_ids', value: string) {
    const id = Number(value); const selected = this.settings()?.[key] ?? [];
    if (!id || selected.includes(id) || selected.length >= 24) return;
    this.patchSettings(key, [...selected, id]);
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
