"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** 滚动数字：每一位是一条 0-9 的竖条，换数字时滚过去 */
export function Odometer({ value, className = "" }: { value: number; className?: string }) {
  const digits = String(Math.max(0, Math.floor(value))).split("");
  return (
    <span className={`font-num inline-flex leading-none ${className}`} aria-label={String(value)}>
      {digits.map((d, i) => (
        <span
          key={digits.length - i}
          className="relative inline-block overflow-hidden"
          style={{ height: "1em", width: "0.62em" }}
          aria-hidden
        >
          <span
            className="absolute left-0 top-0 flex flex-col items-center"
            style={{
              transform: `translateY(-${Number(d)}em)`,
              transition: "transform 700ms cubic-bezier(.2,.9,.25,1.15)",
              width: "100%",
            }}
          >
            {Array.from({ length: 10 }, (_, n) => (
              <span key={n} style={{ height: "1em", lineHeight: "1em" }}>
                {n}
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

export function QrSvg({ text, className = "" }: { text: string; className?: string }) {
  const [svg, setSvg] = useState<string>("");
  useEffect(() => {
    if (!text) return;
    let alive = true;
    QRCode.toString(text, {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
      color: { dark: "#222321", light: "#00000000" },
    })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(""));
    return () => {
      alive = false;
    };
  }, [text]);
  return (
    <div
      className={`[&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className}`}
      role="img"
      aria-label={`二维码：${text}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** 1920×1080 舞台，等比缩放铺满父容器（或窗口） */
export function Stage({ children, fit = "window" }: { children: React.ReactNode; fit?: "window" | "container" }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    if (!box) return;
    const measure = () => {
      const w = fit === "window" ? window.innerWidth : box.clientWidth;
      const h = fit === "window" ? window.innerHeight : box.clientWidth * (1080 / 1920);
      setScale(Math.min(w / 1920, h / 1080));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [box, fit]);
  return (
    <div
      ref={setBox}
      className={`overflow-hidden bg-night ${fit === "window" ? "fixed inset-0" : "relative w-full"}`}
      style={fit === "container" ? { aspectRatio: "16 / 9" } : undefined}
    >
      <div
        className="absolute left-1/2 top-1/2 h-[1080px] w-[1920px]"
        style={{
          transform: `translate(-50%, -50%) scale(${scale})`,
          visibility: scale ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}
