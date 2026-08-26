import React, { useState, useEffect, useRef, memo } from "react";
import { API_URL, apiFetch } from "./api.js";
import ContextMenu from "./ContextMenu.jsx";
import { IconTrash, IconPlus, IconWarning, IconClock, IconPencil, IconRefresh, IconGrip, IconSmiley } from "./Icons.jsx";

// Common section emoji, grouped loosely by what people actually label
// BOM tables with (electronics/hardware-flavored, since that's the app),
// plus a general set. Click one to set it, click the x to clear back to
// no emoji.
const EMOJI_CHOICES = [
  "🔋", "⚡", "🔌", "📡", "🛠️", "🔩", "⚙️", "🧰",
  "🖥️", "💾", "📷", "🚀", "✈️", "🛞", "🧲", "🔧",
  "📦", "🧵", "🪛", "🔗", "🧪", "💡", "🖨️", "🧱",
];

// Small popover for picking (or clearing) a section's emoji. Sits next
// to the pencil/rename button in the section header.
function EmojiPicker({ theme, value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "flex" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={value ? "Change emoji" : "Add emoji"}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "none", background: "none", cursor: "pointer", padding: 4,
          borderRadius: 6, color: theme.muted, fontSize: 13, lineHeight: 1,
        }}
      >
        {value ? <span style={{ fontSize: 13 }}>{value}</span> : <IconSmiley size={12} color={theme.muted} />}
      </button>

      <div
        style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 20,
          background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 10,
          boxShadow: "0 10px 28px rgba(0,0,0,0.18)", width: 216, padding: 10,
          transformOrigin: "top left",
          opacity: open ? 1 : 0,
          transform: open ? "scale(1) translateY(0)" : "scale(0.96) translateY(-4px)",
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 150ms ease, transform 150ms ease",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 2 }}>
          {EMOJI_CHOICES.map((e) => (
            <button
              key={e}
              onClick={() => { onChange(e); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 17, padding: "5px 0", borderRadius: 6, border: "none",
                cursor: "pointer", background: e === value ? theme.accentSoft || theme.border : "transparent",
              }}
              onMouseEnter={(ev) => (ev.currentTarget.style.background = theme.border)}
              onMouseLeave={(ev) => (ev.currentTarget.style.background = e === value ? (theme.accentSoft || theme.border) : "transparent")}
            >
              {e}
            </button>
          ))}
        </div>
        {value && (
          <button
            onClick={() => { onChange(""); setOpen(false); }}
            style={{
              width: "100%", marginTop: 8, padding: "6px 0", fontSize: 12, fontWeight: 600,
              border: `1px solid ${theme.border}`, borderRadius: 7, background: "none",
              color: theme.muted, cursor: "pointer",
            }}
          >
            Remove emoji
          </button>
        )}
      </div>
    </div>
  );
}

// A single editable cell: shows as plain text, becomes an input on click,
// commits on blur/Enter, reverts on Escape.
function EditableCell({ value, placeholder, onCommit, theme, align, mono }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  function commit() {
    setEditing(false);
    if (draft !== (value ?? "")) onCommit(draft);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          }
        }}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "6px 8px",
          border: `1px solid ${theme.accent}`,
          borderRadius: 6,
          fontSize: 13.5,
          background: theme.cardBg,
          color: theme.text,
          textAlign: align || "left",
          fontFamily: mono ? "monospace" : "inherit",
        }}
      />
    );
  }

  const isEmpty = !value;
  return (
    <div
      onClick={() => {
        setDraft(value ?? "");
        setEditing(true);
      }}
      title="Click to edit"
      style={{
        padding: "6px 8px",
        borderRadius: 6,
        cursor: "text",
        fontSize: 13.5,
        color: isEmpty ? theme.muted : theme.text,
        textAlign: align || "left",
        fontFamily: mono ? "monospace" : "inherit",
        minHeight: 18,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {isEmpty ? placeholder : value}
    </div>
  );
}

// Manual "refresh price" control. The API starts an asynchronous GitHub Actions
// scrape; the parent polling loop reconciles the returned price/status.
function RefreshButton({ item, theme, onRefresh }) {
  const [firing, setFiring] = useState(false);

  async function fire() {
    if (firing) return;
    setFiring(true);
    try {
      const res = await apiFetch(`/api/boms/items/${item.id}/refresh`, { method: "POST" });
      if (!res.ok) return;
      onRefresh();
    } finally {
      setFiring(false);
    }
  }

  return (
    <button
      onClick={fire}
      disabled={firing}
      title="Refresh price now"
      style={{
        border: "none", background: "none", cursor: firing ? "default" : "pointer",
        padding: 2, display: "flex", color: theme.muted, opacity: firing ? 0.5 : 0.7,
      }}
      onMouseEnter={(e) => !firing && (e.currentTarget.style.opacity = 1)}
      onMouseLeave={(e) => !firing && (e.currentTarget.style.opacity = 0.7)}
    >
      <span style={{ display: "flex", animation: firing ? "bomToolSpin 900ms linear infinite" : "none" }}>
        <style>{`@keyframes bomToolSpin { to { transform: rotate(360deg); } }`}</style>
        <IconRefresh size={12} color={theme.muted} />
      </span>
    </button>
  );
}

function CostCell({ item, theme, onResolved }) {
  const lineTotal = Number(item.unit_price) * Number(item.qty ?? 1);
  if (item.status === "ok") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span style={{ fontSize: 13.5, color: theme.text, fontWeight: 600 }}>
            ${lineTotal.toFixed(2)}
          </span>
          {Number(item.qty ?? 1) !== 1 && (
            <span style={{ fontSize: 11, color: theme.muted }}>
              ${Number(item.unit_price).toFixed(2)} × {item.qty}
            </span>
          )}
          {item.stale_price && (
            <span
              title={item.last_error ? `Last refresh failed: ${item.last_error}` : "Last refresh failed; showing last known price"}
              style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: theme.warnText, cursor: "help" }}
            >
              <IconWarning size={11} color={theme.warnText} /> stale
            </span>
          )}
        </div>
        <RefreshButton item={item} theme={theme} onRefresh={onResolved} />
      </div>
    );
  }
  if (item.status === "pending" || !item.status) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, color: theme.muted }}>
          <IconClock size={12} color={theme.muted} /> pending…
        </span>
        <RefreshButton item={item} theme={theme} onRefresh={onResolved} />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
      <span
        title={item.last_error || "Scrape failed for an unknown reason"}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, color: theme.errText, cursor: item.last_error ? "help" : "default" }}
      >
        <IconWarning size={12} color={theme.errText} /> failed
      </span>
      <RefreshButton item={item} theme={theme} onRefresh={onResolved} />
    </div>
  );
}

