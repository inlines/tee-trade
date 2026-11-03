import { ChatToasts } from './chat-toasts';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject, input } from '@angular/core';
import { ChatService } from './chat.service';
import { ChatList } from './chat-list';
import { NotificationSound } from './notification-sound.service';
@Component({selector:'app-chat-sidebar',imports:[ChatList,ChatToasts],template:`
<dialog #panel aria-labelledby="sidebar-title" (cancel)="close($event)" (click)="backdrop($event)">
  <header><div><p>СООБЩЕНИЯ</p><h2 id="sidebar-title">Ваши чаты</h2></div><button class="close" aria-label="Закрыть панель чатов" (click)="close()">×</button></header>
  <div class="sound-controls"><button class="sound-toggle" (click)="sound.toggle()" [attr.aria-pressed]="sound.ready() && sound.enabled()">{{sound.enabled() && sound.ready()?'Звук включён':'Включить звук'}}</button>@if(sound.enabled() && sound.ready()){<button class="sound-test" (click)="sound.play(true)">Проверить звук</button>}</div>
  <div class="chat-scroll"><app-chat-list [admin]="admin()" /></div>
<app-chat-toasts /></dialog>`,styles:[`
:host{display:contents}dialog{position:fixed;inset:0 0 0 auto;margin:0;width:min(440px,100%);max-width:100%;height:100dvh;max-height:100dvh;border:0;border-left:1px solid var(--line);padding:0;background:var(--paper);color:var(--ink);overflow:hidden}dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#20251f66}header{display:flex;justify-content:space-between;align-items:center;padding:26px 24px;border-bottom:1px solid var(--line)}header p{font-size:10px;letter-spacing:.16em;color:var(--muted)}h2{font-size:28px;margin-top:8px}.close{border:0;background:none;font-size:32px;width:44px;height:44px;color:var(--ink)}.chat-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 24px}.sound-controls{display:flex;gap:12px;flex-wrap:wrap;padding:16px 24px 0}.sound-controls button{background:none;border:1px solid var(--line);padding:10px;color:var(--ink);font-size:12px}header,.sound-controls{flex-shrink:0}@media(max-width:700px){dialog{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}header{padding:18px}.chat-scroll{padding:0 16px}}
`]})
export class ChatSidebar implements AfterViewInit,OnDestroy {
  readonly admin=input(false);readonly api=inject(ChatService);readonly sound=inject(NotificationSound);
  @ViewChild('panel') panel!:ElementRef<HTMLDialogElement>;
  private body='';private overflow='';private y=0;
  ngAfterViewInit(){this.body=document.body.style.cssText;this.overflow=document.documentElement.style.overflow;this.y=window.scrollY;document.body.style.position='fixed';document.body.style.top=-this.y+'px';document.body.style.width='100%';document.documentElement.style.overflow='hidden';this.panel.nativeElement.showModal();void this.api.refresh(this.admin());}
  close(event?:Event){event?.preventDefault();this.api.drawer.set(false);}
  backdrop(event:MouseEvent){if(event.target===this.panel.nativeElement){const r=this.panel.nativeElement.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right)this.close();}}
  ngOnDestroy(){this.panel.nativeElement.close();document.body.style.cssText=this.body;document.documentElement.style.overflow=this.overflow;window.scrollTo(0,this.y);}
}
