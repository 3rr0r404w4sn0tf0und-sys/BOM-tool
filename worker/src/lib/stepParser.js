/**
 * Parses STEP/IGES/STL files into a triangulated mesh using occt-import-js
 * (WASM build of OpenCascade), then derives enclosed volume, surface area,
 * and bounding box. Adapted for the Workers runtime: operates on
 * ArrayBuffers instead of touching the filesystem.
 *
 * NOTE: occt-import-js loads its .wasm binary at init. On Workers this
 * generally needs the wasm module imported directly (e.g.
 * `import occtWasm from "../occt-import-js.wasm"` with a wasm_modules
 * binding, or fetched from an R2/KV-hosted copy) rather than read from
 * disk like it would on Node. Verify this against the current
 * occt-import-js release when wiring it up -- their Workers-compatible
 * init path has changed across versions.
 */

import occtimportjs from "occt-import-js";

let occtInstance = null;
async function getOcct() {
  if (!occtInstance) {
    // occt-import-js's bundled emscripten glue reaches for CommonJS
    // globals (__dirname, __filename) that Workers doesn't provide even
    // with nodejs_compat on -- shim them before the module's init code
    // actually runs. Since static imports are hoisted above this file's
    // own code, the shim has to happen before the dynamic import below,
    // not before the top-level `import occtimportjs from "occt-import-js"`.
    if (typeof globalThis.__dirname === "undefined") globalThis.__dirname = "/";
    if (typeof globalThis.__filename === "undefined") globalThis.__filename = "/index.js";
    occtInstance = await occtimportjs();
  }
  return occtInstance;
}

function meshVolumeAndArea(positions, indices) {
  let volume = 0;
  let area = 0;
  const p = positions;

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;

    const ax = p[ia], ay = p[ia + 1], az = p[ia + 2];
    const bx = p[ib], by = p[ib + 1], bz = p[ib + 2];
    const cx = p[ic], cy = p[ic + 1], cz = p[ic + 2];

    volume += (
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx)
    ) / 6.0;

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const crossx = uy * vz - uz * vy;
    const crossy = uz * vx - ux * vz;
    const crossz = ux * vy - uy * vx;
    area += 0.5 * Math.sqrt(crossx * crossx + crossy * crossy + crossz * crossz);
  }

  return { volume_mm3: Math.abs(volume), surface_area_mm2: area };
}

function boundingBox(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { x_mm: maxX - minX, y_mm: maxY - minY, z_mm: maxZ - minZ };
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @param {"step"|"iges"|"stl"} format
 */
export async function parseCadFile(arrayBuffer, format) {
  if (format === "stl") {
    return parseStlBuffer(arrayBuffer);
  }

  const occt = await getOcct();
  const fileBytes = new Uint8Array(arrayBuffer);
  const result =
    format === "iges" ? occt.ReadIgesFile(fileBytes) : occt.ReadStepFile(fileBytes);

  if (!result.success) {
    throw new Error(`OCCT failed to parse ${format.toUpperCase()} file`);
  }

  let positions = [];
  let indices = [];
  let indexOffset = 0;
  for (const meshData of result.meshes) {
    positions = positions.concat(Array.from(meshData.attributes.position.array));
    const idx = Array.from(meshData.index.array).map((i) => i + indexOffset);
    indices = indices.concat(idx);
    indexOffset += meshData.attributes.position.array.length / 3;
  }

  const { volume_mm3, surface_area_mm2 } = meshVolumeAndArea(positions, indices);
  const bbox = boundingBox(positions);

  return { volume_mm3, surface_area_mm2, bbox, mesh: { positions, indices } };
}

function parseStlBuffer(arrayBuffer) {
  const buffer = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);

  const header = new TextDecoder().decode(bytes.slice(0, 5)).toLowerCase();
  const isAscii = header === "solid" && !looksBinary(buffer, arrayBuffer.byteLength);

  const positions = [];
  const indices = [];

  if (isAscii) {
    const text = new TextDecoder().decode(bytes);
    const vertexRe = /vertex\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)/g;
    let match;
    let idx = 0;
    while ((match = vertexRe.exec(text)) !== null) {
      positions.push(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]));
      indices.push(idx++);
    }
  } else {
    const triCount = buffer.getUint32(80, true);
    let offset = 84;
    let idx = 0;
    for (let t = 0; t < triCount; t++) {
      offset += 12; // skip normal
      for (let v = 0; v < 3; v++) {
        positions.push(
          buffer.getFloat32(offset, true),
          buffer.getFloat32(offset + 4, true),
          buffer.getFloat32(offset + 8, true)
        );
        indices.push(idx++);
        offset += 12;
      }
      offset += 2; // skip attribute byte count
    }
  }

  const { volume_mm3, surface_area_mm2 } = meshVolumeAndArea(positions, indices);
  const bbox = boundingBox(positions);
  return { volume_mm3, surface_area_mm2, bbox, mesh: { positions, indices } };
}

function looksBinary(buffer, byteLength) {
  if (byteLength < 84) return true;
  const triCount = buffer.getUint32(80, true);
  return 84 + triCount * 50 === byteLength;
}
