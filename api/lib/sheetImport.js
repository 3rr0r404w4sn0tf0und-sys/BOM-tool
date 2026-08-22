import * as XLSX from "xlsx";

// SheetJS's cell.l.Target returns the hyperlink target exactly as it
// appears in the XLSX file's internal relationships XML -- which means
// a literal "&" in the URL is still XML-escaped as "&amp;" (valid XML,
// but a broken URL once you try to actually request it -- e.g. Mouser
// links with a second query param like "...&mgh=1" come back as
// "...&amp;mgh=1" and fail at the HTTP layer). Decode the handful of
// XML entities that can legally appear in an attribute value before
// this URL ever reaches a scraper.
function decodeXmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Parses an uploaded spreadsheet (.xlsx, .xls, .csv) into BOM sections/items,
// following the fixed column layout the user's BOM sheets use:
//   Column A: item link (cell hyperlink) — its visible text is ignored as a
//             name unless column B is empty, in which case the visible text
//             is used as a fallback name.
//   Column B: item name override — left blank unless the user wants to
//             show something other than the link text as the row's name.
//   Column C: quantity.
//   Column D: always ignored, whatever is in it.
// A row is treated as a SECTION HEADER when column A has text but column C
// (qty) is empty. A row is treated as an ITEM when column C has a qty value.
// Fully blank rows are separators and are skipped.
export function parseSheet(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellHTML: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet || !worksheet["!ref"]) return { sections: [] };

  const range = XLSX.utils.decode_range(worksheet["!ref"]);
  const sections = [];
  let current = null;

  for (let r = range.s.r; r <= range.e.r; r++) {
    const aCell = worksheet[XLSX.utils.encode_cell({ r, c: 0 })]; // link / name fallback
    const bCell = worksheet[XLSX.utils.encode_cell({ r, c: 1 })]; // name override
    const cCell = worksheet[XLSX.utils.encode_cell({ r, c: 2 })]; // qty
    // column D (index 3) is intentionally never read

    const aText = aCell && aCell.v != null ? String(aCell.v).trim() : "";
    const bText = bCell && bCell.v != null ? String(bCell.v).trim() : "";
    const qtyRaw = cCell && cCell.v != null ? cCell.v : null;
    const hasQty = qtyRaw !== null && qtyRaw !== "";

    const rowIsBlank = !aText && !bText && !hasQty;
    if (rowIsBlank) continue; // blank separator row between sections/items

    if (aText && !hasQty) {
      // Section header row: text in A, nothing in C.
      current = { title: aText, items: [] };
      sections.push(current);
      continue;
    }

    if (!current) {
      // Items appeared before any section header -- group them under a
      // default section rather than dropping them.
      current = { title: "Imported Items", items: [] };
      sections.push(current);
    }

    const url = aCell && aCell.l && aCell.l.Target ? decodeXmlEntities(aCell.l.Target) : null;
    const name = bText || aText || url || "Untitled item";
    const qtyNum = hasQty ? Number(qtyRaw) : 1;

    current.items.push({
      name,
      url,
      qty: Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1,
    });
  }

  return { sections: sections.filter((s) => s.items.length > 0) };
}
