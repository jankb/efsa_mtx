/* Shared, DOM-independent catalogue lookup and FoodEx2 decoding. */
(function (root) {
  "use strict";
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const tokens = value => (normalize(value).match(/"[^"]+"|\S+/g) || []).map(t => t.replace(/^"|"$/g, ""));
  const facetPattern = /^(F\d{2})\.([A-Z0-9]{5})$/;
  const termPattern = /^[A-Z0-9]{5}$/;
  const typeNames = {
    n: "Naturlig kilde", r: "Råvare", d: "Avledet produkt / ingrediens",
    s: "Sammensatt matvare", c: "Sammensatt matvaregruppe", g: "Bred / blandet gruppe", f: "Fasett"
  };

  class Catalogue {
    constructor(data) {
      this.data = data;
      this.byCode = new Map(data.terms.map(t => [t.code, t]));
      this.attributes = new Map(data.attributes.map(a => [a.code, a]));
      this.facets = data.attributes.filter(a => /^F\d{2}$/.test(a.code)).sort((a, b) => a.code.localeCompare(b.code));
      this.hierarchies = [{ code: "MTX", label: "MTX · Hele katalogtreet", hierarchyApplicability: "master", hierarchyOrder: "0" }, ...data.hierarchies]
        .sort((a, b) => Number(a.hierarchyOrder) - Number(b.hierarchyOrder));
      this.hierarchyMap = new Map(this.hierarchies.map(h => [h.code, h]));
      this.children = new Map();
      this.members = new Map();
      this.facetByHierarchy = new Map(this.facets.map(f => [this.facetHierarchy(f), f]));
      for (const term of data.terms) {
        term.type = term.attributes.termType?.[0] || "";
        for (const a of term.assignments) {
          const key = `${a.hierarchyCode}:${a.parentCode}`;
          if (!this.children.has(key)) this.children.set(key, []);
          this.children.get(key).push(term);
          if (!this.members.has(a.hierarchyCode)) this.members.set(a.hierarchyCode, new Set());
          this.members.get(a.hierarchyCode).add(term.code);
        }
      }
      for (const [key, children] of this.children) {
        const hierarchy = key.split(":")[0];
        children.sort((a, b) => Number(this.assignment(a, hierarchy)?.order || 0) - Number(this.assignment(b, hierarchy)?.order || 0) || a.name.localeCompare(b.name));
      }
      this.index = data.terms.map(term => {
        const related = term.assignments.flatMap(a => {
          const h = this.hierarchyMap.get(a.hierarchyCode);
          const f = this.facetByHierarchy.get(a.hierarchyCode);
          return [a.hierarchyCode, h?.label, h?.name, f?.code];
        });
        const attributeText = Object.entries(term.attributes).flatMap(([code, values]) => {
          const attr = this.attributes.get(code);
          return [code, attr?.label, ...values, ...values.flatMap(value =>
            Array.from(value.matchAll(/F\d{2}\.([A-Z0-9]{5})/g), match => this.byCode.get(match[1])?.name || ""))];
        });
        return { term, text: normalize([term.code, term.name, term.note, ...Object.values(term.extra), ...related, ...attributeText].join(" ")), name: normalize(term.name) };
      });
    }

    facetHierarchy(facet) { return facet?.attributeCatalogueCode?.replace(/^MTX\./, "") || ""; }
    assignment(term, hierarchy) { return term.assignments.find(a => a.hierarchyCode === hierarchy); }
    expired(term) {
      return Boolean(term.version.validTo && term.version.validTo.slice(0, 10) <= new Date().toISOString().slice(0, 10)) || /deprecated|inactive|retired/i.test(term.version.status || "");
    }
    getChildren(hierarchy, code = "root") { return this.children.get(`${hierarchy}:${code}`) || []; }
    roots(hierarchy) {
      return this.data.terms.filter(t => {
        const a = this.assignment(t, hierarchy);
        return a && (a.parentCode === "root" || a.parentCode === t.code || !this.members.get(hierarchy)?.has(a.parentCode));
      }).sort((a, b) => Number(this.assignment(a, hierarchy).order || 0) - Number(this.assignment(b, hierarchy).order || 0));
    }
    path(term, hierarchy) {
      const path = [], visited = new Set();
      let current = term;
      while (current && !visited.has(current.code)) {
        path.unshift(current);
        visited.add(current.code);
        current = this.byCode.get(this.assignment(current, hierarchy)?.parentCode);
      }
      return path;
    }
    descendants(hierarchy, code) {
      const found = new Set(), pending = [code];
      while (pending.length) {
        const next = pending.pop();
        if (found.has(next)) continue;
        found.add(next);
        pending.push(...this.getChildren(hierarchy, next).map(t => t.code));
      }
      return found;
    }

    search(query, { hierarchy = "", type = "", status = "all", branch = "", sort = "relevance" } = {}) {
      const words = tokens(query), q = normalize(query.trim());
      const descendants = branch && hierarchy ? this.descendants(hierarchy, branch) : null;
      const result = [];
      for (const row of this.index) {
        const t = row.term;
        if (hierarchy && !this.members.get(hierarchy)?.has(t.code)) continue;
        if (descendants && !descendants.has(t.code)) continue;
        if (type && t.type !== type) continue;
        if (status === "current" && this.expired(t) || status === "expired" && !this.expired(t)) continue;
        if (!words.every(word => row.text.includes(word))) continue;
        const code = normalize(t.code);
        const score = code === q ? 100 : row.name === q ? 90 : code.startsWith(q) ? 80 : row.name.startsWith(q) ? 60 : words.every(w => row.name.includes(w)) ? 40 : 0;
        result.push({ term: t, score });
      }
      result.sort((a, b) => (sort === "relevance" && q ? b.score - a.score : 0) ||
        (sort === "code" ? a.term.code.localeCompare(b.term.code) : a.term.name.localeCompare(b.term.name)));
      return result.map(r => r.term);
    }

    decode(input) {
      const code = input.trim().toUpperCase().replace(/\s*([#$.])\s*/g, "$1");
      const result = { input, code, base: null, facets: [], errors: [], warnings: [], summary: "" };
      const pieces = code.split("#");
      const standalone = facetPattern.test(code);
      if (!code) { result.errors.push("Skriv inn en kode."); return result; }
      if (!standalone) {
        if (!termPattern.test(pieces[0])) result.errors.push(`Ugyldig grunnkode: ${pieces[0] || "(tom)"}. Forventet fem bokstaver/sifre.`);
        else {
          result.base = this.byCode.get(pieces[0]) || null;
          if (!result.base) result.errors.push(`Ukjent grunnkode: ${pieces[0]}.`);
          else {
            if (this.expired(result.base)) result.warnings.push(`Grunnkoden ${pieces[0]} er utgått.`);
            if (pieces.length > 1 && result.base.type === "f") result.warnings.push("Grunnkoden er registrert som en fasett-term.");
          }
        }
      }
      if (pieces.length > 2) result.errors.push("Koden kan bare inneholde ett # mellom grunnkode og fasetter.");
      const descriptors = standalone ? [code] : pieces.slice(1).flatMap(p => p.split("$"));
      const seen = new Set();
      for (const raw of descriptors) {
        const match = facetPattern.exec(raw);
        if (!match) { result.errors.push(`Ugyldig fasett: ${raw || "(tom)"}. Bruk F01.A04YE og skill fasetter med $.`); continue; }
        const [, facetCode, termCode] = match;
        const facet = this.attributes.get(facetCode), term = this.byCode.get(termCode);
        const row = { raw, facetCode, termCode, facet, term };
        result.facets.push(row);
        if (!facet) result.errors.push(`Ukjent fasett: ${facetCode}.`);
        if (!term) result.errors.push(`Ukjent termkode: ${termCode}.`);
        if (facet && term && !this.members.get(this.facetHierarchy(facet))?.has(termCode))
          result.errors.push(`${termCode} (${term.name}) tilhører ikke ${facetCode} · ${facet.label}.`);
        if (term && this.expired(term)) result.warnings.push(`${termCode} er utgått.`);
        if (seen.has(raw)) result.warnings.push(`Fasetten ${raw} er oppgitt flere ganger.`);
        seen.add(raw);
      }
      result.summary = [result.base?.name, ...result.facets.map(f => `${f.facet?.label || f.facetCode}: ${f.term?.name || f.termCode}`)].filter(Boolean).join(" · ");
      return result;
    }

    implicit(term) {
      const complete = term.attributes.allFacets || [];
      const raw = complete.length ? complete.flatMap(v => v.includes("#") ? v.split("#").slice(1).join("$").split("$") : []) : (term.attributes.implicitFacets || []).flatMap(v => v.split("$"));
      return [...new Set(raw)].filter(v => facetPattern.test(v)).map(v => this.decode(v).facets[0]);
    }
  }
  const api = { Catalogue, normalize, tokens, typeNames };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MTX = api;
})(typeof window === "undefined" ? globalThis : window);
