import { Component, computed, effect, input, output, signal } from '@angular/core';

@Component({
  selector:'app-size-picker',
  host:{'(focusout)':'leave($event)'},
  template:`<label for="product-size">Размеры</label>
    <div class="size-input"><input id="product-size" role="combobox" autocomplete="off" maxlength="100" [value]="filter()" [disabled]="disabled()" [attr.aria-expanded]="open()" aria-controls="size-options" aria-autocomplete="list" [attr.aria-activedescendant]="open() && options().length ? 'size-option-'+active() : null" (input)="type($event)" (focus)="show()" (keydown)="key($event)">
    <button type="button" [disabled]="disabled()" aria-label="Показать размеры" [attr.aria-expanded]="open()" (click)="open() ? open.set(false) : show()">⌄</button></div>
    @if(open()) { <div class="size-options" id="size-options" role="listbox" aria-label="Размеры">
      @for(option of options();track option.name;let i=$index){<button type="button" role="option" [id]="'size-option-'+i" [attr.aria-selected]="active()===i" [class.active]="active()===i" (pointerdown)="$event.preventDefault()" (click)="choose(option.name)">{{option.create?'Добавить «'+option.name+'»':option.name}}{{option.create?'':''}}</button>}
      @if(!options().length){<p>Введите название нового размера</p>}
    </div> }
    <div class="selected-sizes">@for(size of value();track size){<button type="button" [disabled]="disabled()" (click)="remove(size)" [attr.aria-label]="'Убрать размер '+size">{{size}} ×</button>}</div>
    <small>Выберите несколько размеров или добавьте новый из введённого текста. Новый размер появится в списке после сохранения товара.</small>`,
  styles:`:host{display:block;position:relative;min-width:0;margin-bottom:20px;font-size:13px}label{display:block;margin-bottom:8px}.size-input{display:flex;border:1px solid #c9cdbf;background:#fff}.size-input input{width:100%;min-width:0;border:0;padding:12px;background:transparent;font:inherit;color:var(--ink)}button{font:inherit;color:var(--ink);cursor:pointer}.size-input button{border:0;background:none;padding:0 14px}.size-options{position:absolute;top:69px;left:0;right:0;z-index:10;max-height:240px;overflow-y:auto;overscroll-behavior:contain;border:1px solid var(--line);background:var(--paper,#f8f7f3);box-shadow:0 8px 20px #0001}.size-options button{display:block;width:100%;border:0;background:none;padding:12px;text-align:left;overflow-wrap:anywhere}.size-options button:hover,.size-options button.active{background:#e8e7e0}.size-options p{padding:12px}.selected-sizes{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.selected-sizes button{padding:6px 10px;border:1px solid var(--line);background:#e8e7e0;overflow-wrap:anywhere;max-width:100%}small{display:block;color:var(--muted);line-height:1.5;margin-top:7px}input:focus-visible,button:focus-visible{outline:2px solid var(--ink);outline-offset:-2px}`,
})
export class SizePicker {
  readonly value=input<string[]>([]);
  readonly sizes=input<string[]>([]);
  readonly disabled=input(false);
  readonly valueChange=output<string[]>();
  readonly open=signal(false);
  readonly filter=signal('');
  readonly active=signal(0);
  readonly options=computed(()=>{
    const text=this.filter().trim();
    const found=this.sizes().filter(b=>!this.value().some(v=>v.toLowerCase()===b.toLowerCase()) && b.toLowerCase().includes(text.toLowerCase())).map(name=>({name,create:false}));
    if(text && !this.value().some(v=>v.toLowerCase()===text.toLowerCase()) && !this.sizes().some(b=>b.toLowerCase()===text.toLowerCase())) found.push({name:text,create:true});
    return found;
  });
  constructor(){effect(()=>{if(this.disabled())this.open.set(false);});}
  show(){this.filter.set('');this.active.set(0);this.open.set(true);}
  type(event:Event){const text=(event.target as HTMLInputElement).value;this.filter.set(text);this.active.set(0);this.open.set(true);}
  choose(name:string){this.valueChange.emit([...this.value(),name]);this.filter.set('');this.active.set(0);this.open.set(false);}
  remove(name:string){this.valueChange.emit(this.value().filter(b=>b!==name));}
  leave(event:FocusEvent){if(!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node|null))this.open.set(false);}
  key(event:KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();this.open.set(false);}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!this.open()){this.show();return;}const count=this.options().length;this.active.set(count?(this.active()+(event.key==='ArrowDown'?1:-1)+count)%count:0);document.getElementById('size-option-'+this.active())?.scrollIntoView({block:'nearest'});}
    if(event.key==='Enter'&&this.open()){event.preventDefault();const option=this.options()[this.active()];if(option)this.choose(option.name);}
  }
}
