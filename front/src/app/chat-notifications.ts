import { RequestNotifications } from './request-notifications';
import { Component, OnDestroy, OnInit, inject, input } from '@angular/core';
import { ChatService } from './chat.service';
import { AdminService } from './admin.service';
import { CustomerService } from './customer.service';
import { NotificationSound } from './notification-sound.service';
import { ChatNotice, ChatToastStore } from './chat-toasts';
@Component({selector:'app-chat-notifications',imports:[RequestNotifications],template:`
  <app-request-notifications [admin]="adminSide()" />
  <button class="chat-bell" (click)="chats.drawer.set(true)" [attr.aria-label]="'Чаты, непрочитанных сообщений: '+chats.unread()" [attr.aria-expanded]="chats.drawer()" aria-haspopup="dialog">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M9 20a3 3 0 0 0 6 0"/></svg>
    @if(chats.unread()){<span class="bell-dot"></span><span class="bell-count">{{chats.unread()>99?'99+':chats.unread()}}</span>}
  </button>
`,styles:[`
    :host{display:contents}.chat-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:48px;min-height:44px;padding:10px;border:0;background:none;color:var(--ink)}.bell-dot{position:absolute;right:9px;top:5px;width:7px;height:7px;border-radius:50%;background:#ad4632;border:1px solid var(--paper)}.bell-count{font-size:10px;background:var(--ink);color:var(--paper);border-radius:12px;min-width:18px;padding:3px;margin-left:4px}.sound-toggle,.sound-test{border:1px solid var(--line);padding:8px 10px;background:transparent;color:var(--muted);font-size:11px;max-width:100%}
  `]})
export class ChatNotifications implements OnInit,OnDestroy {
  private readonly toasts=inject(ChatToastStore);
  readonly adminSide=input(false);readonly sound=inject(NotificationSound);private readonly customer=inject(CustomerService);
  readonly chats=inject(ChatService);private readonly admin=inject(AdminService);
  private socket?:WebSocket;private timer?:ReturnType<typeof setTimeout>;private watchdog?:ReturnType<typeof setTimeout>;private destroyed=false;private cursor:number|undefined;private seen=new Set<number>();
  private poll?:ReturnType<typeof setInterval>;
  private readonly resume=()=>{if(!document.hidden&&!this.destroyed)this.connect();};
  ngOnInit(){this.toasts.clear();this.chats.reset(this.adminSide());void this.chats.refresh(this.adminSide());this.poll=setInterval(()=>{if(!document.hidden)void this.chats.refresh(this.adminSide());},10000);this.connect();window.addEventListener('online',this.resume);document.addEventListener('visibilitychange',this.resume);}
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
        void this.chats.refresh(this.adminSide());const notice:ChatNotice={...data,admin:this.adminSide()};this.cursor=Math.max(this.cursor??0,notice.message.id);
        if(this.seen.has(notice.message.id))return;this.seen.add(notice.message.id);if(this.seen.size>500)this.seen.delete(this.seen.values().next().value!);
        const selected=this.chats.selected();
        if(selected?.chat.id===notice.chat.id && selected.admin===this.adminSide())return;
        this.toasts.add(notice);void this.sound.play();
      }
    };
    socket.onclose=()=>{if(!this.destroyed&&this.socket===socket){clearTimeout(this.watchdog);this.timer=setTimeout(()=>this.connect(),3000);}};
    socket.onerror=()=>socket.close();
  }
  ngOnDestroy(){this.destroyed=true;clearInterval(this.poll);this.chats.reset(this.adminSide());clearTimeout(this.timer);clearTimeout(this.watchdog);this.toasts.clear();this.socket?.close();window.removeEventListener('online',this.resume);document.removeEventListener('visibilitychange',this.resume);}
}
