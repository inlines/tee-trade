import { Component, ElementRef, ViewChild, OnDestroy, OnInit, inject, signal, input } from '@angular/core';
import { Chat, ChatMessage, ChatService } from './chat.service';
import { AdminService } from './admin.service';
import { CustomerService } from './customer.service';
import { NotificationSound } from './notification-sound.service';
interface Notice { chat:Chat; message:ChatMessage; }
@Component({selector:'app-chat-notifications',template:`
  <button class="chat-bell" (click)="chats.drawer.set(true)" [attr.aria-label]="'Чаты, непрочитанных сообщений: '+chats.unread()" [attr.aria-expanded]="chats.drawer()" aria-haspopup="dialog">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M9 20a3 3 0 0 0 6 0"/></svg>
    @if(chats.unread()){<span class="bell-dot"></span><span class="bell-count">{{chats.unread()>99?'99+':chats.unread()}}</span>}
  </button>
  <div #noticeLayer popover="manual" class="chat-notices" aria-live="polite" aria-relevant="additions">
    @for(notice of notices();track notice.message.id){
      <article class="chat-notice"><button class="dismiss" aria-label="Закрыть уведомление" (click)="dismiss(notice.message.id)">×</button><p>Новое сообщение · {{adminSide() ? notice.chat.username : 'Продавец'}}</p><a [href]="(adminSide() ? '/admin' : '/account')+'?chat='+notice.chat.id" (click)="open($event,notice)"><strong>{{notice.chat.product_name||'Без названия'}}</strong><span>{{notice.message.body}}</span><b>Открыть чат</b></a></article>
    }
  </div>`,styles:[`
    :host{display:contents}.chat-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:48px;min-height:44px;padding:10px;border:0;background:none;color:var(--ink)}.bell-dot{position:absolute;right:9px;top:5px;width:7px;height:7px;border-radius:50%;background:#ad4632;border:1px solid var(--paper)}.bell-count{font-size:10px;background:var(--ink);color:var(--paper);border-radius:12px;min-width:18px;padding:3px;margin-left:4px}.sound-toggle,.sound-test{border:1px solid var(--line);padding:8px 10px;background:transparent;color:var(--muted);font-size:11px;max-width:100%}
    .chat-notices{margin:0;border:0;padding:0;background:transparent;inset:auto;overflow:visible;color:var(--ink);position:fixed;z-index:100;right:20px;bottom:20px;width:min(360px,calc(100vw - 32px));display:flex;flex-direction:column;gap:10px;pointer-events:none}.chat-notice{position:relative;padding:18px;background:var(--paper);border:1px solid var(--line);box-shadow:0 6px 30px #20251f30;pointer-events:auto;overflow-wrap:anywhere}.chat-notice p{padding-right:25px;font-size:11px;color:var(--muted)}a{display:flex;flex-direction:column;gap:8px;margin-top:8px}strong{font-size:15px}a span{font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}b{font-size:12px;text-decoration:underline}.dismiss{position:absolute;right:8px;top:6px;background:none;border:0;font-size:24px;color:var(--ink)}
    @media(max-width:700px){.chat-notices{right:16px;bottom:calc(16px + env(safe-area-inset-bottom))}}
  `]})
export class ChatNotifications implements OnInit,OnDestroy {
  @ViewChild('noticeLayer') noticeLayer!:ElementRef<HTMLElement>;
  readonly adminSide=input(false);readonly sound=inject(NotificationSound);private readonly customer=inject(CustomerService);
  readonly chats=inject(ChatService);private readonly admin=inject(AdminService);
  readonly notices=signal<Notice[]>([]);
  private socket?:WebSocket;private timer?:ReturnType<typeof setTimeout>;private watchdog?:ReturnType<typeof setTimeout>;private destroyed=false;private cursor:number|undefined;private seen=new Set<number>();
  private poll?:ReturnType<typeof setInterval>;
  private noticeTimers=new Map<number,ReturnType<typeof setTimeout>>();
  private readonly resume=()=>{if(!document.hidden&&!this.destroyed)this.connect();};
  ngOnInit(){this.chats.reset(this.adminSide());void this.chats.refresh(this.adminSide());this.poll=setInterval(()=>{if(!document.hidden)void this.chats.refresh(this.adminSide());},10000);this.connect();window.addEventListener('online',this.resume);document.addEventListener('visibilitychange',this.resume);}
  private connect(){
    if(this.destroyed||!(this.adminSide()?this.admin.session():this.customer.session()))return;clearTimeout(this.timer);clearTimeout(this.watchdog);this.socket?.close();
    const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/${this.adminSide()?'admin':'auth'}/chats/events${this.cursor===undefined?'':'?after='+this.cursor}`);this.socket=socket;
    this.watchdog=setTimeout(()=>socket.close(),10000);
    socket.onmessage=event=>{
      if(this.destroyed||socket!==this.socket)return;
      const data=JSON.parse(event.data);
      if(data.type==='ready'){void this.chats.refresh(this.adminSide());clearTimeout(this.watchdog);this.cursor=Math.max(this.cursor??0,data.cursor);}
      if(data.type==='unauthorized'){(this.adminSide()?this.admin.session:this.customer.session).set(null);return;}
      if(data.type==='notification'){
        void this.chats.refresh(this.adminSide());const notice:Notice=data;this.cursor=Math.max(this.cursor??0,notice.message.id);
        if(this.seen.has(notice.message.id))return;this.seen.add(notice.message.id);if(this.seen.size>500)this.seen.delete(this.seen.values().next().value!);
        this.notices.update(items=>[...items.slice(-2),notice]);void this.sound.play();
        setTimeout(()=>{const layer=this.noticeLayer?.nativeElement;if(!this.destroyed&&this.notices().length&&layer?.showPopover&&!layer.matches(':popover-open'))layer.showPopover();},0);
        this.noticeTimers.set(notice.message.id,setTimeout(()=>this.dismiss(notice.message.id),15000));
      }
    };
    socket.onclose=()=>{if(!this.destroyed&&this.socket===socket){clearTimeout(this.watchdog);this.timer=setTimeout(()=>this.connect(),3000);}};
    socket.onerror=()=>socket.close();
  }
  dismiss(id:number){this.notices.update(items=>items.filter(n=>n.message.id!==id));clearTimeout(this.noticeTimers.get(id));this.noticeTimers.delete(id);if(!this.notices().length)this.noticeLayer?.nativeElement.hidePopover?.();}
  async open(event:Event,notice:Notice){event.preventDefault();this.dismiss(notice.message.id);this.chats.drawer.set(false);setTimeout(()=>this.chats.open(notice.chat,this.adminSide()),0);}
  ngOnDestroy(){this.destroyed=true;clearInterval(this.poll);this.chats.reset(this.adminSide());clearTimeout(this.timer);clearTimeout(this.watchdog);for(const timer of this.noticeTimers.values())clearTimeout(timer);this.socket?.close();window.removeEventListener('online',this.resume);document.removeEventListener('visibilitychange',this.resume);}
}
