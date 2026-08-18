/**
 * Estimates filament usage + cost from geometry (volume/surface area from
 * stepParser) plus slicer-style settings, without actually slicing.
 *
 * This is a budgeting estimate, not gcode-accurate. Approach:
 *  - Shell volume = surface_area * wall_count * nozzle_line_width (walls
 *    approximated as a constant-thickness offset shell)
 *  - Interior volume = total volume - shell volume, filled at infill %
 *  - Top/bottom solid layers approximated as a flat % bump on infill
 *    region (kept simple/conservative -- flagged in output as an estimate)
 *  - Support volume = a fraction of the part's bounding-box footprint *
 *    height, scaled by a support-type density factor (tree supports use
 *    less material than grid/normal supports for the same overhang area)
 *  - Interface support volume (e.g. AquaSys touching the part) is split
 *    out of total support volume by an interface fraction the user sets
 *    (e.g. "last 2mm of support" or "touching layers only")
 *  - Brim/skirt/raft are flat-geometry adhesion aids computed from the
 *    part's bed footprint (after rotation) rather than its 3D volume --
 *    they only add material, they don't change the part's own usage.
 */

const SUPPORT_DENSITY_FACTOR = {
  none: 0,
  grid: 0.18,
  tree: 0.09,
  organic: 0.08,
};

/**
 * @param {object} geometry - { volume_mm3, surface_area_mm2, bbox }
 * @param {object} settings
 *   nozzle_line_width_mm, wall_count, infill_percent,
 *   top_bottom_layers, layer_height_mm,
 *   support_type ("none"|"grid"|"tree"|"organic"),
 *   overhang_fraction (0-1), interface_fraction (0-1),
 *   shrinkage_percent (e.g. 101 => scale dims by 1.01 before calc),
 *   footprint_mm2 (optional -- rotated bed footprint from the 3D viewer;
 *     falls back to bbox.x_mm * bbox.y_mm if not given),
 *   brim_enabled, brim_width_mm, brim_loops,
 *   skirt_enabled, skirt_loops, skirt_distance_mm,
 *   raft_enabled, raft_layers, raft_margin_mm
 * @param {object} materials - { main: {density_g_cm3, price_per_kg}, support: {...}, interface: {...} }
 */
