import { useCallback, useEffect, useRef, useState } from "react";
import { getWhiteboard, saveWhiteboardState } from "../api";
import { useSocket } from "../context/SocketContext";
import {
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  id: string;
  type: "pen" | "rect" | "circle";
  color: string;
  width: number;
  points: Point[];
  start?: Point;
  end?: Point;
}

interface WhiteboardProps {
  chatId?: string;
  onClose?: () => void;
}

type Tool = "pen" | "eraser" | "rect" | "circle";

const COLORS = ["#1a1a2e", "#e94560", "#0f3460", "#16213e", "#533483", "#ffffff"];
const WIDTHS = [2, 4, 8, 16];

// Module-level write-through cache so strokes survive unmount/remount.
// When a user closes and reopens the whiteboard, strokes load instantly
// from this cache instead of waiting for the async API save to complete.
const strokeCache = new Map<string, Stroke[]>();

const Whiteboard: React.FC<WhiteboardProps> = ({ chatId, onClose }) => {
  const { socket } = useSocket();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState("#1a1a2e");
  const [width, setWidth] = useState(4);
  const [tool, setTool] = useState<Tool>("pen");
  const [isDrawing, setIsDrawing] = useState(false);
  const [loading, setLoading] = useState(true);

  const currentStrokeRef = useRef<Stroke | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatIdRef = useRef(chatId);
  const emittedIdsRef = useRef<Set<string>>(new Set());

  // Keep refs in sync
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);

  const genId = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // Flush any pending debounced save immediately (used on unmount)
  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const cid = chatIdRef.current;
    const data = strokesRef.current;
    if (cid) {
      strokeCache.set(cid, data);
      void saveWhiteboardState(cid, { elements: data, appState: null });
    }
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    redraw();
  }, []);

  const drawStroke = (ctx: CanvasRenderingContext2D, s: Stroke) => {
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (s.type === "pen") {
      if (s.points.length === 1) {
        const p = s.points[0];
        ctx.arc(p.x, p.y, s.width / 2, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
      } else if (s.points.length > 1) {
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i].x, s.points[i].y);
        }
        ctx.stroke();
      }
    } else if (s.type === "rect" && s.start && s.end) {
      const x = Math.min(s.start.x, s.end.x);
      const y = Math.min(s.start.y, s.end.y);
      const w = Math.abs(s.end.x - s.start.x);
      const h = Math.abs(s.end.y - s.start.y);
      ctx.strokeRect(x, y, w, h);
    } else if (s.type === "circle" && s.start && s.end) {
      const cx = (s.start.x + s.end.x) / 2;
      const cy = (s.start.y + s.end.y) / 2;
      const rx = Math.abs(s.end.x - s.start.x) / 2;
      const ry = Math.abs(s.end.y - s.start.y) / 2;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    for (const s of strokesRef.current) {
      drawStroke(ctx, s);
    }

    if (currentStrokeRef.current) {
      drawStroke(ctx, currentStrokeRef.current);
    }
  }, []);

  const getCanvasPos = useCallback(
    (e: React.MouseEvent | React.TouchEvent): Point | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const clientX =
        "touches" in e ? e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX : e.clientX;
      const clientY =
        "touches" in e ? e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const pos = getCanvasPos(e);
      if (!pos) return;

      setIsDrawing(true);
      const activeColor = tool === "eraser" ? "#FFF8E1" : color;
      const activeWidth = tool === "eraser" ? width * 5 : width;

      if (tool === "pen" || tool === "eraser") {
        currentStrokeRef.current = {
          id: genId(), type: "pen", color: activeColor, width: activeWidth, points: [pos],
        };
      } else if (tool === "rect") {
        currentStrokeRef.current = {
          id: genId(), type: "rect", color, width, points: [], start: pos, end: pos,
        };
      } else if (tool === "circle") {
        currentStrokeRef.current = {
          id: genId(), type: "circle", color, width, points: [], start: pos, end: pos,
        };
      }
      redraw();
    },
    [color, width, tool, getCanvasPos, redraw],
  );

  const handlePointerMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing || !currentStrokeRef.current) return;
      e.preventDefault();
      const pos = getCanvasPos(e);
      if (!pos) return;

      const cur = currentStrokeRef.current;
      if (cur.type === "pen") {
        cur.points.push(pos);
      } else {
        cur.end = pos;
      }
      redraw();
    },
    [isDrawing, getCanvasPos, redraw],
  );

  const handlePointerUp = useCallback(() => {
    if (!isDrawing || !currentStrokeRef.current) return;
    setIsDrawing(false);

    const finished = currentStrokeRef.current;
    currentStrokeRef.current = null;

    if (
      (finished.type === "rect" || finished.type === "circle") &&
      finished.start && finished.end
    ) {
      const dx = Math.abs(finished.end.x - finished.start.x);
      const dy = Math.abs(finished.end.y - finished.start.y);
      if (dx < 2 && dy < 2) return;
    }
    if (finished.type === "pen" && finished.points.length === 0) return;

    const newStrokes = [...strokesRef.current, finished];
    setStrokes(newStrokes);
    if (chatId) strokeCache.set(chatId, newStrokes);

    // Track this ID so we ignore our own echo
    emittedIdsRef.current.add(finished.id);

    if (socket && chatId) {
      socket.emit("whiteboardStroke", { chatId, stroke: finished });
    }

    // Debounced save
    if (chatId) {
      strokeCache.set(chatId, newStrokes);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          await saveWhiteboardState(chatId, { elements: newStrokes, appState: null });
        } catch { /* best-effort */ }
      }, 1200);
    }
    redraw();
  }, [isDrawing, socket, chatId, redraw]);

  const clearBoard = useCallback(() => {
    setStrokes([]);
    if (chatId) strokeCache.set(chatId, []);
    redraw();
    if (socket && chatId) {
      socket.emit("whiteboardClear", chatId);
    }
    if (chatId) {
      void saveWhiteboardState(chatId, { elements: [], appState: null });
    }
  }, [socket, chatId, redraw]);

  // Load persisted board — cache first (instant), then API (background).
  useEffect(() => {
    if (!chatId) return;
    let active = true;

    // 1. Instant load from module-level cache
    const cached = strokeCache.get(chatId);
    if (cached) {
      setStrokes(cached);
      setLoading(false);
      setTimeout(() => resizeCanvas(), 50);
    } else {
      setLoading(true);
    }

    // 2. Fetch from API (overwrites cache if data exists)
    getWhiteboard(chatId)
      .then((res) => {
        if (!active) return;
        const wb = res.data?.data?.whiteboard;
        const loaded = Array.isArray(wb?.elements) ? (wb.elements as Stroke[]) : [];
        if (loaded.length > 0) {
          strokeCache.set(chatId, loaded);
          setStrokes(loaded);
        } else if (!cached) {
          setStrokes([]);
        }
        setLoading(false);
        setTimeout(() => resizeCanvas(), 50);
      })
      .catch(() => {
        if (!active) return;
        if (!cached) setStrokes([]);
        setLoading(false);
      });

    return () => { active = false; };
  }, [chatId, resizeCanvas]);

  // Socket: join room, receive strokes and clear from peers
  useEffect(() => {
    if (!socket || !chatId) return;
    socket.emit("joinChat", chatId);

    const onStroke = (data: { stroke: Stroke }) => {
      if (!data?.stroke) return;
      // Skip our own echoes
      if (emittedIdsRef.current.has(data.stroke.id)) {
        emittedIdsRef.current.delete(data.stroke.id);
        return;
      }
      const updated = [...strokesRef.current, data.stroke];
      setStrokes(updated);
      const cid = chatIdRef.current;
      if (cid) {
        strokeCache.set(cid, updated);
        void saveWhiteboardState(cid, {
          elements: updated,
          appState: null,
        });
      }
    };

    const onClear = () => {
      setStrokes([]);
      const cid = chatIdRef.current;
      if (cid) strokeCache.set(cid, []);
    };

    socket.on("whiteboardStroke", onStroke);
    socket.on("whiteboardClear", onClear);

    return () => {
      socket.off("whiteboardStroke", onStroke);
      socket.off("whiteboardClear", onClear);
    };
  }, [socket, chatId]);

  // Resize observer
  useEffect(() => {
    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [resizeCanvas]);

  useEffect(() => { redraw(); }, [strokes, redraw]);

  // Flush pending save on unmount so strokes aren't lost
  useEffect(() => {
    return () => { flushSave(); };
  }, [flushSave]);

  // Dynamic circle cursor for eraser — shows the brush size as a ring
  const eraserCursor = (() => {
    const size = width * 5;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${size / 2}' cy='${size / 2}' r='${size / 2 - 1}' fill='none' stroke='%23555' stroke-width='1.5' stroke-dasharray='3 2'/></svg>`;
    return `url("data:image/svg+xml,${svg}") ${size / 2} ${size / 2}, crosshair`;
  })();

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-paper">
      {/* Toolbar */}
      {onClose && (
        <div className="flex flex-shrink-0 items-center justify-between border-b-4 border-ink bg-cream p-2">
          <div className="flex items-center gap-2">
            <p className="px-1 font-extrabold uppercase tracking-wide text-ink">
              Whiteboard
            </p>

            {/* Tool selector */}
            <div className="flex gap-1">
              <button
                onClick={() => setTool("pen")}
                className={`neo-sm neo-press flex h-7 items-center gap-1 rounded-sm px-2 text-xs font-extrabold uppercase tracking-wide transition ${
                  tool === "pen"
                    ? "bg-ink text-cream"
                    : "bg-paper text-ink hover:bg-retro-yellow"
                }`}
                title="Pen"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                </svg>
              </button>
              <button
                onClick={() => setTool("rect")}
                className={`neo-sm neo-press flex h-7 items-center gap-1 rounded-sm px-2 text-xs font-extrabold uppercase tracking-wide transition ${
                  tool === "rect"
                    ? "bg-ink text-cream"
                    : "bg-paper text-ink hover:bg-retro-yellow"
                }`}
                title="Rectangle"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="14" height="14" rx="1" />
                </svg>
              </button>
              <button
                onClick={() => setTool("circle")}
                className={`neo-sm neo-press flex h-7 items-center gap-1 rounded-sm px-2 text-xs font-extrabold uppercase tracking-wide transition ${
                  tool === "circle"
                    ? "bg-ink text-cream"
                    : "bg-paper text-ink hover:bg-retro-yellow"
                }`}
                title="Circle"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <ellipse cx="10" cy="10" rx="7" ry="7" />
                </svg>
              </button>
              <button
                onClick={() => setTool("eraser")}
                className={`neo-sm neo-press flex h-7 items-center gap-1 rounded-sm px-2 text-xs font-extrabold uppercase tracking-wide transition ${
                  tool === "eraser"
                    ? "bg-retro-orange text-paper"
                    : "bg-paper text-ink hover:bg-retro-yellow"
                }`}
                title="Eraser"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 20H7L3 16l9.5-9.5a2.83 2.83 0 014 0l2.5 2.5a2.83 2.83 0 010 4L10 20" />
                  <path d="M18 13.5l-6.5-6.5" />
                </svg>
                {tool === "eraser" && (
                  <span className="rounded-sm bg-paper px-1 text-[9px] text-ink">
                    {width * 3}px
                  </span>
                )}
              </button>
            </div>

            {/* Color picker */}
            <div className="flex gap-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => { setColor(c); if (tool === "eraser") setTool("pen"); }}
                  className={`h-5 w-5 rounded-full border-2 transition ${
                    color === c && tool !== "eraser"
                      ? "scale-125 border-ink"
                      : "border-cream"
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>

            {/* Width picker */}
            <div className="flex gap-1">
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  onClick={() => setWidth(w)}
                  className={`flex h-6 w-6 items-center justify-center rounded-sm transition ${
                    width === w ? "bg-ink text-cream" : "bg-paper text-ink"
                  }`}
                  title={`${w}px`}
                >
                  <span className="rounded-full bg-current" style={{ width: w, height: w }} />
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={clearBoard}
              className="neo-sm neo-press flex items-center gap-1 rounded-sm bg-paper px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide text-ink hover:bg-retro-red hover:text-paper"
              title="Clear board"
            >
              <TrashIcon className="h-4 w-4" />
              Clear
            </button>
            <button
              onClick={onClose}
              className="neo-sm neo-press flex h-7 w-7 items-center justify-center rounded-sm bg-paper text-ink hover:bg-ink hover:text-paper"
              title="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div ref={containerRef} className="relative min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full w-full items-center justify-center bg-paper">
            <p className="animate-pulse text-sm font-extrabold uppercase tracking-wider text-ink/60">
              Loading board...
            </p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="h-full w-full touch-none bg-paper"
            style={{ cursor: tool === "eraser" ? eraserCursor : "crosshair" }}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
          />
        )}
      </div>
    </div>
  );
};

export default Whiteboard;
