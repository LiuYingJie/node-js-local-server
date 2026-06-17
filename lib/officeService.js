const path = require('path');
const mammoth = require('mammoth');
const WordExtractor = require('word-extractor');
const XLSX = require('xlsx');
const sanitizeHtml = require('sanitize-html');
const { Document, Packer, Paragraph, TextRun } = require('docx');

const extractor = new WordExtractor();

function getExt(fileName) {
  return path.extname(fileName || '').slice(1).toLowerCase();
}

function getPreviewType(fileName) {
  const ext = getExt(fileName);
  if (ext === 'txt') return 'text';
  if (ext === 'json') return 'json';
  if (ext === 'docx') return 'docx';
  if (ext === 'doc') return 'doc';
  if (ext === 'xlsx' || ext === 'xls') return 'spreadsheet';
  return null;
}

async function readWordPreview(filePath, previewType) {
  if (previewType === 'docx') {
    const [result, rawText] = await Promise.all([
      mammoth.convertToHtml(
        { path: filePath },
        {
          convertImage: mammoth.images.imgElement(async (image) => ({
            src: `data:${image.contentType};base64,${await image.read('base64')}`,
          })),
        }
      ),
      mammoth.extractRawText({ path: filePath }),
    ]);
    return {
      html: sanitizeHtml(result.value, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
        allowedAttributes: {
          a: ['href', 'name', 'target'],
          img: ['src', 'alt', 'title', 'width', 'height'],
          '*': ['style'],
        },
        allowedSchemes: ['http', 'https', 'data'],
      }),
      text: rawText.value || '',
      messages: result.messages?.map((m) => m.message).filter(Boolean) || [],
    };
  }

  const raw = require('fs').readFileSync(filePath);
  const rawText = raw.toString('utf8');
  if (rawText.startsWith('{\\rtf')) {
    return {
      text: rtfToPlainText(rawText),
      messages: [],
    };
  }

  const doc = await extractor.extract(filePath);
  return {
    text: doc.getBody(),
    messages: [],
  };
}

function escapeRtfText(value) {
  return String(value || '').replace(/[\\{}]/g, (match) => '\\' + match).replace(/\r?\n/g, '\\par ').replace(/[^\x00-\x7F]/g, (char) => {
    const code = char.charCodeAt(0);
    const signed = code > 32767 ? code - 65536 : code;
    return `\\u${signed}?`;
  });
}

function rtfToPlainText(value) {
  return String(value || '')
    .replace(/\{\\fonttbl(?:[^{}]|\{[^{}]*\})*\}/g, '')
    .replace(/^\{\\rtf1[\s\S]*?\\pard\\f\d+\\fs\d+ ?/, '')
    .replace(/\\u(-?\d+)\??/g, (_, code) => {
      let n = Number(code);
      if (n < 0) n += 65536;
      return String.fromCharCode(n);
    })
    .replace(/\\par[d]? ?/g, '\n')
    .replace(/\\'[0-9a-fA-F]{2}/g, '')
    .replace(/\\[a-zA-Z]+\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\([\\{}])/g, '$1')
    .trim();
}

async function writeDocPlainText(filePath, content) {
  const rtf = [
    '{\\rtf1\\ansi\\deff0',
    '{\\fonttbl{\\f0 Microsoft YaHei;}}',
    '\\viewkind4\\uc1\\pard\\f0\\fs22 ',
    escapeRtfText(content),
    '\\par',
    '}',
  ].join('\n');
  await require('fs/promises').writeFile(filePath, rtf, 'utf8');
}

async function writeDocxPlainText(filePath, content) {
  const lines = String(content || '').split(/\r?\n/);
  const doc = new Document({
    sections: [{
      properties: {},
      children: lines.map((line) => new Paragraph({
        children: [new TextRun(line || '')],
      })),
    }],
  });
  const buffer = await Packer.toBuffer(doc);
  await require('fs/promises').writeFile(filePath, buffer);
}

function readSpreadsheetPreview(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheets = workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: true,
    });
    return { name, rows };
  });
  return { sheets };
}

function writeSpreadsheetSheet(filePath, sheetName, rows) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const targetName = sheetName || workbook.SheetNames[0];
  if (!workbook.Sheets[targetName]) {
    throw new Error('工作表不存在');
  }

  const safeRows = Array.isArray(rows)
    ? rows.map((row) => Array.isArray(row) ? row.map((cell) => cell == null ? '' : String(cell)) : [])
    : [];
  workbook.Sheets[targetName] = XLSX.utils.aoa_to_sheet(safeRows);
  XLSX.writeFile(workbook, filePath);
}

module.exports = {
  getPreviewType,
  readWordPreview,
  writeDocPlainText,
  writeDocxPlainText,
  readSpreadsheetPreview,
  writeSpreadsheetSheet,
};
