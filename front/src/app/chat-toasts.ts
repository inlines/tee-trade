import { Router } from '@angular/router';
import { RequestNotice, requestStatus, RequestsService } from './requests.service';
import { Component, Injectable, effect, inject, signal } from '@angular/core';
import { Chat, ChatMessage, ChatService } from './chat.service';
export interface ChatNotice { chat:Chat; message:ChatMessage; admin:boolean; }
@Injectable({providedIn:'root'})
export class ChatToastStore {
  readonly notices=signal<ChatNotice[]>([]);
  readonly requests=signal<RequestNotice[]>([]);
  private readonly router=inject(Router);
  private readonly requestApi=inject(RequestsService);
  readonly requestLabel=requestStatus;
  addRequest(notice:RequestNotice){
    for(const old of this.requests().slice(0,-2))this.dismissRequest(old.id);
    this.requests.update(items=>[...items,notice]);
    this.timers.set(-notice.id,setTimeout(()=>this.dismissRequest(notice.id),15000));
  }
  dismissRequest(id:number){clearTimeout(this.timers.get(-id));this.timers.delete(-id);this.requests.update(items=>items.filter(item=>item.id!==id));}
  openRequest(event:Event,notice:RequestNotice){event.preventDefault();this.requestApi.formOpen.set(false);this.dismissRequest(notice.id);this.chats.close();this.chats.drawer.set(false);void this.router.navigate([notice.admin?'/admin':'/account'],{queryParams:{request:notice.request_id}});}

  private readonly chats=inject(ChatService);
  private readonly timers=new Map<number,ReturnType<typeof setTimeout>>();
  constructor(){effect(()=>{
    const selected=this.chats.selected();
    if(selected)for(const notice of this.notices())if(notice.chat.id===selected.chat.id&&notice.admin===selected.admin)this.dismiss(notice.message.id);
  });}
  add(notice:ChatNotice){
    for(const old of this.notices().slice(0,-2))this.dismiss(old.message.id);
    this.notices.update(items=>[...items,notice]);
    this.timers.set(notice.message.id,setTimeout(()=>this.dismiss(notice.message.id),15000));
  }
  dismiss(id:number){clearTimeout(this.timers.get(id));this.timers.delete(id);this.notices.update(items=>items.filter(item=>item.message.id!==id));}
  clear(){for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();this.notices.set([]);this.requests.set([]);}
  open(event:Event,notice:ChatNotice){
    event.preventDefault();this.requestApi.formOpen.set(false);this.dismiss(notice.message.id);
    // Unmount the current modal before mounting its replacement so scroll locks
    // and focus restoration cannot interfere with the newly opened chat.
    this.chats.close();this.chats.drawer.set(false);
    setTimeout(()=>this.chats.open(notice.chat,notice.admin),0);
  }
}
@Component({selector:'app-chat-toasts',template:`
<div class="chat-notices" aria-live="polite" aria-relevant="additions">
  @for(notice of store.notices();track notice.message.id){
    <article class="chat-notice"><button type="button" class="dismiss" aria-label="Закрыть уведомление" (click)="store.dismiss(notice.message.id)">×</button><p>Новое сообщение · {{notice.admin?notice.chat.username:'Продавец'}}</p><a [href]="(notice.admin?'/admin':'/account')+'?chat='+notice.chat.id" (click)="store.open($event,notice)"><strong>{{notice.chat.product_name||'Без названия'}}</strong><span>{{notice.message.body}}</span><b>Открыть чат</b></a></article>
  }
  @for(notice of store.requests();track notice.id){
    <article class="chat-notice"><button type="button" class="dismiss" aria-label="Закрыть уведомление о заявке" (click)="store.dismissRequest(notice.id)">×</button><p>{{notice.admin?'Новая заявка':'Статус заявки изменён'}} · №{{notice.request_id}}</p><a [href]="(notice.admin?'/admin':'/account')+'?request='+notice.request_id" (click)="store.openRequest($event,notice)"><strong>{{notice.product_name||'Без названия'}}</strong><span>{{store.requestLabel(notice.status)}}</span><b>Открыть заявку</b></a></article>
  }
</div>`,styles:[`
:host{display:contents}.chat-notices{position:fixed;z-index:100;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));width:min(360px,calc(100vw - 32px));display:flex;flex-direction:column;gap:10px;pointer-events:none}
.chat-notice{position:relative;padding:18px;background:var(--paper);border:1px solid var(--line);box-shadow:0 6px 30px #20251f30;pointer-events:auto;color:var(--ink);overflow-wrap:anywhere}
.chat-notice p{padding-right:40px;font-size:11px;color:var(--muted)}a{display:flex;flex-direction:column;gap:8px;margin-top:8px;min-height:44px;touch-action:manipulation}strong{font-size:15px}a span{font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}b{font-size:12px;text-decoration:underline}.dismiss{position:absolute;right:4px;top:4px;width:44px;height:44px;background:none;border:0;font-size:28px;color:var(--ink);touch-action:manipulation}
`]})
export class ChatToasts {readonly store=inject(ChatToastStore);}
