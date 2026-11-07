"use client";
// Shared live view of the browser session. Frames arrive over the worker's screencast socket.
// When the agent holds control the canvas is read-only; when the human has it, mouse and key
// events are forwarded as CDP Input events so the human drives the very same page.
import { useEffect, useRef, useState } from "react";
import { BROWSER_WS, type TraceEvent } from "@/lib/api";
import { framePosition, keyParams, mouseParams, type MouseEventType } from "@/lib/input";

// While the human drives, the worker records what their input did in the DOM and sends each
// (before, action, after) event over the same socket; `onTrace` lets the parent show it live.
export default function CoBrowseCanvas({ sessionId, humanControl, onTrace }:
  { sessionId: string; humanControl: boolean; onTrace?: (ev: TraceEvent, index: number) => void }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ deviceWidth: number; deviceHeight: number } | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const trace = useRef(onTrace);
  trace.current = onTrace;

  useEffect(() => {
    const sock = new WebSocket(`${BROWSER_WS}/ws/${sessionId}`);
    ws.current = sock;
    sock.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "frame") { setFrame(m.data); setMeta(m.metadata); }
      if (m.type === "trace") trace.current?.(m.event, m.index);
    };
    return () => sock.close();
  }, [sessionId]);

  function send(ev: unknown) { ws.current?.readyState === 1 && ws.current.send(JSON.stringify(ev)); }

  const mouse = (type: MouseEventType) => (e: React.MouseEvent) => {
    if (!humanControl) return;
    // Before the first frame there is no <img> to measure against, so there is nothing to map the pointer to.
    const el = img.current;
    if (!frame || !el) return;
    const r = el.getBoundingClientRect();
    const at = framePosition({ x: e.clientX, y: e.clientY }, r, { width: meta?.deviceWidth ?? el.naturalWidth, height: meta?.deviceHeight ?? el.naturalHeight });
    send({ type: "mouse", params: mouseParams(type, e, at) });
  };
  function key(e: React.KeyboardEvent) {
    if (!humanControl) return;
    e.preventDefault();
    const [down, up] = keyParams(e);
    send({ type: "key", params: down });
    send({ type: "key", params: up });
  }

  return (
    <div className="canvas" tabIndex={0} onKeyDown={key}
      onMouseMove={mouse("mouseMoved")} onMouseDown={mouse("mousePressed")} onMouseUp={mouse("mouseReleased")}>
      {frame ? <img ref={img} src={`data:image/jpeg;base64,${frame}`} alt="shared browser" draggable={false} />
             : <div className="lock">Waiting for frames from the browser worker…</div>}
      {frame && !humanControl && <div className="lock">Agent is driving. You can take over when it asks, or any time.</div>}
    </div>
  );
}
