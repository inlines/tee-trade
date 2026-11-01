import { Injectable, signal } from '@angular/core';

@Injectable({providedIn:'root'})
export class NotificationSound {
  readonly enabled = signal(true);
  readonly ready = signal(false);
  private readonly audio = new Audio('/audio/message.wav');
  private priming = false;
  private pending = false;
  private lastPlayed = 0;
  constructor() {
    try { this.enabled.set(localStorage.getItem('chat-sound') !== 'off'); } catch {}
    this.audio.preload = 'auto';
    // A completed tap/click also activates media on touch browsers. This service
    // is created before login, so the sign-in gesture can unlock the same player.
    const unlock = (event:Event) => {
      if ((event.target as Element)?.closest?.('.sound-toggle, .sound-test')) return;
      if (this.enabled() && !this.ready() && !this.priming) void this.prime();
    };
    document.addEventListener('click', unlock);
    document.addEventListener('touchend', unlock, {passive:true});
    document.addEventListener('keydown', unlock);
  }
  private async prime() {
    this.priming = true;
    this.audio.muted = true;
    try {
      await this.audio.play();
      this.audio.pause();
      this.audio.currentTime = 0;
      this.ready.set(true);
    } catch { this.ready.set(false); }
    finally {
      this.audio.muted = false; this.priming = false;
      if (this.pending) { this.pending = false; void this.play(true); }
    }
  }
  async play(test = false) {
    if (!this.enabled()) return;
    if (this.priming) { this.pending = true; return; }
    if (!test && Date.now()-this.lastPlayed < 1000) return;
    this.audio.muted = false;
    this.audio.volume = 1;
    this.audio.currentTime = 0;
    try { await this.audio.play(); this.ready.set(true); this.lastPlayed = Date.now(); }
    catch { this.ready.set(false); }
  }
  async toggle() {
    if (this.enabled() && this.ready()) this.enabled.set(false);
    else { this.enabled.set(true); await this.play(true); }
    try { localStorage.setItem('chat-sound', this.enabled() ? 'on' : 'off'); } catch {}
  }
}
