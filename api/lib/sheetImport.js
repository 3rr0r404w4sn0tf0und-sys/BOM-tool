import * as XLSX from "xlsx";
import { validateProductUrl } from "./urlValidation.js";

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

    let url = aCell && aCell.l && aCell.l.Target ? decodeXmlEntities(aCell.l.Target) : null;
    if (url) {
      // Validate (and normalize) the hyperlink here, at parse time, rather
      // than leaving it to whenever triggerScrape() happens to run later --
      // that path only *rejects*, it doesn't stop the row from already
      // having been inserted with a raw javascript:/file:/private-network
      // URL sitting in it. A bad link degrades to "no link" for this row
      // instead of failing the whole import.
      try { url = validateProductUrl(url); }
      catch { url = null; }
    }
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

// Builds a .xlsx buffer in the same fixed column layout parseSheet() reads:
//   A: item link -- the URL itself as the cell's visible text, also set as
//      a real hyperlink. Blank when the item has no URL.
//   B: item name
//   C: quantity
//   D: left blank (ignored on import)
// A section becomes a header row (text in A, nothing in C) followed by its
// item rows, with a blank separator row after each section -- so a BOM
// with multiple sections exports as multiple clearly-divided tables, and
// re-imports unchanged via POST /:bomId/import-sheet.
export function buildSheetFromBom(bom) {
  const rows = [];
  const merges = [];
  for (const section of bom.sections || []) {
    merges.push({ s: { r: rows.length, c: 0 }, e: { r: rows.length, c: 3 } });
    rows.push([section.title || "Untitled Section", "", "", ""]);
    for (const item of section.items || []) {
      rows.push([item.url || "", item.name || "", Number(item.qty) || 1, ""]);
    }
    rows.push(["", "", "", ""]); // blank separator row between sections
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows.length ? rows : [["", "", "", ""]]);
  worksheet["!cols"] = [{ wch: 48 }, { wch: 24 }, { wch: 10 }, { wch: 10 }];
  if (merges.length) worksheet["!merges"] = merges;

  // Attach real hyperlinks to column A for item rows that have a URL, on
  // top of the plain-text URL already in the cell value, mirroring the
  // cell.l.Target shape parseSheet() reads back on import.
  let r = 0;
  for (const section of bom.sections || []) {
    r += 1; // header row, no link
    for (const item of section.items || []) {
      if (item.url) {
        const cellRef = XLSX.utils.encode_cell({ r, c: 0 });
        const cell = worksheet[cellRef];
        if (cell) cell.l = { Target: item.url };
      }
      r += 1;
    }
    r += 1; // separator row
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "BOM");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
