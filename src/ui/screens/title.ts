import type { UiContext } from '../context';
import { el, stagger, txt } from '../dom';
import { wordmark } from '../graphics';
import { Screen } from '../screen';

/** Title: wordmark over the live scene and PRESS ANY KEY. `onContinue` fires exactly once. */
export class TitleScreen extends Screen {
  private fired = false;
  private readonly prompt: HTMLElement;

  constructor(
    ctx: UiContext,
    private readonly onContinue: () => void,
  ) {
    super(ctx, 'title', { scrim: 'title' });
    this.prompt = el('div', 's1-title__prompt', [
      el('span', 's1-title__pip'),
      txt('span', 's1-title__press', 'Press any key'),
    ]);
    const block = el('div', 's1-title__block', [
      stagger(el('div', 's1-title__logo', [wordmark('s1-wordmark')]), 0),
      stagger(el('div', 's1-title__rule'), 2),
      stagger(this.prompt, 3),
    ]);
    const build = stagger(txt('div', 's1-title__build s1-code', `BUILD ${ctx.build}`), 4);
    const marks = ['tl', 'tr', 'bl', 'br'].map((c) => el('span', `s1-reg s1-reg--${c}`));
    this.frame.append(block, build, ...marks);
    this.el.setAttribute('aria-label', 'SPLASH ONE. Press any key.');
    this.listen(this.el, 'click', () => this.anyInput());
  }

  override anyInput(): boolean {
    if (this.fired) return true;
    this.fired = true;
    this.el.classList.add('is-go');
    this.ctx.sound('uiConfirm');
    this.onContinue();
    return true;
  }
}
