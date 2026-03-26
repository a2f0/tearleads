import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./Window.css";
import { WindowBody } from "./WindowBody";
import { WindowTitleBar } from "./WindowTitleBar";

interface WindowProps {
  title: string;
  initialX: number;
  initialY: number;
  onClose: () => void;
}

export function Window({
  title,
  initialX,
  initialY,
  onClose,
  children,
}: PropsWithChildren<WindowProps>) {
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const dragging = useRef<{ offsetX: number; offsetY: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = {
        offsetX: e.clientX - position.x,
        offsetY: e.clientY - position.y,
      };
    },
    [position],
  );

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      setPosition({
        x: e.clientX - dragging.current.offsetX,
        y: e.clientY - dragging.current.offsetY,
      });
    }
    function handleMouseUp() {
      dragging.current = null;
    }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <div className="window" style={{ left: position.x, top: position.y }}>
      <WindowTitleBar
        title={title}
        onMouseDown={handleMouseDown}
        onClose={onClose}
      />
      <WindowBody>{children}</WindowBody>
    </div>
  );
}
