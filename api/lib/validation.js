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