// SectionTable is now a "dumb-ish" renderer: every mutation (add/delete
// row, edit a cell, reorder, rename/delete table) is delegated up to App
// via props, so App can apply it optimistically to local state, push an
// undo/redo command, and fire the API call in the background -- instead
// of this component doing its own fetch-then-reload-everything, which is
// what caused the lag on every single row action.
//
// Wrapped in React.memo: all the callback props App passes down now have
// a stable identity across renders (see useCallback usage in App.jsx), and
// unrelated sections keep the same `section` object reference too (App's
// setSections only replaces the one section that actually changed) -- so
// with a BOM that has many tables, editing one row no longer re-renders
// every other table on the page.
function SectionTable({
  section,
  theme,
  onResolved,
  onAddRow,
  onDeleteRow,
  onPatchItem,
  onReorderItems,
  onRenameSection,
  onDeleteTable,
  onChangeEmoji,
  onSectionDragStart,
  onSectionDragOver,
  onSectionDrop,
  onSectionDragEnd,
  isSectionDragOver,
}) {
  const [rowMenu, setRowMenu] = useState(null);
  const [tableMenu, setTableMenu] = useState(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(section.title);
  const [dragItemId, setDragItemId] = useState(null);
  const [dragOverItemId, setDragOverItemId] = useState(null);

  const sectionDragHandleProps = {
    draggable: true,
    onDragStart: (e) => onSectionDragStart(e, section.id),
  };
  const sectionDropProps = {
    onDragOver: (e) => onSectionDragOver(e, section.id),
    onDrop: (e) => onSectionDrop(e, section.id),
    onDragEnd: onSectionDragEnd,
  };

  function commitTitle() {
    setTitleEditing(false);
    const next = titleDraft.trim();
    if (next && next !== section.title) onRenameSection(section.id, next);
  }

  function onRowDragStart(e, itemId) {
    setDragItemId(itemId);
    e.dataTransfer.effectAllowed = "move";
    // Firefox requires data to be set for drag to actually start.
    e.dataTransfer.setData("text/plain", itemId);
  }

  function onRowDragOver(e, itemId) {
    if (!dragItemId || dragItemId === itemId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverItemId !== itemId) setDragOverItemId(itemId);
  }

  function onRowDrop(e, targetItemId) {
    e.preventDefault();
    const draggedId = dragItemId;
    setDragItemId(null);
    setDragOverItemId(null);
    if (!draggedId || draggedId === targetItemId) return;

    const ids = section.items.map((i) => i.id);
    const fromIdx = ids.indexOf(draggedId);
    const toIdx = ids.indexOf(targetItemId);
    if (fromIdx === -1 || toIdx === -1) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, draggedId);
    onReorderItems(section.id, ids);
  }

  const colHeader = {
    padding: "8px 8px",
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: theme.muted,
    textAlign: "left",
    borderBottom: `1px solid ${theme.border}`,
  };

  return (
    <div
      {...sectionDropProps}
      style={{
        background: theme.cardBg,
        border: `1px solid ${isSectionDragOver ? theme.accent : theme.border}`,
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 20,
        transition: "border-color 120ms ease",
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setTableMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            { label: "Add row", icon: IconPlus, onClick: () => onAddRow(section.id) },
            { label: "Delete table", icon: IconTrash, onClick: () => onDeleteTable(section.id), danger: true },
          ],
        });
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            {...sectionDragHandleProps}
            title="Drag to reorder table"
            style={{ display: "flex", cursor: "grab", color: theme.muted, opacity: 0.6, padding: 4, marginLeft: -4 }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = 0.6)}
          >
            <IconGrip size={14} color={theme.muted} />
          </span>
          {titleEditing ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              style={{
                fontSize: 15, fontWeight: 700, border: `1px solid ${theme.accent}`, borderRadius: 6,
                padding: "4px 8px", background: theme.cardBg, color: theme.text,
              }}
            />
          ) : (
            <button
              onClick={() => { setTitleDraft(section.title); setTitleEditing(true); }}
              style={{
                display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", cursor: "pointer",
                fontSize: 15, fontWeight: 700, color: theme.text, padding: "4px 6px", borderRadius: 6,
              }}
            >
              {section.emoji ? `${section.emoji} ` : ""}{section.title}
              <IconPencil size={12} color={theme.muted} />
            </button>
          )}
          <EmojiPicker theme={theme} value={section.emoji} onChange={(e) => onChangeEmoji(section.id, e)} />
        </div>

        <button
          onClick={() => onDeleteTable(section.id)}
          title="Delete table"
          style={{ border: "none", background: "none", cursor: "pointer", padding: 4, display: "flex", color: theme.muted }}
        >
          <IconTrash size={14} color={theme.muted} />
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ ...colHeader, width: "6%" }} />
            <th style={{ ...colHeader, width: "30%" }}>Link</th>
            <th style={{ ...colHeader, width: "26%" }}>Name</th>
            <th style={{ ...colHeader, width: "10%", textAlign: "right" }}>QTY</th>
            <th style={{ ...colHeader, width: "24%", textAlign: "right" }}>Cost</th>
            <th style={{ ...colHeader, width: "4%" }} />
          </tr>
        </thead>
        <tbody>
          {section.items.map((item) => (
            <tr
              key={item.id}
              draggable={false}
              onDragOver={(e) => onRowDragOver(e, item.id)}
              onDrop={(e) => onRowDrop(e, item.id)}
              onDragEnd={() => { setDragItemId(null); setDragOverItemId(null); }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setRowMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    { label: "Add row below", icon: IconPlus, onClick: () => onAddRow(section.id) },
                    { label: "Delete row", icon: IconTrash, onClick: () => onDeleteRow(section.id, item.id), danger: true },
                  ],
                });
              }}
              style={{
                borderBottom: `1px solid ${theme.rowBorder}`,
                background: dragOverItemId === item.id ? theme.rowBorder : "transparent",
                opacity: dragItemId === item.id ? 0.4 : 1,
              }}
            >
              <td style={{ padding: "2px 4px", textAlign: "center" }}>
                <span
                  draggable
                  onDragStart={(e) => onRowDragStart(e, item.id)}
                  title="Drag to reorder row"
                  style={{ display: "inline-flex", cursor: "grab", color: theme.muted, opacity: 0.5, padding: 4 }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = 0.5)}
                >
                  <IconGrip size={13} color={theme.muted} />
                </span>
              </td>
              <td style={{ padding: "2px 6px", maxWidth: 0, overflow: "hidden" }}>
                <EditableCell
                  value={item.url}
                  placeholder="paste a link…"
                  theme={theme}
                  mono
                  onCommit={(v) => onPatchItem(section.id, item.id, { url: v, status: "pending" })}
                />
              </td>
              <td style={{ padding: "2px 6px", maxWidth: 0, overflow: "hidden" }}>
                <EditableCell
                  value={item.name}
                  placeholder="item name"
                  theme={theme}
                  onCommit={(v) => onPatchItem(section.id, item.id, { name: v })}
                />
              </td>
              <td style={{ padding: "2px 6px", maxWidth: 0, overflow: "hidden" }}>
                <EditableCell
                  value={String(item.qty ?? 1)}
                  placeholder="1"
                  theme={theme}
                  align="right"
                  onCommit={(v) => {
                    const n = parseInt(v, 10);
                    onPatchItem(section.id, item.id, { qty: Number.isFinite(n) && n > 0 ? n : 1 });
                  }}
                />
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>
                <CostCell item={item} theme={theme} onResolved={onResolved} />
              </td>
              <td style={{ padding: "2px 4px" }}>
                <button
                  onClick={() => onDeleteRow(section.id, item.id)}
                  title="Delete row"
                  style={{ border: "none", background: "none", cursor: "pointer", padding: 4, display: "flex", color: theme.muted, opacity: 0.6 }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = 0.6)}
                >
                  <IconTrash size={13} color={theme.muted} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        onClick={() => onAddRow(section.id)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          justifyContent: "center",
          padding: "9px 0",
          border: "none",
          borderTop: `1px solid ${theme.border}`,
          background: "none",
          cursor: "pointer",
          fontSize: 12.5,
          color: theme.muted,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = theme.text)}
        onMouseLeave={(e) => (e.currentTarget.style.color = theme.muted)}
      >
        <IconPlus size={13} /> Add row
      </button>

      <ContextMenu menu={rowMenu} theme={theme} onClose={() => setRowMenu(null)} />
      <ContextMenu menu={tableMenu} theme={theme} onClose={() => setTableMenu(null)} />
    </div>
  );
}

export default memo(SectionTable);
