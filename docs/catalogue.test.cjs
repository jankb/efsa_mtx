const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Catalogue } = require('./catalogue-core.js');

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'catalogue-data.js'), 'utf8'), sandbox);
const catalogue = new Catalogue(sandbox.window.MTX_DATA);

test('the supplied combined codes resolve every component and its facet hierarchy', () => {
  const liver = catalogue.decode('A0C60#F02.A069M$F01.A04ZN');
  assert.equal(liver.errors.length, 0);
  assert.equal(liver.base.name, 'Non-food animal-related matrices');
  assert.equal(liver.facets[0].facet.label, 'Part-nature');
  assert.equal(liver.facets[0].term.name, 'Liver (as part-nature)');
  assert.equal(liver.facets[1].term.name, 'Atlantic halibut (as animal)');
  assert.equal(liver.facets[1].facet.label, 'Source');
  const trout = catalogue.decode('A01QS#F01.A04YE');
  assert.equal(trout.errors.length, 0);
  assert.equal(trout.base.name, 'Animal fresh meat');
  assert.equal(trout.facets[0].term.name, 'Rainbow trout (as animal)');
  assert.match(trout.summary, /Animal fresh meat · Source: Rainbow trout/);
});

test('normalizes case and delimiter whitespace; accepts standalone terms and facets', () => {
  const decoded = catalogue.decode(' a0c60 # f02 . a069m $ f01 . a04zn ');
  assert.equal(decoded.code, 'A0C60#F02.A069M$F01.A04ZN');
  assert.equal(decoded.errors.length, 0);
  assert.equal(catalogue.decode('A04YE').base.name, 'Rainbow trout (as animal)');
  const standalone = catalogue.decode('F01.A04YE');
  assert.equal(standalone.errors.length, 0);
  assert.equal(standalone.base, null);
  assert.equal(standalone.facets.length, 1);
});

test('reports malformed syntax, unknown codes, and wrong facet membership without losing valid parts', () => {
  for (const input of ['', 'not a code', 'A01QS#', 'A01QS##F01.A04YE', 'A01QS#F01.A04YE$', 'A01QS#F01.A04YEjunk', 'ZZZZZ', 'A01QS#F99.A04YE', 'A01QS#F01.ZZZZZ']) {
    assert.ok(catalogue.decode(input).errors.length, input);
  }
  const wrong = catalogue.decode('A01QS#F02.A04YE$F01.A04ZN');
  assert.ok(wrong.errors.some(e => e.includes('tilhører ikke F02')));
  assert.equal(wrong.facets[1].term.name, 'Atlantic halibut (as animal)');
  assert.ok(catalogue.decode('A01QS#F01.A04YE$F01.A04YE').warnings.some(w => w.includes('flere ganger')));
});

test('keeps catalogue implicit facets separate from explicit overrides', () => {
  const d = catalogue.decode('A01QS#F01.A04YE');
  const implicit = catalogue.implicit(d.base);
  assert.equal(d.facets.length, 1);
  assert.ok(implicit.some(f => f.raw === 'F01.A04SF'));
  assert.ok(implicit.some(f => f.raw === 'F02.A069H'));
  assert.equal(catalogue.implicit(catalogue.byCode.get('A0C60')).length, 0);
});

test('search covers exact codes, scientific names, aliases, descriptions, facets and multi-word phrases', () => {
  assert.equal(catalogue.search('a04ye')[0].code, 'A04YE');
  assert.ok(catalogue.search('Oncorhynchus mykiss').some(t => t.code === 'A04YE'));
  assert.ok(catalogue.search('"truite arc-en-ciel"').some(t => t.code === 'A04YE'));
  assert.ok(catalogue.search('fletan atlantique').some(t => t.code === 'A04ZN'));
  assert.ok(catalogue.search('glycogen storage').some(t => t.code === 'A069M'));
  assert.ok(catalogue.search('F01 rainbow').some(t => t.code === 'A04YE'));
  const filtered = catalogue.search('liver', { hierarchy: 'part' });
  assert.ok(filtered.some(t => t.code === 'A069M'));
  assert.ok(filtered.every(t => t.assignments.some(a => a.hierarchyCode === 'part')));
  assert.equal(catalogue.search('zzzzznosuchtermzzzzz').length, 0);
});

