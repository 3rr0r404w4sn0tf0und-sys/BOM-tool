import React, { useState, useEffect, useRef } from "react";
import CaptchaSolver from "./CaptchaSolver.jsx";
import ContextMenu from "./ContextMenu.jsx";
import { IconTrash, IconPlus, IconWarning, IconClock, IconPencil, IconRefresh, IconGrip } from "./Icons.jsx";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

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

// Manual "refresh price" control. Fires POST /items/:id/refresh (which
// works for Amazon too -- it tries Apify then falls back to Playwright,
// same as the scheduled jobs) then polls the parent's onRefresh a few
// times since the result comes back async via a GitHub Actions callback.
function RefreshButton({ item, theme, token, onRefresh }) {
  const [firing, setFiring] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  async function fire() {
    if (firing) return;
    setFiring(true);
    try {
      await fetch(`${API_URL}/api/boms/items/${item.id}/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // ignore -- polling below will just find nothing changed
    }
    onRefresh();
    let checks = 0;
    pollRef.current = setInterval(() => {
      checks += 1;
      onRefresh();
      if (checks >= 8) {
        clearInterval(pollRef.current);
        setFiring(false);
      }
    }, 4000);
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
      <span
        style={{
          display: "flex",
          animation: firing ? "bomToolSpin 900ms linear infinite" : "none",
        }}
      >
        <style>{`@keyframes bomToolSpin { to { transform: rotate(360deg); } }`}</style>
        <IconRefresh size={12} color={theme.muted} />
      </span>
    </button>
  );
}

function CostCell({ item, theme, token, onResolved }) {
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
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: theme.warnText }}>
              <IconWarning size={11} color={theme.warnText} /> stale
            </span>
          )}
          {item.stale_price && <CaptchaSolver item={item} token={token} onResolved={onResolved} />}
        </div>
        <RefreshButton item={item} theme={theme} token={token} onRefresh={onResolved} />
      </div>
    );
  }
  if (item.status === "pending" || !item.status) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, color: theme.muted }}>
          <IconClock size={12} color={theme.muted} /> pending…
        </span>
        <RefreshButton item={item} theme={theme} token={token} onRefresh={onResolved} />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, color: theme.errText }}>
        <IconWarning size={12} color={theme.errText} /> failed
      </span>
      <RefreshButton item={item} theme={theme} token={token} onRefresh={onResolved} />
    </div>
  );
}

// SectionTable is now a "dumb-ish" renderer: every mutation (add/delete
// row, edit a cell, reorder, rename/delete table) is delegated up to App
// via props, so App can apply it optimistically to local state, push an
// undo/redo command, and fire the API call in the background -- instead
// of this component doing its own fetch-then-reload-everything, which is
// what caused the lag on every single row action.
export default function SectionTable({
  section,
  theme,
  token,
  onResolved,
  onAddRow,
  onDeleteRow,
  onPatchItem,
  onReorderItems,
  onRenameSection,
  onDeleteTable,
  sectionDragHandleProps,
  sectionDropProps,
  isSectionDragOver,
}) {
  const [rowMenu, setRowMenu] = useState(null);
  const [tableMenu, setTableMenu] = useState(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(section.title);
  const [dragItemId, setDragItemId] = useState(null);
  const [dragOverItemId, setDragOverItemId] = useState(null);

  function commitTitle() {
    setTitleEditing(false);
    const next = titleDraft.trim();
    if (next && next !== section.title) onRenameSection(next);
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
    onReorderItems(ids);
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
            { label: "Add row", icon: IconPlus, onClick: onAddRow },
            { label: "Delete table", icon: IconTrash, onClick: onDeleteTable, danger: true },
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
              {section.title}
              <IconPencil size={12} color={theme.muted} />
            </button>
          )}
        </div>

        <button
          onClick={onDeleteTable}
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
                    { label: "Add row below", icon: IconPlus, onClick: onAddRow },
                    { label: "Delete row", icon: IconTrash, onClick: () => onDeleteRow(item.id), danger: true },
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
                  onCommit={(v) => onPatchItem(item.id, { url: v, status: "pending" })}
                />
              </td>
              <td style={{ padding: "2px 6px", maxWidth: 0, overflow: "hidden" }}>
                <EditableCell
                  value={item.name}
                  placeholder="item name"
                  theme={theme}
                  onCommit={(v) => onPatchItem(item.id, { name: v })}
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
                    onPatchItem(item.id, { qty: Number.isFinite(n) && n > 0 ? n : 1 });
                  }}
                />
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>
                <CostCell item={item} theme={theme} token={token} onResolved={onResolved} />
              </td>
              <td style={{ padding: "2px 4px" }}>
                <button
                  onClick={() => onDeleteRow(item.id)}
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
        onClick={onAddRow}
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
