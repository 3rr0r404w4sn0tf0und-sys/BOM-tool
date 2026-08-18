/**
 * Renders a static isometric SVG thumbnail directly from mesh triangles
 * -- no canvas, no GPU, no native deps, so it runs natively in a Worker.
 * Same idea as the PCBWay/JLC upload preview: one static shaded image,
 * not an interactive viewer.
 *
 * Approach: orthographic isometric projection of each triangle, flat-
 * shaded by the angle between its normal and a fixed light direction,
 * painter's-algorithm depth sort (back-to-front) since there's no
 * z-buffer available for plain SVG polygons.
 *
 * Large meshes are subsampled to MAX_TRIANGLES to keep the SVG (and the
 * sort) cheap -- fine for a small preview image, not meant for precision.
 */

const SIZE = 320;
const MAX_TRIANGLES = 4000;

function isoProject(x, y, z) {
  // Standard isometric-ish projection (30deg)
  const sx = (x - z) * Math.cos(Math.PI / 6);
  const sy = (x + z) * Math.sin(Math.PI / 6) - y;
  return [sx, sy];
}

export function renderSvgThumbnail(mesh, { background = "#f4f4f5", baseColor = [124, 135, 145] } = {}) {
  const { positions, indices } = mesh;
  let triCount = indices.length / 3;

  // Subsample triangles evenly if there are too many
  const stride = triCount > MAX_TRIANGLES ? Math.ceil(triCount / MAX_TRIANGLES) : 1;

  const triangles = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let t = 0; t < triCount; t += stride) {
    const i = t * 3;
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];

    // face normal
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    nx /= nlen; ny /= nlen; nz /= nlen;

    // light from upper-front-right, plus ambient floor
    const lx = 0.5, ly = 0.8, lz = 0.35;
    const llen = Math.hypot(lx, ly, lz);
    const dot = Math.max(0, (nx * lx + ny * ly + nz * lz) / llen);
    const shade = 0.35 + 0.65 * dot;

    const depth = ax + ay + az + bx + by + bz + cx + cy + cz; // rough painter's-algorithm key

    const p1 = isoProject(ax, ay, az);
    const p2 = isoProject(bx, by, bz);
    const p3 = isoProject(cx, cy, cz);

    for (const [px, py] of [p1, p2, p3]) {
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }

    triangles.push({ p1, p2, p3, shade, depth });
  }

  triangles.sort((a, b) => a.depth - b.depth);

  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const scale = 0.82 * SIZE / Math.max(width, height);
  const offsetX = SIZE / 2 - ((minX + maxX) / 2) * scale;
  const offsetY = SIZE / 2 - ((minY + maxY) / 2) * scale;

  const toScreen = ([x, y]) => [x * scale + offsetX, y * scale + offsetY];

  const polys = triangles
    .map(({ p1, p2, p3, shade }) => {
      const [x1, y1] = toScreen(p1);
      const [x2, y2] = toScreen(p2);
      const [x3, y3] = toScreen(p3);
      const [r, g, b] = baseColor.map((c) => Math.round(c * shade));
      return `<polygon points="${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} ${x3.toFixed(1)},${y3.toFixed(1)}" fill="rgb(${r},${g},${b})" stroke="rgb(${r},${g},${b})" stroke-width="0.4" />`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" fill="${background}" />` +
    polys +
    `</svg>`;
}