test('branch navigation includes descendants only and hierarchy paths terminate', () => {
  const term = catalogue.byCode.get('A04YE');
  const parent = catalogue.assignment(term, 'source').parentCode;
  const descendants = catalogue.descendants('source', parent);
  assert.ok(descendants.has(term.code));
  assert.ok(descendants.has(parent));
  assert.ok(!descendants.has('A069M'));
  const path = catalogue.path(term, 'source');
  assert.equal(path.at(-1).code, 'A04YE');
  assert.equal(new Set(path.map(t => t.code)).size, path.length);
  const results = catalogue.search('', { hierarchy: 'source', branch: parent });
  assert.equal(results.length, descendants.size);
  assert.ok(results.every(t => descendants.has(t.code)));
  for (const h of catalogue.hierarchies) {
    assert.ok(catalogue.roots(h.code).length, `Hierarchy ${h.code} has discoverable roots`);
  }
});

test('expired terms remain available, can be filtered, and are marked in decoding', () => {
  const expired = catalogue.search('', { status: 'expired' });
  assert.ok(expired.length);
  assert.ok(expired.every(t => catalogue.expired(t)));
  const current = catalogue.search('', { status: 'current' });
  assert.equal(expired.length + current.length, catalogue.data.terms.length);
  assert.ok(catalogue.decode(expired[0].code).warnings.some(w => w.includes('utgått')));
});

test('reportability depends on the reporting hierarchy, not the master tree', () => {
  assert.equal(catalogue.defaultReportingHierarchy, 'report');
  const liver = catalogue.decode('A0C60#F02.A069M$F01.A04ZN');
  assert.equal(catalogue.reportability(liver).status, 'yes');
  assert.equal(catalogue.reportability(liver, 'vetdrug').status, 'yes');
  const trout = catalogue.decode('A01QS#F01.A04YE');
  assert.equal(catalogue.reportability(trout, 'report').status, 'no');
  assert.equal(catalogue.reportability(trout, 'biomo').status, 'yes');
  assert.notEqual(catalogue.reportability(trout, 'MTX').status, 'yes');
  assert.ok(!catalogue.reportingHierarchies.some(h => ['MTX', 'source', 'pest', 'feedAddExpo'].includes(h.code)));
});

test('non-reportable flags, malformed codes and standalone facets block reporting', () => {
  const base = catalogue.reportability(catalogue.decode('A033A'));
  assert.equal(base.status, 'no');
  assert.ok(base.checks.some(c => c.message.includes('reportable=false')));
  const facet = catalogue.reportability(catalogue.decode('A0C60#F01.A053A'));
  assert.equal(facet.status, 'no');
  assert.ok(facet.checks.some(c => c.message.includes('F01.A053A') && c.message.includes('reportable=false')));
  for (const input of ['A0C60#F02.A04YE', 'ZZZZZ', 'A0C60#', 'F01.A04YE', 'A069M']) {
    assert.equal(catalogue.reportability(catalogue.decode(input)).status, 'no', input);
  }
  assert.equal(catalogue.reportability(catalogue.decode('A0C60#F01.A04YE$F01.A04ZN')).status, 'unknown');
});

test('missing flags and term validity never produce a positive reportability result', () => {
  const source = catalogue.byCode.get('A04YE');
  const check = (version, flag) => {
    const decoded = catalogue.decode('A0C60#F01.A04YE');
    decoded.facets[0].term = { ...source, version: { ...source.version, ...version },
      assignments: source.assignments.map(a => a.hierarchyCode === 'source' ? { ...a, reportable: flag } : a) };
    return catalogue.reportability(decoded);
  };
  assert.equal(check({}, undefined).status, 'unknown');
  assert.equal(check({ validTo: '2000-01-01T00:00:00' }, 'true').status, 'no');
  assert.equal(check({ validFrom: '2999-01-01T00:00:00' }, 'true').status, 'no');
});
