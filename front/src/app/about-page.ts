import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-about', imports: [RouterLink],
  template: `<section class="page-intro"><p class="eyebrow"><a routerLink="/">ГЛАВНАЯ</a> / О НАС</p><h1>Вещи с характером.<br><span class="muted">Люди со своим стилем.</span></h1></section>
    <section class="about-layout"><div class="about-mark" aria-hidden="true"><img src="/images/futba-logo.svg" alt="" width="348" height="64"><span>ВЫБИРАЙ СВОЁ.</span></div><div class="about-copy"><p class="eyebrow">О ПРОЕКТЕ</p><h2>Гардероб начинается<br>с любопытства.</h2><p>FUTBA — каталог футболок, кроссовок, аксессуаров и головных уборов. Место, где можно спокойно рассмотреть вещь и найти то, что подходит именно тебе.</p><p>Мы строим каталог вокруг деталей: у каждой позиции есть бренд, год выпуска, тематика и описание. Несколько ракурсов и отдельное фото ярлычка помогают узнать вещь ближе.</p><a class="button dark" routerLink="/catalog">Найти свою вещь</a></div></section>
    <section class="about-principles"><article><p class="eyebrow">01 / ВЫБОР</p><h3>Не только футболки</h3><p>Четыре категории, которые легко собрать в собственный образ.</p></article><article><p class="eyebrow">02 / КОНТЕКСТ</p><h3>Больше, чем название</h3><p>Бренд, год и тематика помогают понять характер каждой вещи.</p></article><article><p class="eyebrow">03 / ДЕТАЛИ</p><h3>Рассмотреть поближе</h3><p>Основной вид, детали и ярлычок — в одной галерее.</p></article></section>`,
})
export class AboutPage {}
