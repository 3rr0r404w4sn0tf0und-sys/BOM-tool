"use client";

const row = { display: "flex", gap: 8, marginBottom: 8 };
const field = { flex: 1 };
const label = { fontSize: 11, color: "#9aa0ab", display: "block", marginBottom: 2 };
const input = {
  width: "100%",
  padding: "5px 7px",
  background: "#0f1115",
  border: "1px solid #2a2d34",
  borderRadius: 5,
  color: "#e6e6e6",
  fontSize: 13,
};
const section = { marginBottom: 18 };
const sectionTitle = { fontSize: 12, fontWeight: 700, color: "#6f9fff", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, borderBottom: "1px solid #2a2d34", paddingBottom: 4 };
const checkboxRow = { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#c7cbd1", marginBottom: 6 };

function Field({ children, w }) {
  return <div style={{ ...field, ...(w ? { flex: `0 0 ${w}` } : {}) }}>{children}</div>;
}

export default function SlicerSettings({ settings, onChange }) {
  const set = (key, val) => onChange({ ...settings, [key]: val });

  return (
    <div style={{ fontSize: 13 }}>
      {/* Layers & perimeters -- affects wall/top-bottom material */}
      <div style={section}>
        <div style={sectionTitle}>Layers &amp; Perimeters</div>
        <div style={row}>
          <Field>
            <label style={label}>Layer height (mm)</label>
            <input type="number" step="0.01" style={input} value={settings.layer_height_mm}
              onChange={(e) => set("layer_height_mm", +e.target.value)} />
          </Field>
          <Field>
            <label style={label}>Nozzle line width (mm)</label>
            <input type="number" step="0.01" style={input} value={settings.nozzle_line_width_mm}
              onChange={(e) => set("nozzle_line_width_mm", +e.target.value)} />
          </Field>
        </div>
        <div style={row}>
          <Field>
            <label style={label}>Wall (perimeter) count</label>
            <input type="number" style={input} value={settings.wall_count}
              onChange={(e) => set("wall_count", +e.target.value)} />
          </Field>
          <Field>
            <label style={label}>Top/bottom solid layers</label>
            <input type="number" style={input} value={settings.top_bottom_layers}
              onChange={(e) => set("top_bottom_layers", +e.target.value)} />
          </Field>
        </div>
        <div style={checkboxRow}>
          <input type="checkbox" checked={settings.ironing_enabled} onChange={(e) => set("ironing_enabled", e.target.checked)} />
          Ironing (cosmetic only -- not counted in material estimate)
        </div>
      </div>

      {/* Infill */}
      <div style={section}>
        <div style={sectionTitle}>Infill</div>
        <div style={row}>
          <Field>
            <label style={label}>Infill density (%)</label>
            <input type="number" style={input} value={settings.infill_percent}
              onChange={(e) => set("infill_percent", +e.target.value)} />
          </Field>
          <Field>
            <label style={label}>Infill pattern (cosmetic)</label>
            <select style={input} value={settings.infill_pattern} onChange={(e) => set("infill_pattern", e.target.value)}>
              <option value="grid">Grid</option>
              <option value="gyroid">Gyroid</option>
              <option value="honeycomb">Honeycomb</option>
              <option value="cubic">Cubic</option>
            </select>
          </Field>
        </div>
        <div style={{ fontSize: 10, color: "#6b7280" }}>Pattern doesn't change the density-based volume estimate here -- only % matters for material.</div>
      </div>

      {/* Support */}
      <div style={section}>
        <div style={sectionTitle}>Support Material</div>
        <div style={row}>
          <Field>
            <label style={label}>Support type</label>
            <select style={input} value={settings.support_type} onChange={(e) => set("support_type", e.target.value)}>
              <option value="none">None</option>
              <option value="grid">Grid / Normal</option>
              <option value="tree">Tree</option>
              <option value="organic">Organic</option>
            </select>
          </Field>
          <Field>
            <label style={label}>Est. overhang area (%)</label>
            <input type="number" style={input} value={settings.overhang_fraction}
              onChange={(e) => set("overhang_fraction", +e.target.value)} />
          </Field>
        </div>
        <div style={row}>
          <Field>
            <label style={label}>Interface support (%)</label>
            <input type="number" style={input} value={settings.interface_fraction}
              onChange={(e) => set("interface_fraction", +e.target.value)} />
          </Field>
        </div>
      </div>

      {/* Adhesion */}
      <div style={section}>
        <div style={sectionTitle}>Build Plate Adhesion</div>

        <div style={checkboxRow}>
          <input type="checkbox" checked={settings.brim_enabled} onChange={(e) => set("brim_enabled", e.target.checked)} />
          Brim
        </div>
        {settings.brim_enabled && (
          <div style={row}>
            <Field><label style={label}>Brim width (mm)</label>
              <input type="number" style={input} value={settings.brim_width_mm} onChange={(e) => set("brim_width_mm", +e.target.value)} /></Field>
          </div>
        )}

        <div style={checkboxRow}>
          <input type="checkbox" checked={settings.skirt_enabled} onChange={(e) => set("skirt_enabled", e.target.checked)} />
          Skirt
        </div>
        {settings.skirt_enabled && (
          <div style={row}>
            <Field><label style={label}>Skirt loops</label>
              <input type="number" style={input} value={settings.skirt_loops} onChange={(e) => set("skirt_loops", +e.target.value)} /></Field>
            <Field><label style={label}>Distance from part (mm)</label>
              <input type="number" style={input} value={settings.skirt_distance_mm} onChange={(e) => set("skirt_distance_mm", +e.target.value)} /></Field>
          </div>
        )}

        <div style={checkboxRow}>
          <input type="checkbox" checked={settings.raft_enabled} onChange={(e) => set("raft_enabled", e.target.checked)} />
          Raft
        </div>
        {settings.raft_enabled && (
          <div style={row}>
            <Field><label style={label}>Raft layers</label>
              <input type="number" style={input} value={settings.raft_layers} onChange={(e) => set("raft_layers", +e.target.value)} /></Field>
            <Field><label style={label}>Raft margin (mm)</label>
              <input type="number" style={input} value={settings.raft_margin_mm} onChange={(e) => set("raft_margin_mm", +e.target.value)} /></Field>
          </div>
        )}
      </div>

      {/* Speed -- cosmetic, doesn't affect material, but included for slicer feel */}
      <div style={section}>
        <div style={sectionTitle}>Speed <span style={{ color: "#6b7280", fontWeight: 400, textTransform: "none" }}>(cosmetic -- no material impact)</span></div>
        <div style={row}>
          <Field><label style={label}>Print speed (mm/s)</label>
            <input type="number" style={input} value={settings.print_speed_mms} onChange={(e) => set("print_speed_mms", +e.target.value)} /></Field>
          <Field><label style={label}>First layer speed (mm/s)</label>
            <input type="number" style={input} value={settings.first_layer_speed_mms} onChange={(e) => set("first_layer_speed_mms", +e.target.value)} /></Field>
        </div>
      </div>

      {/* Advanced */}
      <div style={section}>
        <div style={sectionTitle}>Advanced</div>
        <div style={row}>
          <Field><label style={label}>Seam position (cosmetic)</label>
            <select style={input} value={settings.seam_position} onChange={(e) => set("seam_position", e.target.value)}>
              <option value="aligned">Aligned</option>
              <option value="nearest">Nearest</option>
              <option value="random">Random</option>
            </select></Field>
        </div>
        <div style={row}>
          <Field><label style={label}>Shrinkage compensation (%)</label>
            <input type="number" step="0.1" style={input} value={settings.shrinkage_percent}
              onChange={(e) => set("shrinkage_percent", +e.target.value)} /></Field>
        </div>
      </div>
    </div>
  );
}
