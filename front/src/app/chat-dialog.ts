import { ChatToasts } from './chat-toasts';
import { HttpErrorResponse } from '@angular/common/http';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Chat, ChatMessage, ChatService, History } from './chat.service';
@Component({
  selector:'app-chat-dialog',imports:[FormsModule,DatePipe,RouterLink,ChatToasts],
  template:`<dialog #dialog aria-labelledby="chat-title" (cancel)="close($event)" (click)="backdrop($event)">
    <div class="chat-shell">
      <header><div><p>{{ admin() ? chat().username : 'Чат с продавцом' }}</p><h2 id="chat-title">{{ chat().product_name || 'Без названия' }} <small>№{{ chat().product_id }}</small></h2></div><button class="chat-close" aria-label="Закрыть чат" (click)="close()">×</button></header>
      <div class="chat-status" role="status">{{ status() }} @if (!connected() && !pending()) { <button class="text-link" (click)="reconnect()">Повторить</button> } @if (chat().product_exists) { <a [routerLink]="['/product',chat().product_id]" (click)="close()">К товару</a> } @else { <span>Товар удалён</span> }</div>
      <div class="chat-messages" (scroll)="markVisibleRead()" #scrollArea role="log" aria-label="История переписки" aria-live="polite">
        @if (hasMore()) { <button class="text-link older" (click)="older()" [disabled]="loadingOlder()">{{ loadingOlder() ? 'Загружаем…' : 'Предыдущие сообщения' }}</button> }
        @for (message of messages();track message.id) {
          <article class="bubble" [class.mine]="message.is_admin === admin()"><span class="sender">{{ message.is_admin ? 'Продавец' : chat().username }}</span><p>{{ message.body }}</p><time [attr.datetime]="message.created_at">{{ date(message.created_at) | date:'dd.MM.yyyy HH:mm' }}</time></article>
        } @empty { @if (connected()) { <p class="chat-empty">Начните разговор о товаре.</p> } }
      </div>
      <div class="typing" aria-live="polite">{{ typing() ? (admin() ? chat().username : 'Продавец') + ' печатает…' : '' }}</div>
      @if (error()) { <p class="chat-error" role="alert">{{ error() }}</p> }
      <form (ngSubmit)="send()"><label class="sr-label" for="chat-body">Сообщение</label><textarea id="chat-body" name="body" [(ngModel)]="draft" (input)="onTyping()" (keydown)="onKey($event)" maxlength="4000" rows="3" placeholder="Напишите сообщение…" [disabled]="pending()"></textarea><div class="chat-send"><span>Enter — отправить · Shift+Enter — новая строка</span><button class="button dark" type="submit" [disabled]="!connected() || pending() || !draft.trim()">{{ pending() ? 'Отправляем…' : 'Отправить' }}</button></div></form>
    </div>
  <app-chat-toasts /></dialog>`,
  styles:[`
    dialog{width:min(680px,calc(100vw - 24px));max-height:calc(100dvh - 24px);padding:0;border:1px solid var(--line);color:var(--ink);background:var(--paper)}dialog::backdrop{background:#20251f80}.chat-shell{display:flex;flex-direction:column;height:min(760px,calc(100dvh - 28px))}
    header{display:flex;justify-content:space-between;gap:16px;padding:22px 24px;border-bottom:1px solid var(--line)}header p{font-size:12px;color:var(--muted)}h2{font-size:22px;margin-top:6px;overflow-wrap:anywhere}small{font-size:12px;letter-spacing:0;font-weight:normal;white-space:nowrap}.chat-close{background:none;border:0;font-size:30px;align-self:flex-start;padding:0 6px;color:var(--ink)}
    .chat-status{display:flex;justify-content:space-between;gap:12px;padding:12px 24px;font-size:11px;color:var(--muted)}.chat-status a{text-decoration:underline}.chat-messages{flex:1;min-height:80px;overflow:auto;padding:16px 24px;display:flex;flex-direction:column;gap:12px;overscroll-behavior:contain}.bubble{align-self:flex-start;max-width:85%;padding:12px 15px;background:#e8e8e0}.bubble.mine{align-self:flex-end;background:#e0e8cc}.bubble p{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}.sender{font-size:10px;color:var(--muted)}time{display:block;text-align:right;font-size:10px;color:var(--muted);margin-top:6px}.chat-empty{text-align:center;font-size:13px;color:var(--muted);margin:auto}.typing{height:26px;padding:4px 24px;font-size:11px;color:var(--muted)}
    form{padding:16px 24px;border-top:1px solid var(--line)}textarea{width:100%;resize:none;border:1px solid var(--line);background:#fff;padding:12px;font:inherit;font-size:14px;border-radius:0}.chat-send{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:10px}.chat-send span{font-size:10px;color:var(--muted)}.button{padding:12px 18px;min-height:44px}button:disabled{opacity:.5;cursor:not-allowed}.chat-error{font-size:12px;color:#852e22;padding:8px 24px}.older{align-self:center}.sr-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
    @media(max-width:500px){header,form{padding:16px}.chat-messages{padding:12px 16px}.chat-send span{display:none}.chat-send{justify-content:flex-end}.bubble{max-width:92%}}
    header>div {min-width:0} .sender {overflow-wrap:anywhere} .chat-status {flex-wrap:wrap} .bubble {flex-shrink:0} .chat-shell {min-height:0} header,form,.typing,.chat-status {flex-shrink:0}
    @media(max-width:700px){
      dialog {position:fixed;inset:auto;top:var(--chat-top,0);left:0;margin:0;width:100%;max-width:100%;height:var(--chat-height,100dvh);max-height:var(--chat-height,100dvh);border:0;overscroll-behavior:none;overflow:hidden;}
      .chat-shell {height:100%;min-height:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);box-sizing:border-box;}
      .chat-messages {min-height:0;touch-action:pan-y;-webkit-overflow-scrolling:touch;}
      textarea {font-size:16px;max-height:90px;} header,form {padding:12px 16px}.chat-close {min-width:44px;min-height:44px}
    }
  `]
})
export class ChatDialog implements AfterViewInit,OnDestroy {
  readonly chat=input.required<Chat>(); readonly admin=input(false); readonly api=inject(ChatService);
  @ViewChild('dialog') dialog!:ElementRef<HTMLDialogElement>;
  @ViewChild('scrollArea') scrollArea!:ElementRef<HTMLElement>;
  readonly messages=signal<ChatMessage[]>([]); readonly connected=signal(false); readonly status=signal('Подключаемся…'); readonly typing=signal(false); readonly error=signal(''); readonly pending=signal(false); readonly hasMore=signal(false); readonly loadingOlder=signal(false);
  draft=''; private socket?:WebSocket; private destroyed=false; private unauthorized=false; private retryTimer?:ReturnType<typeof setTimeout>; private typingTimer?:ReturnType<typeof setTimeout>; private stopTypingTimer?:ReturnType<typeof setTimeout>; private acknowledgementTimer?:ReturnType<typeof setTimeout>; private lastTyping=0; private outbound:{type:'message';client_id:string;body:string}|null=null;
  private connectTimer?:ReturnType<typeof setTimeout>;
  private savedBodyStyle=''; private savedHtmlOverflow=''; private savedScroll=0;
  private readonly viewportChanged=()=>{
    const viewport=window.visualViewport;
    this.dialog.nativeElement.style.setProperty('--chat-height',(viewport?.height??window.innerHeight)+'px');
    this.dialog.nativeElement.style.setProperty('--chat-top',(viewport?.offsetTop??0)+'px');
  };
  private readonly resume=()=>{if(!document.hidden&&!this.destroyed&&!this.unauthorized)this.reconnect();};
  ngAfterViewInit(){
    this.savedScroll=window.scrollY;this.savedBodyStyle=document.body.style.cssText;this.savedHtmlOverflow=document.documentElement.style.overflow;
    document.body.style.position='fixed';document.body.style.top=-this.savedScroll+'px';document.body.style.width='100%';document.body.style.overflow='hidden';document.documentElement.style.overflow='hidden';
    this.dialog.nativeElement.showModal();this.viewportChanged();
    window.visualViewport?.addEventListener('resize',this.viewportChanged);window.visualViewport?.addEventListener('scroll',this.viewportChanged);
    window.addEventListener('online',this.resume);document.addEventListener('visibilitychange',this.resume);
    this.connect();
  }
  reconnect(){clearTimeout(this.retryTimer);this.unauthorized=false;this.connected.set(false);this.status.set('Подключаемся…');this.connect();}

