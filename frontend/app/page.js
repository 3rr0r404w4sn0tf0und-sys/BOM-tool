"use client";
import { useState } from "react";
import MaterialInput from "../components/MaterialInput";
import SlicerSettings from "../components/SlicerSettings";
import BedViewer from "../components/BedViewer";
import { API_BASE } from "../lib/apiBase";

const panel = { border: "1px solid #2a2d34", borderRadius: 8, padding: 14, background: "#161821" };

const DEFAULT_SETTINGS = {
  layer_height_mm: 0.2,
  nozzle_line_width_mm: 0.42,
  wall_count: 3,
  top_bottom_layers: 4,
  ironing_enabled: false,
  infill_percent: 15,
  infill_pattern: "grid",
  support_type: "tree",
  overhang_fraction: 25,
  interface_fraction: 15,
  brim_enabled: false,
  brim_width_mm: 5,
  skirt_enabled: true,
  skirt_loops: 2,
  skirt_distance_mm: 2,
  raft_enabled: false,
  raft_layers: 3,
  raft_margin_mm: 5,
  print_speed_mms: 150,
  first_layer_speed_mms: 30,
  seam_position: "aligned",
  shrinkage_percent: 101,
};

const PRINTERS = {
  h2d_pro: { name: "Bambu Lab H2D Pro", bed_mm: { x: 350, y: 320, z: 325 } },
  qidi_plus4: { name: "Qidi Plus 4", bed_mm: { x: 280, y: 280, z: 270 } },
};

