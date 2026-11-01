import { Component, ElementRef, ViewChild, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Chat, ChatMessage, ChatService } from './chat.service';
import { AdminService } from './admin.service';
interface Notice { chat:Chat; message:ChatMessage; }
@Component({selector:'app-admin-notifications',template:`
  <button class="sound-toggle" (click)="toggleSound()" [attr.aria-pressed]="soundReady() && enabled()" [attr.title]="enabled() && soundReady() ? 'Выключить звук новых сообщений' : 'Включить звук новых сообщений'">{{enabled() && soundReady() ? 'Звук включён' : 'Включить звук'}}</button>
  <div #noticeLayer popover="manual" class="chat-notices" aria-live="polite" aria-relevant="additions">
    @for(notice of notices();track notice.message.id){
      <article class="chat-notice"><button class="dismiss" aria-label="Закрыть уведомление" (click)="dismiss(notice.message.id)">×</button><p>Новое сообщение · {{notice.chat.username}}</p><a [href]="'/admin?chat='+notice.chat.id" (click)="open($event,notice)"><strong>{{notice.chat.product_name||'Без названия'}}</strong><span>{{notice.message.body}}</span><b>Открыть чат</b></a></article>
    }
  </div>`,styles:[`
    :host{display:contents}.sound-toggle{border:1px solid var(--line);padding:8px 10px;background:transparent;color:var(--muted);font-size:11px;max-width:100%}
    .chat-notices{margin:0;border:0;padding:0;background:transparent;inset:auto;overflow:visible;color:var(--ink);position:fixed;z-index:100;right:20px;bottom:20px;width:min(360px,calc(100vw - 32px));display:flex;flex-direction:column;gap:10px;pointer-events:none}.chat-notice{position:relative;padding:18px;background:var(--paper);border:1px solid var(--line);box-shadow:0 6px 30px #20251f30;pointer-events:auto;overflow-wrap:anywhere}.chat-notice p{padding-right:25px;font-size:11px;color:var(--muted)}a{display:flex;flex-direction:column;gap:8px;margin-top:8px}strong{font-size:15px}a span{font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}b{font-size:12px;text-decoration:underline}.dismiss{position:absolute;right:8px;top:6px;background:none;border:0;font-size:24px;color:var(--ink)}
    @media(max-width:700px){.chat-notices{right:16px;bottom:calc(16px + env(safe-area-inset-bottom))}}
  `]})
export class AdminNotifications implements OnInit,OnDestroy {
  @ViewChild('noticeLayer') noticeLayer!:ElementRef<HTMLElement>;
  private readonly chats=inject(ChatService);private readonly admin=inject(AdminService);private readonly router=inject(Router);
  readonly notices=signal<Notice[]>([]);readonly soundReady=signal(false);readonly enabled=signal(true);
  private socket?:WebSocket;private timer?:ReturnType<typeof setTimeout>;private watchdog?:ReturnType<typeof setTimeout>;private destroyed=false;private cursor:number|undefined;private seen=new Set<number>();private audio?:AudioContext;private lastSound=0;
  private noticeTimers=new Map<number,ReturnType<typeof setTimeout>>();
  private readonly resume=()=>{if(!document.hidden&&!this.destroyed)this.connect();};
  ngOnInit(){this.connect();window.addEventListener('online',this.resume);document.addEventListener('visibilitychange',this.resume);}
  private connect(){
    if(this.destroyed||!this.admin.session())return;clearTimeout(this.timer);clearTimeout(this.watchdog);this.socket?.close();
    const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/admin/chats/events${this.cursor===undefined?'':'?after='+this.cursor}`);this.socket=socket;
    this.watchdog=setTimeout(()=>socket.close(),10000);
    socket.onmessage=event=>{
      if(this.destroyed||socket!==this.socket)return;
      const data=JSON.parse(event.data);
      if(data.type==='ready'){clearTimeout(this.watchdog);this.cursor=Math.max(this.cursor??0,data.cursor);}
      if(data.type==='unauthorized'){this.admin.session.set(null);return;}
      if(data.type==='notification'){
        const notice:Notice=data;this.cursor=Math.max(this.cursor??0,notice.message.id);
        if(this.seen.has(notice.message.id))return;this.seen.add(notice.message.id);if(this.seen.size>500)this.seen.delete(this.seen.values().next().value!);
        this.notices.update(items=>[...items.slice(-2),notice]);this.beep();
        setTimeout(()=>{const layer=this.noticeLayer?.nativeElement;if(!this.destroyed&&this.notices().length&&layer?.showPopover&&!layer.matches(':popover-open'))layer.showPopover();},0);
        this.noticeTimers.set(notice.message.id,setTimeout(()=>this.dismiss(notice.message.id),15000));
      }
    };
    socket.onclose=()=>{if(!this.destroyed&&this.socket===socket){clearTimeout(this.watchdog);this.timer=setTimeout(()=>this.connect(),3000);}};
    socket.onerror=()=>socket.close();
  }
  @HostListener('document:pointerdown', ['$event'])
  @HostListener('document:keydown', ['$event'])
  unlock(event:Event){if((event.target as Element)?.closest?.('.sound-toggle'))return;if(this.enabled()&&!this.soundReady())void this.enableAudio();}
  private async enableAudio(){
    try{const Audio=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!Audio)return;this.audio??=new Audio();await this.audio.resume();this.soundReady.set(this.audio.state==='running');}catch{this.soundReady.set(false);}
  }
  async toggleSound(){if(this.enabled()&&this.soundReady()){this.enabled.set(false);return;}this.enabled.set(true);await this.enableAudio();this.beep();}
  private beep(){
    if(!this.enabled()||!this.audio||this.audio.state!=='running'||Date.now()-this.lastSound<1000)return;
    this.lastSound=Date.now();const oscillator=this.audio.createOscillator();const gain=this.audio.createGain();oscillator.connect(gain);gain.connect(this.audio.destination);oscillator.frequency.setValueAtTime(740,this.audio.currentTime);oscillator.frequency.setValueAtTime(980,this.audio.currentTime+.12);gain.gain.setValueAtTime(.0001,this.audio.currentTime);gain.gain.exponentialRampToValueAtTime(.12,this.audio.currentTime+.02);gain.gain.exponentialRampToValueAtTime(.0001,this.audio.currentTime+.28);oscillator.start();oscillator.stop(this.audio.currentTime+.3);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  }
  dismiss(id:number){this.notices.update(items=>items.filter(n=>n.message.id!==id));clearTimeout(this.noticeTimers.get(id));this.noticeTimers.delete(id);if(!this.notices().length)this.noticeLayer?.nativeElement.hidePopover?.();}
  async open(event:Event,notice:Notice){event.preventDefault();this.dismiss(notice.message.id);await this.router.navigate(['/admin'],{queryParams:{chat:notice.chat.id}});this.chats.open(notice.chat,true);}
  ngOnDestroy(){this.destroyed=true;clearTimeout(this.timer);clearTimeout(this.watchdog);for(const timer of this.noticeTimers.values())clearTimeout(timer);this.socket?.close();void this.audio?.close();window.removeEventListener('online',this.resume);document.removeEventListener('visibilitychange',this.resume);}
}