  private connect(){
    if(this.destroyed||this.unauthorized)return;
    clearTimeout(this.connectTimer);this.socket?.close();
    const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/${this.admin()?'admin':'auth'}/chats/ws?chat_id=${this.chat().id}`);this.socket=socket;
    this.connectTimer=setTimeout(()=>{if(this.socket===socket&&!this.connected()){this.status.set('Подключение занимает больше времени. Повторяем…');socket.close();}},10000);
    socket.onmessage=event=>{
      if(this.destroyed||this.socket!==socket)return;
      const data=JSON.parse(event.data);
      if(data.type==='history'){
        clearTimeout(this.connectTimer);
        this.merge(data.messages);this.hasMore.set(this.hasMore()||data.has_more);this.connected.set(true);this.status.set('На связи');this.bottom();
        if(this.outbound){const saved=this.messages().some(m=>m.is_admin===this.admin()&&m.client_id===this.outbound!.client_id);if(saved)this.ack();else this.transmit();}
      }else if(data.type==='message'){
        const nearBottom=this.scrollArea.nativeElement.scrollHeight-this.scrollArea.nativeElement.scrollTop-this.scrollArea.nativeElement.clientHeight<100;
        this.merge([data.message]);if(this.outbound&&data.message.is_admin===this.admin()&&data.message.client_id===this.outbound.client_id)this.ack();
        if(nearBottom||data.message.is_admin===this.admin())this.bottom();
        if(data.message.is_admin!==this.admin())this.typing.set(false);
      }else if(data.type==='typing'&&data.is_admin!==this.admin()){
        this.typing.set(data.active);clearTimeout(this.typingTimer);this.typingTimer=setTimeout(()=>this.typing.set(false),3500);
      }else if(data.type==='error'){
        this.error.set(data.message);clearTimeout(this.acknowledgementTimer);this.pending.set(false);this.outbound=null;
      }else if(data.type==='unauthorized'){
        this.unauthorized=true;this.status.set('Сессия истекла. Войдите снова.');this.pending.set(false);socket.close();
      }
    };
    socket.onclose=()=>{if(this.destroyed||this.socket!==socket)return;this.connected.set(false);this.typing.set(false);clearTimeout(this.connectTimer);clearTimeout(this.acknowledgementTimer);if(!this.unauthorized){void this.recover();}};
    socket.onerror=()=>socket.close();
  }
  private async recover(){
    this.status.set('Связь потеряна. Проверяем подключение…');
    try { await this.api.history(this.chat().id,this.admin()); }
    catch(error){
      if(this.destroyed)return;
      if(error instanceof HttpErrorResponse && [401,403,404].includes(error.status)){
        this.unauthorized=true;this.pending.set(false);this.status.set(error.status===404?'Чат больше недоступен.':'Войдите в аккаунт заново и откройте чат.');return;
      }
    }
    if(!this.destroyed&&!this.unauthorized){this.status.set('Связь потеряна. Переподключаемся…');this.retryTimer=setTimeout(()=>this.connect(),2500);}
  }
  private readThrough=0;private markingRead=false;
  markVisibleRead(){
    if(this.destroyed||document.hidden||this.markingRead)return;
    const el=this.scrollArea?.nativeElement;if(!el||el.scrollHeight-el.scrollTop-el.clientHeight>100)return;
    const through=this.messages().filter(message=>message.is_admin!==this.admin()).at(-1)?.id??0;
    if(through<=this.readThrough)return;
    this.markingRead=true;
    void this.api.markRead(this.chat().id,this.admin(),through).then(()=>{this.readThrough=through;this.markingRead=false;this.markVisibleRead();}).catch(()=>{this.markingRead=false;});
  }
  private merge(values:ChatMessage[]){this.messages.update(current=>Array.from(new Map([...current,...values].map(m=>[m.id,m])).values()).sort((a,b)=>a.id-b.id));}
  private bottom(){setTimeout(()=>{if(!this.destroyed){const el=this.scrollArea.nativeElement;el.scrollTop=el.scrollHeight;this.markVisibleRead();}},0);}
  private ack(){this.outbound=null;this.pending.set(false);this.draft='';this.error.set('');clearTimeout(this.acknowledgementTimer);}
  private transmit(){if(this.outbound&&this.socket?.readyState===WebSocket.OPEN){this.socket.send(JSON.stringify(this.outbound));clearTimeout(this.acknowledgementTimer);this.acknowledgementTimer=setTimeout(()=>this.socket?.close(),10000);}}
  send(){if(!this.connected()||this.pending()||!this.draft.trim())return;this.error.set('');this.pending.set(true);this.outbound={type:'message',client_id:Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''),body:this.draft.trim()};this.transmit();this.typingEvent(false);}
  onKey(event:KeyboardEvent){if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();this.send();}}
  private typingEvent(active:boolean){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({type:'typing',active}));}
  onTyping(){if(Date.now()-this.lastTyping>1000){this.lastTyping=Date.now();this.typingEvent(!!this.draft.trim());}clearTimeout(this.stopTypingTimer);this.stopTypingTimer=setTimeout(()=>this.typingEvent(false),2000);}
  async older(){if(this.loadingOlder()||!this.messages().length)return;this.loadingOlder.set(true);const el=this.scrollArea.nativeElement;const height=el.scrollHeight;try{const h:History=await this.api.history(this.chat().id,this.admin(),this.messages()[0].id);this.merge(h.messages);this.hasMore.set(h.has_more);setTimeout(()=>{if(!this.destroyed)el.scrollTop=el.scrollHeight-height;},0);}catch{this.error.set('Не удалось загрузить историю. Попробуйте ещё раз.');}finally{this.loadingOlder.set(false);}}
  date(value:string){return new Date(value.replace(' ','T').replace(/\+00$/, '+00:00'));}
  close(event?:Event){event?.preventDefault();this.api.close();}
  backdrop(event:MouseEvent){if(event.target===this.dialog.nativeElement){const r=this.dialog.nativeElement.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)this.close();}}
  ngOnDestroy(){this.destroyed=true;clearTimeout(this.connectTimer);
    window.visualViewport?.removeEventListener('resize',this.viewportChanged);window.visualViewport?.removeEventListener('scroll',this.viewportChanged);window.removeEventListener('online',this.resume);document.removeEventListener('visibilitychange',this.resume);
    document.body.style.cssText=this.savedBodyStyle;document.documentElement.style.overflow=this.savedHtmlOverflow;window.scrollTo(0,this.savedScroll);
this.typingEvent(false);clearTimeout(this.retryTimer);clearTimeout(this.typingTimer);clearTimeout(this.stopTypingTimer);clearTimeout(this.acknowledgementTimer);this.socket?.close();this.dialog.nativeElement.close();}
}