export default function Home() {
  const [geometry, setGeometry] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const [mainMat, setMainMat] = useState({});
  const [supportMat, setSupportMat] = useState({});
  const [interfaceMat, setInterfaceMat] = useState({});

  const [printerId, setPrinterId] = useState("h2d_pro");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [rotatedDims, setRotatedDims] = useState(null);

  const [result, setResult] = useState(null);
  const [calcError, setCalcError] = useState(null);
  const [calculating, setCalculating] = useState(false);

  async function handleUpload(e) {
    const f = e.target.files[0];
    if (!f) return;
    setUploading(true);
    setUploadError(null);
    setGeometry(null);
    setRotatedDims(null);

    const form = new FormData();
    form.append("file", f);
    try {
      const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "upload failed");
      setGeometry(data);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleCalc() {
    setCalculating(true);
    setCalcError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/calc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geometry_id: geometry.id,
          printer_id: printerId,
          settings: {
            ...settings,
            overhang_fraction: settings.overhang_fraction / 100,
            interface_fraction: settings.interface_fraction / 100,
          },
          materials: {
            main: mainMat,
            support: settings.support_type !== "none" ? supportMat : undefined,
            interface: settings.interface_fraction > 0 ? interfaceMat : undefined,
          },
          rotated_dims: rotatedDims,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "calc failed");
      setResult(data);
    } catch (err) {
      setCalcError(err.message);
    } finally {
      setCalculating(false);
    }
  }

  const bedDims = PRINTERS[printerId].bed_mm;

  return (
    <main style={{ maxWidth: 1400, margin: "0 auto", padding: 20 }}>
      <h1 style={{ fontSize: 20, marginBottom: 2 }}>Printed Parts Material Calc</h1>
      <p style={{ color: "#9aa0ab", fontSize: 12, marginTop: 0, marginBottom: 16 }}>
        Full slicer-style settings, real bed + orientation, no actual slicing.
      </p>

      {!geometry && (
        <div style={{ ...panel, marginBottom: 16 }}>
          <strong>Load a part</strong>
          <div style={{ marginTop: 8 }}>
            <input type="file" accept=".step,.stp,.iges,.igs,.stl" onChange={handleUpload} />
          </div>
          {uploading && <div style={{ fontSize: 12, marginTop: 8 }}>Parsing geometry…</div>}
          {uploadError && <div style={{ color: "#e08080", fontSize: 12, marginTop: 8 }}>{uploadError}</div>}
        </div>
      )}

      {geometry && (
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr 300px", gap: 16 }}>
          {/* Left: slicer settings tree */}
          <div style={panel}>
            <SlicerSettings settings={settings} onChange={setSettings} />
          </div>

          {/* Center: bed + part */}
          <div>
            <div style={panel}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>{geometry.filename}</strong>
                <select value={printerId} onChange={(e) => setPrinterId(e.target.value)} style={{ background: "#0f1115", color: "#e6e6e6", border: "1px solid #2a2d34", borderRadius: 5, padding: "4px 8px", fontSize: 12 }}>
                  <option value="h2d_pro">Bambu Lab H2D Pro</option>
                  <option value="qidi_plus4">Qidi Plus 4</option>
                </select>
              </div>
              <BedViewer meshUrl={`${API_BASE}${geometry.mesh_url}`} bedDims={bedDims} onRotatedDimsChange={setRotatedDims} />
              <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 8 }}>
                Original volume: {(geometry.volume_mm3 / 1000).toFixed(2)} cm³ · Bbox {geometry.bbox.x_mm.toFixed(0)}×{geometry.bbox.y_mm.toFixed(0)}×{geometry.bbox.z_mm.toFixed(0)}mm
                {rotatedDims && <> · Rotated footprint {rotatedDims.x.toFixed(0)}×{rotatedDims.y.toFixed(0)}×{rotatedDims.z.toFixed(0)}mm</>}
              </div>
            </div>

            <button onClick={() => { setGeometry(null); setResult(null); }} style={{ marginTop: 8, fontSize: 12, background: "none", border: "1px solid #2a2d34", color: "#9aa0ab", borderRadius: 5, padding: "4px 10px", cursor: "pointer" }}>
              Load different part
            </button>

            {result && (
              <div style={{ ...panel, marginTop: 16 }}>
                <strong>Results</strong>
                {result.bed_fit && (
                  <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: result.bed_fit.fits ? "#173d2b" : "#3d1717", fontSize: 13 }}>
                    {result.bed_fit.fits ? "✓ Fits on bed" : "✗ Does NOT fit on bed"} — part{" "}
                    {result.bed_fit.part_dims_mm.x.toFixed(1)}×{result.bed_fit.part_dims_mm.y.toFixed(1)}×{result.bed_fit.part_dims_mm.z.toFixed(1)}mm
                    vs bed {result.bed_fit.bed_mm.x}×{result.bed_fit.bed_mm.y}×{result.bed_fit.bed_mm.z}mm
                  </div>
                )}
                <table style={{ width: "100%", marginTop: 12, fontSize: 13, borderCollapse: "collapse" }}>
                  <thead><tr style={{ color: "#9aa0ab", textAlign: "left" }}><th>Material</th><th>Grams</th><th>Cost</th></tr></thead>
                  <tbody>
                    <tr><td>Main (incl. adhesion)</td><td>{result.usage.usage.main.grams.toFixed(1)}g</td><td>${result.usage.usage.main.cost.toFixed(2)}</td></tr>
                    {result.usage.usage.support.grams > 0 && <tr><td>Support</td><td>{result.usage.usage.support.grams.toFixed(1)}g</td><td>${result.usage.usage.support.cost.toFixed(2)}</td></tr>}
                    {result.usage.usage.interface && <tr><td>Interface</td><td>{result.usage.usage.interface.grams.toFixed(1)}g</td><td>${result.usage.usage.interface.cost.toFixed(2)}</td></tr>}
                  </tbody>
                </table>
                <div style={{ marginTop: 8, fontWeight: 600 }}>Total: ${result.usage.total_cost.toFixed(2)}</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 8 }}>{result.usage.note}</div>
              </div>
            )}
          </div>

          {/* Right: materials + calculate */}
          <div>
            <div style={panel}>
              <strong style={{ fontSize: 13 }}>Materials</strong>
              <div style={{ marginTop: 10 }}>
                <MaterialInput title="Main filament" material={mainMat} onChange={setMainMat} />
                {settings.support_type !== "none" && (
                  <MaterialInput title="Support filament" material={supportMat} onChange={setSupportMat} />
                )}
                {settings.interface_fraction > 0 && (
                  <MaterialInput title="Interface filament (e.g. AquaSys)" material={interfaceMat} onChange={setInterfaceMat} />
                )}
              </div>
            </div>

            <button
              onClick={handleCalc}
              disabled={calculating}
              style={{ width: "100%", marginTop: 12, padding: "10px 20px", fontWeight: 600, borderRadius: 6, border: "none", background: "#4f8cff", color: "#fff", cursor: "pointer" }}
            >
              {calculating ? "Calculating…" : "Calculate cost"}
            </button>
            {calcError && <div style={{ color: "#e08080", marginTop: 8, fontSize: 12 }}>{calcError}</div>}
          </div>
        </div>
      )}
    </main>
  );
}
