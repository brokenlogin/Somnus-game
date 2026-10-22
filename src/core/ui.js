// DOM overlay helpers: prompts, inner thoughts, fades, flashes, title cards.
const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.prompt = $('prompt');
    this.thoughtEl = $('thought');
    this.keyIcon = $('keyicon');
    this.fadeEl = $('fade');
    this.flashEl = $('flash');
    this.title = $('titlecard');
    this.fadeValue = 1;
    this.fadeTarget = 1;
    this.fadeSpeed = 1;
    this.flashValue = 0;
    this.thoughtTimer = 0;
    this.thoughtQueue = [];
  }

  setPrompt(text) {
    if (text) {
      this.prompt.textContent = text;
      this.prompt.classList.add('on');
    } else {
      this.prompt.classList.remove('on');
    }
  }

  // Inner monologue line. Queued so lines never overlap.
  think(text, seconds = 4) {
    this.thoughtQueue.push({ text, seconds });
  }

  clearThoughts() {
    this.thoughtQueue.length = 0;
    this.thoughtTimer = 0;
    this.thoughtEl.classList.remove('on');
  }

  setKey(on) { this.keyIcon.classList.toggle('on', on); }

  // Fade to black (1) or clear (0) over `seconds`.
  fadeTo(target, seconds = 1) {
    this.fadeTarget = target;
    this.fadeSpeed = seconds <= 0 ? Infinity : Math.abs(target - this.fadeValue) / seconds;
    if (seconds <= 0) this.fadeValue = target;
    return new Promise((res) => setTimeout(res, Math.max(0, seconds) * 1000));
  }

  flash(amount = 1) { this.flashValue = Math.max(this.flashValue, amount); }

  async showTitle(num, name, seconds = 3.2) {
    this.title.querySelector('.num').textContent = num;
    this.title.querySelector('.name').textContent = name;
    this.title.classList.add('on');
    await new Promise((r) => setTimeout(r, seconds * 1000));
    this.title.classList.remove('on');
  }

  update(dt) {
    if (this.fadeValue !== this.fadeTarget) {
      const step = this.fadeSpeed * dt;
      const d = this.fadeTarget - this.fadeValue;
      this.fadeValue = Math.abs(d) <= step ? this.fadeTarget : this.fadeValue + Math.sign(d) * step;
    }
    this.fadeEl.style.opacity = this.fadeValue.toFixed(3);

    this.flashValue = Math.max(0, this.flashValue - dt * 2.5);
    this.flashEl.style.opacity = this.flashValue.toFixed(3);

    if (this.thoughtTimer > 0) {
      this.thoughtTimer -= dt;
      if (this.thoughtTimer <= 1.2) this.thoughtEl.classList.remove('on');
    } else if (this.thoughtQueue.length) {
      const t = this.thoughtQueue.shift();
      this.thoughtEl.textContent = t.text;
      this.thoughtEl.classList.add('on');
      this.thoughtTimer = t.seconds + 1.2;
    }
  }
}
