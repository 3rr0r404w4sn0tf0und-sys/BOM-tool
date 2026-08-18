import React, { useEffect, useRef } from "react";

// A small right-click context menu. Render conditionally based on a
// {x, y, items} state object held by the parent; pass that as `menu`.
// items: [{ label, icon: Component, onClick, danger?: bool }]
export default function ContextMenu({ menu, theme, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!menu) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  // Keep the menu on-screen near viewport edges.
  const width = 200;
  const left = Math.min(menu.x, window.innerWidth - width - 8);
  const top = Math.min(menu.y, window.innerHeight - menu.items.length * 36 - 16);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top,
        left,
        width,
        background: theme.cardBg,
        border: `1px solid ${theme.border}`,
        borderRadius: 10,
        boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
        padding: 6,
        zIndex: 1000,
        fontFamily: "sans-serif",
        animation: "bomToolContextMenuIn 120ms ease",
      }}
    >
      <style>{`
        @keyframes bomToolContextMenuIn {
          from { opacity: 0; transform: scale(0.96) translateY(-4px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      {menu.items.map((item, i) => (
        <button
          key={i}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            textAlign: "left",
            padding: "8px 10px",
            border: "none",
            background: "none",
            cursor: "pointer",
            fontSize: 13.5,
            color: item.danger ? theme.errText : theme.text,
            borderRadius: 6,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = theme.bg)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          {item.icon && <item.icon size={14} color={item.danger ? theme.errText : theme.text} />}
          {item.label}
        </button>
      ))}
    </div>
  );
}
