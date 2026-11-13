interface Point {
  x: number;
  y: number;
}

interface Beam extends Point {
  dx: number;
  dy: number;
  color: string;
  trail: Point[];
}

const SHADES = [
  "#ffffff",
  "#dddddd",
  "#bbbbbb",
  "#999999",
  "#888888",
  "#777777",
];
const TRAIL_LENGTH = 100;

function createBeams(width: number, height: number): Beam[] {
  return SHADES.map((color) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 3;
    const x = Math.random() * width;
    const y = Math.random() * height;
    return {
      x,
      y,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      color,
      trail: [{ x, y }],
    };
  });
}

function advance(beam: Beam, width: number, height: number, step: number) {
  beam.x += beam.dx * step;
  beam.y += beam.dy * step;
  if (beam.x <= 0 || beam.x >= width) {
    beam.dx *= -1;
    beam.x = Math.max(0, Math.min(width, beam.x));
  }
  if (beam.y <= 0 || beam.y >= height) {
    beam.dy *= -1;
    beam.y = Math.max(0, Math.min(height, beam.y));
  }
  beam.trail.push({ x: beam.x, y: beam.y });
  if (beam.trail.length > TRAIL_LENGTH) beam.trail.shift();
}

function draw(context: CanvasRenderingContext2D, beams: Beam[]) {
  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const beam of beams) {
    context.strokeStyle = beam.color;
    for (let index = 1; index < beam.trail.length; index += 1) {
      const from = beam.trail[index - 1];
      const to = beam.trail[index];
      if (!from || !to) continue;
      context.globalAlpha = index / beam.trail.length;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

/** Owns only the artwork; windowing owns activation, input, and focus. */
export function startLaserAnimation(canvas: HTMLCanvasElement): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  let width = 0;
  let height = 0;
  let beams: Beam[] = [];
  let frame = 0;
  let previous: number | null = null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.fillStyle = "#000000";
    context.fillRect(0, 0, width, height);
    beams = createBeams(width, height);
    if (reducedMotion.matches) {
      for (let index = 0; index < TRAIL_LENGTH; index += 1) {
        for (const beam of beams) advance(beam, width, height, 1);
      }
      draw(context, beams);
    }
  };
  const animate = (timestamp: number) => {
    // Keep motion independent of refresh rate without leaping after a hidden tab.
    const step =
      previous === null ? 1 : Math.min((timestamp - previous) / (1000 / 60), 2);
    previous = timestamp;
    context.fillStyle = "rgba(0, 0, 0, 0.05)";
    context.fillRect(0, 0, width, height);
    for (const beam of beams) advance(beam, width, height, step);
    draw(context, beams);
    frame = window.requestAnimationFrame(animate);
  };

  const restart = () => {
    window.cancelAnimationFrame(frame);
    previous = null;
    resize();
    if (!reducedMotion.matches) animate(performance.now());
  };
  restart();
  window.addEventListener("resize", resize);
  reducedMotion.addEventListener("change", restart);
  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    reducedMotion.removeEventListener("change", restart);
  };
}
