const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseElectionWorkbook, exportElectionWorkbook } = require('../src/data-service');

const fixture = path.join(__dirname, '..', 'data', 'apuracaocaririocidental.xlsx');

test('interpreta a estrutura eleitoral da planilha fornecida', () => {
  const data = parseElectionWorkbook(fixture);
  assert.equal(data.municipalities.length, 9);
  assert.equal(data.sections.length, 245);
  assert.equal(data.candidates.length, 11);
  assert.deepEqual(data.offices.map((office) => office.id), [
    'presidente',
    'governador',
    'senador',
    'deputado-estadual',
  ]);
  assert.equal(data.municipalities.find((item) => item.name === 'Monteiro').sections, 98);
  assert.equal(new Set(data.sections.map((section) => `${section.municipality}|${section.location}`)).size, 40);
  assert.equal(data.sections.filter((section) => section.status === 'Apurada').length, 0);
});

test('exporta um lançamento e permite reler a cópia', () => {
  const data = parseElectionWorkbook(fixture);
  const section = data.sections[0];
  const candidate = data.candidates[0];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cariri-apuracao-'));
  const output = path.join(tempDir, 'copia.xlsx');

  exportElectionWorkbook(fixture, output, [{
    id: section.id,
    sheetName: section.sheetName,
    rowNumber: section.rowNumber,
    status: 'Apurada',
    votes: { ...section.votes, [candidate.id]: 321 },
  }], data.candidates);

  const exported = parseElectionWorkbook(output);
  const updated = exported.sections.find((item) => item.id === section.id);
  assert.equal(updated.status, 'Apurada');
  assert.equal(updated.votes[candidate.id], 321);
  assert.ok(fs.statSync(output).size > 0);
});