export function calcMaterialUsage(geometry, settings, materials) {
  const shrink = (settings.shrinkage_percent ?? 100) / 100;
  const volume_mm3 = geometry.volume_mm3 * Math.pow(shrink, 3);
  const surface_area_mm2 = geometry.surface_area_mm2 * Math.pow(shrink, 2);

  const lineWidth = settings.nozzle_line_width_mm ?? 0.42;
  const layerHeight = settings.layer_height_mm ?? 0.2;

  const wallThickness = lineWidth * (settings.wall_count ?? 3);
  const shellVolume_mm3 = Math.min(
    surface_area_mm2 * wallThickness,
    volume_mm3 // shell can't exceed total volume on thin parts
  );

  // Top/bottom solid layers add extra shell-density material on the two
  // flat caps beyond what the wall-count shell already covers.
  const bbox = geometry.bbox;
  const footprint_mm2 = settings.footprint_mm2 ?? bbox.x_mm * bbox.y_mm;
  const topBottomLayers = settings.top_bottom_layers ?? 4;
  const topBottomVolume_mm3 = footprint_mm2 * 2 * topBottomLayers * layerHeight;

  const interiorVolume_mm3 = Math.max(volume_mm3 - shellVolume_mm3 - topBottomVolume_mm3, 0);
  const infillFraction = (settings.infill_percent ?? 15) / 100;
  const infillVolume_mm3 = interiorVolume_mm3 * infillFraction;

  const mainPartVolume_mm3 = shellVolume_mm3 + topBottomVolume_mm3 + infillVolume_mm3;

  // --- Supports ---
  const supportType = settings.support_type ?? "none";
  const densityFactor = SUPPORT_DENSITY_FACTOR[supportType] ?? 0;
  const overhangFraction = settings.overhang_fraction ?? 0.25;

  const totalSupportVolume_mm3 =
    footprint_mm2 * bbox.z_mm * densityFactor * overhangFraction;

  const interfaceFraction = settings.interface_fraction ?? 0;
  const interfaceVolume_mm3 = totalSupportVolume_mm3 * interfaceFraction;
  const bulkSupportVolume_mm3 = totalSupportVolume_mm3 - interfaceVolume_mm3;

  // --- Adhesion aids (brim/skirt/raft) -- flat, single-layer-ish extras
  // computed from the footprint perimeter/area, added to the main volume ---
  const perimeter_mm = 2 * (Math.sqrt(footprint_mm2) * 2); // rough square-equivalent perimeter approximation
  let adhesionVolume_mm3 = 0;

  if (settings.brim_enabled) {
    const brimWidth = settings.brim_width_mm ?? (settings.brim_loops ?? 5) * lineWidth;
    adhesionVolume_mm3 += perimeter_mm * brimWidth * layerHeight;
  }
  if (settings.skirt_enabled) {
    const loops = settings.skirt_loops ?? 2;
    adhesionVolume_mm3 += perimeter_mm * loops * lineWidth * layerHeight;
  }
  if (settings.raft_enabled) {
    const raftLayers = settings.raft_layers ?? 3;
    const margin = settings.raft_margin_mm ?? 5;
    const raftFootprint_mm2 = Math.sqrt(footprint_mm2) > 0
      ? Math.pow(Math.sqrt(footprint_mm2) + margin * 2, 2)
      : footprint_mm2;
    adhesionVolume_mm3 += raftFootprint_mm2 * raftLayers * layerHeight;
  }

  const mainVolume_mm3 = mainPartVolume_mm3 + adhesionVolume_mm3;

  const results = {
    main: volumeToUsage(mainVolume_mm3, materials.main),
    support: volumeToUsage(bulkSupportVolume_mm3, materials.support),
    interface:
      interfaceVolume_mm3 > 0 && materials.interface
        ? volumeToUsage(interfaceVolume_mm3, materials.interface)
        : null,
  };

  const total_cost = [results.main, results.support, results.interface]
    .filter(Boolean)
    .reduce((sum, r) => sum + r.cost, 0);

  return {
    shrinkage_applied_percent: settings.shrinkage_percent ?? 100,
    volumes_mm3: {
      total: volume_mm3,
      shell: shellVolume_mm3,
      top_bottom: topBottomVolume_mm3,
      infill: infillVolume_mm3,
      adhesion: adhesionVolume_mm3,
      support_bulk: bulkSupportVolume_mm3,
      support_interface: interfaceVolume_mm3,
    },
    usage: results,
    total_cost,
    note: "Estimate only -- not gcode-accurate. Assumes constant-thickness shell approximation, simplified support density factors, and square-equivalent footprint perimeter for brim/skirt/raft.",
  };
}

function volumeToUsage(volume_mm3, material) {
  if (!material) return { volume_mm3: 0, grams: 0, cost: 0 };
  const volume_cm3 = volume_mm3 / 1000;
  const grams = volume_cm3 * (material.density_g_cm3 ?? 1.24);
  const cost = (grams / 1000) * (material.price_per_kg ?? 0);
  return { volume_mm3, grams, cost };
}

/**
 * @param {object} bbox - original (unrotated) bbox, used as a fallback
 * @param {object} printer
 * @param {number} shrinkagePercent
 * @param {object} [rotatedDims] - {x,y,z} mm dims already computed by the
 *   3D bed viewer for the user's chosen rotation. When given, this is used
 *   directly instead of searching axis permutations, since the user has
 *   picked a specific orientation rather than "any rotation that fits".
 */
export function checkBedFit(bbox, printer, shrinkagePercent = 100, rotatedDims = null) {
  const shrink = shrinkagePercent / 100;

  if (rotatedDims) {
    const dims = {
      x: rotatedDims.x * shrink,
      y: rotatedDims.y * shrink,
      z: rotatedDims.z * shrink,
    };
    const fits = dims.x <= printer.bed_mm.x && dims.y <= printer.bed_mm.y && dims.z <= printer.bed_mm.z;
    return { fits, part_dims_mm: dims, bed_mm: printer.bed_mm };
  }

  const dims = {
    x: bbox.x_mm * shrink,
    y: bbox.y_mm * shrink,
    z: bbox.z_mm * shrink,
  };
  // No explicit rotation given -- check all axis-order permutations to see
  // if *some* orientation would fit.
  const orientations = [
    [dims.x, dims.y, dims.z],
    [dims.x, dims.z, dims.y],
    [dims.y, dims.x, dims.z],
    [dims.y, dims.z, dims.x],
    [dims.z, dims.x, dims.y],
    [dims.z, dims.y, dims.x],
  ];
  const fits = orientations.some(
    ([x, y, z]) =>
      x <= printer.bed_mm.x && y <= printer.bed_mm.y && z <= printer.bed_mm.z
  );
  return { fits, part_dims_mm: dims, bed_mm: printer.bed_mm };
}
