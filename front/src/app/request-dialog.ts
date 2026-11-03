import { ChatToasts } from './chat-toasts';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Product } from './catalog';
import { RequestsService, requestError } from './requests.service';
@Component({selector:'app-request-dialog',imports:[FormsModule,RouterLink,ChatToasts],template:`
<dialog #dialog aria-labelledby="request-title" (cancel)="close($event)" (click)="backdrop($event)">
<header><div><p>ЗАЯВКА НА ТОВАР</p><h2 id="request-title">{{ product().name || 'Без названия' }}</h2></div><button type="button" aria-label="Закрыть заявку" (click)="close()" [disabled]="busy()">×</button></header>
@if(sent();as id){<section class="success" role="status"><h3>Заявка отправлена</h3><p>Продавец получил ваши данные. Следить за статусом можно в профиле.</p><a class="button dark" routerLink="/account" [queryParams]="{request:id}" (click)="closed.emit()">Перейти к заявке</a></section>}
@else{<form #form="ngForm" (ngSubmit)="submit()"><fieldset [disabled]="busy()">
<label>Фамилия<input name="lastName" [(ngModel)]="lastName" autocomplete="family-name" required maxlength="100"></label>
<label>Имя<input name="firstName" [(ngModel)]="firstName" autocomplete="given-name" required maxlength="100"></label>
<label>Отчество <small>Необязательно</small><input name="patronymic" [(ngModel)]="patronymic" autocomplete="additional-name" maxlength="100"></label>
<label>Контакт для связи<input name="contact" [(ngModel)]="contact" required maxlength="300" placeholder="Телефон, email или мессенджер"></label>
<label>Город доставки<input name="city" [(ngModel)]="city" autocomplete="address-level2" required maxlength="160"></label>
<p class="hint">Эти данные увидит продавец для связи и доставки.</p>
@if(error()){<p class="error" role="alert">{{error()}}</p>}
<button type="submit" class="button dark" [disabled]="form.invalid||busy()">{{busy()?'Отправляем…':'Отправить заявку'}}</button>
</fieldset></form>}
<app-chat-toasts /></dialog>`,styles:[`
dialog{padding:0;border:1px solid var(--line);background:var(--paper);color:var(--ink);width:min(560px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overscroll-behavior:contain}dialog::backdrop{background:#20251f80}
header{display:flex;justify-content:space-between;gap:16px;padding:24px;border-bottom:1px solid var(--line)}header p,.hint,small{font-size:12px;color:var(--muted)}h2{font-size:24px;margin-top:8px;overflow-wrap:anywhere}header button{border:0;background:none;color:inherit;min-width:44px;height:44px;font-size:30px}
form,.success{padding:24px}fieldset{border:0;padding:0;min-width:0}label{display:flex;flex-direction:column;gap:8px;margin-bottom:18px;font-size:14px}input{width:100%;min-width:0;padding:12px;border:1px solid var(--line);background:white;font:inherit;font-size:16px;border-radius:0}.button{margin-top:20px;width:100%}.error{color:#852e22;margin-top:16px}.success p{margin-top:16px;line-height:1.6}button:disabled{opacity:.5}
@media(max-width:700px){dialog{position:fixed;inset:0;margin:0;width:100%;max-width:100%;height:100dvh;max-height:100dvh;border:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}header,form,.success{padding:18px}}
`]})
export class RequestDialog implements AfterViewInit,OnDestroy {
 readonly product=input.required<Product>();readonly closed=output();readonly api=inject(RequestsService);
 @ViewChild('dialog') dialog!:ElementRef<HTMLDialogElement>;
 readonly busy=signal(false);readonly sent=signal<number|null>(null);readonly error=signal('');
 lastName='';firstName='';patronymic='';contact='';city='';
 private bodyStyle='';private overflow='';private scroll=0;
 ngAfterViewInit(){this.bodyStyle=document.body.style.cssText;this.overflow=document.documentElement.style.overflow;this.scroll=window.scrollY;document.body.style.position='fixed';document.body.style.top=-this.scroll+'px';document.body.style.width='100%';document.body.style.overflow='hidden';document.documentElement.style.overflow='hidden';this.dialog.nativeElement.showModal();}
 close(e?:Event){e?.preventDefault();if(!this.busy())this.closed.emit();}
 backdrop(e:MouseEvent){if(e.target===this.dialog.nativeElement){const r=this.dialog.nativeElement.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)this.close();}}
 async submit(){if(this.busy())return;this.busy.set(true);this.error.set('');try{const row=await this.api.create({product_id:this.product().id,last_name:this.lastName,first_name:this.firstName,patronymic:this.patronymic,contact:this.contact,city:this.city});this.sent.set(row.id);this.api.revision.update(v=>v+1);}catch(e){this.error.set(requestError(e));}finally{this.busy.set(false);}}
 ngOnDestroy(){this.api.formOpen.set(false);this.dialog.nativeElement.close();document.body.style.cssText=this.bodyStyle;document.documentElement.style.overflow=this.overflow;window.scrollTo(0,this.scroll);}
}
