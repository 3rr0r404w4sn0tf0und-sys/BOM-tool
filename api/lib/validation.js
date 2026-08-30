export function optionalString(value, field, max = 5000) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${field} is too long`);
  return trimmed;
}

export function optionalNumber(value, field, { min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${field} is invalid`);
  return n;
}

export function optionalBoolean(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

export function optionalEnum(value, field, allowed) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

// Sheet row cell values: an array of up to 7 short strings. Nulls/undefined
// entries are allowed (empty cell); anything else must be stringy.
export function optionalSheetData(value, field, maxColumns = 7) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (value.length > maxColumns) throw new Error(`${field} has too many columns`);
  return value.map((cell, i) => {
    if (cell === undefined || cell === null) return "";
    if (typeof cell !== "string") throw new Error(`${field}[${i}] must be a string`);
    if (cell.length > 2000) throw new Error(`${field}[${i}] is too long`);
    return cell;
  });
}
