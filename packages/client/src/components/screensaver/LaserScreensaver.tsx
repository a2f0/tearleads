import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getChartColors } from '@/components/duration-chart/constants';
import { zIndex } from '@/constants/zIndex';
import { useScreensaver } from './ScreensaverContext';

interface LaserBeam {
  x: number;
  y: number;
  dx: number;
  dy: number;
  color: string;
  trail: Array<{ x: number; y: number }>;
}

const BEAM_COUNT = 6;
const TRAIL_LENGTH = 100;
const MIN_SPEED = 3;
const MAX_SPEED = 6;
const MOUSE_MOVE_THRESHOLD = 3;

function initializeBeams(
  width: number,
  height: number,
  colors: string[]
): LaserBeam[] {
  const fallbackColors = ['#808080'];
  const safeColors = colors.length > 0 ? colors : fallbackColors;
  return Array.from({ length: BEAM_COUNT }, (_, i) => {
    const colorIndex = i % safeColors.length;
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      dx:
        (Math.random() - 0.5) *
        2 *
        (MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED)),
      dy:
        (Math.random() - 0.5) *
        2 *
        (MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED)),
      color: safeColors[colorIndex] ?? '#808080',
      trail: []
    };
  });
}

export function LaserScreensaver() {
  const { isActive, deactivate } = useScreensaver();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const beamsRef = useRef<LaserBeam[]>([]);

  // Dismissal handlers
  useEffect(() => {
    if (!isActive) return;

    const dismiss = () => deactivate();

    const handleMouseMove = (e: MouseEvent) => {
      if (
        Math.abs(e.movementX) > MOUSE_MOVE_THRESHOLD ||
        Math.abs(e.movementY) > MOUSE_MOVE_THRESHOLD
      ) {
        dismiss();
      }
    };

    document.addEventListener('keydown', dismiss);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('touchstart', dismiss);

    return () => {
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('touchstart', dismiss);
    };
  }, [isActive, deactivate]);

  // Animation loop
  useEffect(() => {
    if (!isActive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initialize beams with theme colors
    const colors = getChartColors();

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // Reinitialize beams on resize to ensure proper distribution
      beamsRef.current = initializeBeams(canvas.width, canvas.height, colors);
    };
    resize();
    window.addEventListener('resize', resize);

    const animate = () => {
      // Semi-transparent black fill for trail fade effect
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      beamsRef.current.forEach((beam) => {
        // Update position
        beam.x += beam.dx;
        beam.y += beam.dy;

        // Bounce off edges
        if (beam.x <= 0 || beam.x >= canvas.width) {
          beam.dx *= -1;
          beam.x = Math.max(0, Math.min(canvas.width, beam.x));
        }
        if (beam.y <= 0 || beam.y >= canvas.height) {
          beam.dy *= -1;
          beam.y = Math.max(0, Math.min(canvas.height, beam.y));
        }

        // Add current position to trail
        beam.trail.push({ x: beam.x, y: beam.y });

        // Limit trail length
        if (beam.trail.length > TRAIL_LENGTH) {
          beam.trail.shift();
        }

        // Draw trail
        if (beam.trail.length > 1) {
          ctx.strokeStyle = beam.color;
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          for (let i = 0; i < beam.trail.length - 1; i++) {
            const p1 = beam.trail[i];
            const p2 = beam.trail[i + 1];
            if (!p1 || !p2) continue;
            ctx.globalAlpha = (i + 1) / beam.trail.length;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener('resize', resize);
    };
  }, [isActive]);

  if (!isActive) return null;

  return createPortal(
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'black',
        zIndex: zIndex.screensaver,
        cursor: 'none'
      }}
    />,
    document.body
  );
}
