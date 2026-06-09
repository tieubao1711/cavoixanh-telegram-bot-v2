const fs = require('fs');
const JSZip = require('jszip');

async function createXlsxBuffer(sheets) {
  const zip = new JSZip();

  zip.file('[Content_Types].xml', buildContentTypes(sheets.length));
  zip.folder('_rels').file('.rels', buildRootRels());
  zip.folder('xl').file('workbook.xml', buildWorkbookXml(sheets));
  zip.folder('xl').folder('_rels').file('workbook.xml.rels', buildWorkbookRels(sheets.length));
  zip.folder('xl').folder('worksheets');

  sheets.forEach((sheet, index) => {
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, buildSheetXml(sheet.rows || []));
  });

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function writeXlsxFile(filePath, sheets) {
  const buffer = await createXlsxBuffer(sheets);
  await fs.promises.writeFile(filePath, buffer);
}

function buildContentTypes(sheetCount) {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheetOverrides}
</Types>`;
}

function buildRootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function buildWorkbookXml(sheets) {
  const sheetEntries = sheets.map((sheet, index) => (
    `<sheet name="${xmlEscape(sheet.name || `Sheet ${index + 1}`)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetEntries}</sheets>
</workbook>`;
}

function buildWorkbookRels(sheetCount) {
  const rels = Array.from({ length: sheetCount }, (_, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function buildSheetXml(rows) {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => buildCellXml(value, colIndex, rowIndex)).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

function buildCellXml(value, colIndex, rowIndex) {
  const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value ?? '')}</t></is></c>`;
}

function columnName(index) {
  let name = '';
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  createXlsxBuffer,
  writeXlsxFile
};
