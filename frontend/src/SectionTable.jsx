import React, { useState } from "react";
import CaptchaSolver from "./CaptchaSolver.jsx";
import ContextMenu from "./ContextMenu.jsx";
import { IconTrash, IconPlus, IconWarning, IconClock, IconPencil } from "./Icons.jsx";

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

function CostCell({ item, theme, token, onResolved }) {
  if (item.status === "ok") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
        <span style={{ fontSize: 13.5, color: theme.text, fontWeight: 600 }}>
          ${Number(item.unit_price).toFixed(2)}
        </span>
        {item.stale_price && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: theme.warnText }}>
            <IconWarning size={11} color={theme.warnText} /> stale
          </span>
        )}
        {item.stale_price && <CaptchaSolver item={item} token={token} onResolved={onResolved} />}
      </div>
    );
  }
  if (item.status === "pending" || !item.status) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, color: theme.muted }}>
        <IconClock size={12} color={theme.muted} /> pending…
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, color: theme.errText }}>
      <IconWarning size={12} color={theme.errText} /> failed
    </span>
  );
}

export default function SectionTable({ section, theme, token, onChange }) {
  const [rowMenu, setRowMenu] = useState(null);
  const [tableMenu, setTableMenu] = useState(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(section.title);

  async function patchItem(itemId, patch) {
    await fetch(`${API_URL}/api/boms/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    });
    onChange();
  }

  async function addRow() {
    await fetch(`${API_URL}/api/boms/sections/${section.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "New item", qty: 1 }),
    });
    onChange();
  }

  async function deleteRow(itemId) {
    await fetch(`${API_URL}/api/boms/items/${itemId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    onChange();
  }

  async function deleteTable() {
    await fetch(`${API_URL}/api/boms/sections/${section.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    onChange();
  }

  async function commitTitle() {
    setTitleEditing(false);
    if (titleDraft.trim() && titleDraft !== section.title) {
      await fetch(`${API_URL}/api/boms/sections/${section.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: titleDraft.trim() }),
      });
      onChange();
    }
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
      style={{
        background: theme.cardBg,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 20,
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setTableMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            { label: "Add row", icon: IconPlus, onClick: addRow },
            { label: "Delete table", icon: IconTrash, onClick: deleteTable, danger: true },
          ],
        });
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>
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

        <button
          onClick={deleteTable}
          title="Delete table"
          style={{ border: "none", background: "none", cursor: "pointer", padding: 4, display: "flex", color: theme.muted }}
        >
          <IconTrash size={14} color={theme.muted} />
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ ...colHeader, width: "34%" }}>Link</th>
            <th style={{ ...colHeader, width: "34%" }}>Name</th>
            <th style={{ ...colHeader, width: "10%", textAlign: "right" }}>QTY</th>
            <th style={{ ...colHeader, width: "18%", textAlign: "right" }}>Cost</th>
            <th style={{ ...colHeader, width: "4%" }} />
          </tr>
        </thead>
        <tbody>
          {section.items.map((item) => (
            <tr
              key={item.id}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setRowMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    { label: "Add row below", icon: IconPlus, onClick: addRow },
                    { label: "Delete row", icon: IconTrash, onClick: () => deleteRow(item.id), danger: true },
                  ],
                });
              }}
              style={{ borderBottom: `1px solid ${theme.rowBorder}` }}
            >
              <td style={{ padding: "2px 6px", maxWidth: 0, overflow: "hidden" }}>
                <EditableCell
                  value={item.url}
                  placeholder="paste a link…"
                  theme={theme}
                  mono
                  onCommit={(v) => patchItem(item.id, { url: v })}
                />
              </td>
              <td style={{ padding: "2px 6px", maxWidth: 0, overflow: "hidden" }}>
                <EditableCell
                  value={item.name}
                  placeholder="item name"
                  theme={theme}
                  onCommit={(v) => patchItem(item.id, { name: v })}
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
                    patchItem(item.id, { qty: Number.isFinite(n) && n > 0 ? n : 1 });
                  }}
                />
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>
                <CostCell item={item} theme={theme} token={token} onResolved={onChange} />
              </td>
              <td style={{ padding: "2px 4px" }}>
                <button
                  onClick={() => deleteRow(item.id)}
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
        onClick={addRow}
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
