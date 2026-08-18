import { Hono } from "hono";
import { parseCadFile } from "../lib/stepParser.js";
import { renderSvgThumbnail } from "../lib/svgThumbnail.js";

const upload = new Hono();

upload.post("/upload", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!file) return c.json({ error: "no file uploaded" }, 400);

  const name = file.name || "part";
  const ext = name.split(".").pop().toLowerCase();
  const format = ext === "stl" ? "stl" : ext === "igs" || ext === "iges" ? "iges" : "step";

  try {
    const arrayBuffer = await file.arrayBuffer();
    const geometry = await parseCadFile(arrayBuffer, format);
    const svg = renderSvgThumbnail(geometry.mesh);

    const id = crypto.randomUUID();

    // Store lightweight stats for calc, plus the mesh itself (as compact
    // typed-array JSON) so the frontend bed viewer can render + let the
    // user rotate the actual part.
    const stored = {
      volume_mm3: geometry.volume_mm3,
      surface_area_mm2: geometry.surface_area_mm2,
      bbox: geometry.bbox,
    };

    await c.env.GEOMETRY_KV.put(`geometry:${id}`, JSON.stringify(stored), {
      expirationTtl: 60 * 60 * 24, // 1 day -- this is a one-session calc tool, not long-term storage
    });
    await c.env.GEOMETRY_KV.put(`thumbnail:${id}`, svg, {
      expirationTtl: 60 * 60 * 24,
    });
    await c.env.GEOMETRY_KV.put(
      `mesh:${id}`,
      JSON.stringify({ positions: geometry.mesh.positions, indices: geometry.mesh.indices }),
      { expirationTtl: 60 * 60 * 24 }
    );

    return c.json({
      id,
      filename: name,
      volume_mm3: geometry.volume_mm3,
      surface_area_mm2: geometry.surface_area_mm2,
      bbox: geometry.bbox,
      thumbnail_url: `/api/thumbnail/${id}`,
      mesh_url: `/api/mesh/${id}`,
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

upload.get("/thumbnail/:id", async (c) => {
  const svg = await c.env.GEOMETRY_KV.get(`thumbnail:${c.req.param("id")}`);
  if (!svg) return c.notFound();
  return c.body(svg, 200, { "Content-Type": "image/svg+xml" });
});

upload.get("/mesh/:id", async (c) => {
  const mesh = await c.env.GEOMETRY_KV.get(`mesh:${c.req.param("id")}`);
  if (!mesh) return c.notFound();
  return c.body(mesh, 200, { "Content-Type": "application/json" });
});

export default upload;
