export class Anomalies {
  active = null;
  last = Date.now();
  input = Date.now();
  constructor(editor, monaco, canvas, enabled, notice) {
    Object.assign(this, { editor, monaco, canvas, enabled, notice });
    this.motion = matchMedia("(prefers-reduced-motion: reduce)");
    editor.onDidChangeModelContent(() => {
      this.input = Date.now();
      this.end();
    });
    editor.onDidChangeCursorPosition(() => {
      this.input = Date.now();
    });
    editor.onDidScrollChange(() => this.end());
    editor.onDidLayoutChange(() => this.end());
    editor.onDidChangeModel(() => this.end());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.end();
    });
    this.motion.addEventListener("change", () => this.end());
    setInterval(() => {
      if (
        this.enabled() &&
        !document.hidden &&
        Date.now() - this.last > 75000 &&
        Date.now() - this.input > 5000 &&
        Math.random() > 0.6
      )
        this.trigger();
    }, 7000);
  }
  end() {
    if (!this.active) return;
    cancelAnimationFrame(this.active.frame);
    this.active.decorations.clear();
    this.active = null;
    this.canvas
      .getContext("2d")
      .clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  trigger() {
    const { editor, monaco, canvas } = this;
    if (!this.enabled() || this.active) return;
    if (this.motion.matches) {
      this.notice(
        "Аномалия замечена. Анимация отключена настройкой уменьшения движения.",
      );
      return;
    }
    const model = editor.getModel(),
      visible = editor.getVisibleRanges()[0];
    if (!model || !visible) return;
    const lines = [];
    for (let n = visible.startLineNumber; n <= visible.endLineNumber; n++)
      if (model.getLineContent(n).trim().length > 5) lines.push(n);
    const cursor = editor.getPosition().lineNumber,
      line = lines.includes(cursor)
        ? cursor
        : lines[Math.floor(Math.random() * lines.length)];
    if (!line) return;
    const content = model.getLineContent(line),
      start = editor.getScrolledVisiblePosition({
        lineNumber: line,
        column: 1,
      });
    if (!start) return;
    const box = canvas.getBoundingClientRect(),
      dpr = devicePixelRatio || 1;
    if (!box.width || !box.height) return;
    canvas.width = box.width * dpr;
    canvas.height = box.height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const font = editor.getOption(monaco.editor.EditorOption.fontInfo);
    const letters = [...content]
      .map((char, index) => {
        const p = editor.getScrolledVisiblePosition({
          lineNumber: line,
          column: index + 1,
        });
        return {
          char,
          x:
            p?.left ?? start.left + index * font.typicalHalfwidthCharacterWidth,
          y: start.top + font.fontSize + 2,
          dx: (Math.random() - 0.45) * 95,
          dy: 45 + Math.random() * 190,
          rot: (Math.random() - 0.5) * 4,
        };
      })
      .filter((c) => c.x >= 0 && c.x < box.width - 25);
    const decorations = editor.createDecorationsCollection([
      {
        range: new monaco.Range(line, 1, line, content.length + 1),
        options: { inlineClassName: "haunted-glyph" },
      },
    ]);
    this.active = { frame: 0, decorations };
    this.last = Date.now();
    const begun = performance.now(),
      left = Math.max(start.left - 55, 50),
      right = Math.min(
        box.width - 55,
        Math.max(left + 250, letters.at(-1)?.x + 60 || 500),
      );
    const draw = (now) => {
      if (!this.active) return;
      const t = (now - begun) / 1000,
        x = left + (right - left) * Math.min(t / 1.35, 1),
        y = start.top + 12;
      ctx.clearRect(0, 0, box.width, box.height);
      ctx.font = `${font.fontSize}px ${font.fontFamily}`;
      for (const letter of letters) {
        const age = Math.max(
          0,
          t - ((letter.x - left) / (right - left)) * 1.35,
        );
        ctx.save();
        if (age > 0) {
          ctx.globalAlpha = Math.max(0, 1 - age / 1.5);
          ctx.translate(
            letter.x + letter.dx * age,
            letter.y + letter.dy * age * age,
          );
          ctx.rotate(letter.rot * age);
          ctx.fillStyle = "#c9b68e";
        } else {
          ctx.translate(letter.x, letter.y);
          ctx.fillStyle = "#bbc6ae";
        }
        ctx.fillText(letter.char, 0, 0);
        ctx.restore();
      }
      if (t < 1.55) {
        ctx.save();
        ctx.translate(x, y + Math.sin(t * 93) * 1.7);
        ctx.globalAlpha = t > 1.35 ? Math.max(0, 1 - (t - 1.35) * 5) : 1;
        ctx.shadowColor = "#000";
        ctx.shadowBlur = 12;
        ctx.fillStyle = "#030604";
        ctx.strokeStyle = "#66734d";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(-10, -25);
        ctx.lineTo(-17, -36);
        ctx.lineTo(-5, -30);
        ctx.lineTo(3, -39);
        ctx.lineTo(10, -28);
        ctx.lineTo(17, -17);
        ctx.lineTo(10, -5);
        ctx.lineTo(21, 3);
        ctx.lineTo(39, -3);
        ctx.lineTo(27, 10);
        ctx.lineTo(9, 8);
        ctx.lineTo(3, 17);
        ctx.lineTo(-9, 29);
        ctx.lineTo(-4, 11);
        ctx.lineTo(-17, 5);
        ctx.lineTo(-36, 16);
        ctx.lineTo(-24, 0);
        ctx.lineTo(-14, -6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.shadowColor = "#e0dbb2";
        ctx.shadowBlur = 8;
        ctx.fillStyle = "#ded9b4";
        ctx.fillRect(-6, -22, 3, 2);
        ctx.fillRect(3, -23, 3, 2);
        ctx.restore();
      }
      if (t >= 2.8) {
        this.end();
        return;
      }
      this.active.frame = requestAnimationFrame(draw);
    };
    this.active.frame = requestAnimationFrame(draw);
  }
}
