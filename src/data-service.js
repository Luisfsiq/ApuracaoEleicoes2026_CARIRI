const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const SUMMARY_SHEET = 'Resumo por Município';

function cleanText(value) {
  return String(value ?? '').replace(/\r/g, '').trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function normalizeOffice(value) {
  const normalized = normalizeKey(value);
  if (normalized.startsWith('presidente')) return { id: 'presidente', label: 'Presidente' };
  if (normalized.startsWith('governador')) return { id: 'governador', label: 'Governador' };
  if (normalized.startsWith('senador')) return { id: 'senador', label: 'Senador' };
  if (normalized.startsWith('dep-estadual')) return { id: 'deputado-estadual', label: 'Deputado estadual' };
  return { id: normalized || 'outro', label: cleanText(value) || 'Outro cargo' };
}

function candidateFromHeader(header, index) {
  const lines = cleanText(header).split('\n').map((line) => line.trim()).filter(Boolean);
  const office = normalizeOffice(lines.shift());
  const label = lines.join(' ') || `Candidato ${index + 1}`;
  const partyMatch = label.match(/\(([^)]+)\)\s*$/);
  const party = partyMatch ? partyMatch[1] : '';
  const name = partyMatch ? label.slice(0, partyMatch.index).trim() : label;
  return {
    id: `${office.id}-${normalizeKey(label)}`,
    officeId: office.id,
    office: office.label,
    label,
    name,
    party,
    columnIndex: index,
  };
}

function findHeaderRow(rows) {
  return rows.findIndex((row) => cleanText(row[0]) === 'Zona' && cleanText(row[1]) === 'Local de votação');
}

function readWorkbook(filePath) {
  return XLSX.readFile(filePath, {
    cellFormula: true,
    cellStyles: true,
    cellDates: true,
  });
}

function parseElectionWorkbook(filePath) {
  const workbook = readWorkbook(filePath);
  const sheetNames = workbook.SheetNames.filter((name) => name !== SUMMARY_SHEET);
  if (!sheetNames.length) {
    throw new Error('A planilha não possui abas de municípios.');
  }

  let candidates = null;
  const sections = [];
  const municipalities = [];

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    const headerIndex = findHeaderRow(rows);
    if (headerIndex < 0) continue;

    const headers = rows[headerIndex].map(cleanText);
    const totalColumnIndex = headers.findIndex((value) => value.startsWith('Total lançado'));
    const candidateEnd = totalColumnIndex > 5 ? totalColumnIndex : 16;
    const sheetCandidates = headers.slice(5, candidateEnd).map((header, index) => candidateFromHeader(header, index));
    if (!candidates) candidates = sheetCandidates;

    const municipalitySections = [];
    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!cleanText(row[0]) || !cleanText(row[1]) || row[2] === null || row[2] === undefined || row[2] === '') continue;

      const votes = {};
      candidates.forEach((candidate, index) => {
        const value = Number(row[5 + index]);
        votes[candidate.id] = Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
      });

      const section = {
        id: `${normalizeKey(sheetName)}-${normalizeKey(row[0])}-${normalizeKey(row[2])}`,
        municipality: sheetName,
        zone: cleanText(row[0]),
        location: cleanText(row[1]),
        section: cleanText(row[2]),
        registeredAtLocation: Number(row[3]) || 0,
        status: cleanText(row[4]).toLowerCase() === 'apurada' ? 'Apurada' : 'Pendente',
        votes,
        sheetName,
        rowNumber: rowIndex + 1,
      };
      municipalitySections.push(section);
      sections.push(section);
    }

    if (municipalitySections.length) {
      municipalities.push({
        name: sheetName,
        zone: municipalitySections[0].zone,
        locations: new Set(municipalitySections.map((item) => item.location)).size,
        sections: municipalitySections.length,
      });
    }
  }

  if (!candidates || !sections.length) {
    throw new Error('Não foi possível localizar as colunas e seções esperadas na planilha.');
  }

  const offices = [...new Map(candidates.map((candidate) => [candidate.officeId, {
    id: candidate.officeId,
    label: candidate.office,
  }])).values()];

  const sourceStats = fs.statSync(filePath);
  const workbookModifiedAt = workbook.Props?.ModifiedDate instanceof Date
    ? workbook.Props.ModifiedDate
    : sourceStats.mtime;
  return {
    source: {
      name: path.basename(filePath),
      path: filePath,
      modifiedAt: workbookModifiedAt.toISOString(),
    },
    candidates,
    offices,
    municipalities,
    sections,
  };
}

function exportElectionWorkbook(inputPath, outputPath, edits, candidates) {
  const workbook = readWorkbook(inputPath);

  for (const edit of edits) {
    const sheet = workbook.Sheets[edit.sheetName];
    if (!sheet || !Number.isInteger(edit.rowNumber)) continue;

    const rowIndex = edit.rowNumber - 1;
    const statusAddress = XLSX.utils.encode_cell({ r: rowIndex, c: 4 });
    sheet[statusAddress] = { t: 's', v: edit.status === 'Apurada' ? 'Apurada' : 'Pendente' };

    candidates.forEach((candidate, index) => {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: 5 + index });
      const numericValue = Number(edit.votes?.[candidate.id]);
      sheet[address] = { t: 'n', v: Number.isFinite(numericValue) && numericValue >= 0 ? Math.trunc(numericValue) : 0 };
    });

    const totalColumnIndex = 5 + candidates.length;
    const lastCandidateColumn = XLSX.utils.encode_col(totalColumnIndex - 1);
    const totalAddress = XLSX.utils.encode_cell({ r: rowIndex, c: totalColumnIndex });
    sheet[totalAddress] = { t: 'n', f: `SUM(F${edit.rowNumber}:${lastCandidateColumn}${edit.rowNumber})`, v: 0 };
  }

  workbook.Workbook = workbook.Workbook || {};
  workbook.Workbook.CalcPr = {
    ...(workbook.Workbook.CalcPr || {}),
    calcMode: 'auto',
    fullCalcOnLoad: true,
    forceFullCalc: true,
  };
  workbook.Props = { ...(workbook.Props || {}), ModifiedDate: new Date() };

  XLSX.writeFile(workbook, outputPath, {
    bookType: 'xlsx',
    cellStyles: true,
    compression: true,
  });
}

module.exports = {
  parseElectionWorkbook,
  exportElectionWorkbook,
};
