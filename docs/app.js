/* Plain scripts and local assets keep this application usable through file://. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const number = value => value.toLocaleString("nb-NO");
  const state = { tab: "search", page: 1, results: [], selected: "", branch: "", decoded: [], childLimits: new Map() };
  const pageSize = 40;
  let catalogue, searchTimer, toastTimer;
  const button = (label, attribute, value, className = "term-link") => `<button type="button" class="${className}" ${attribute}="${escape(value)}">${label}</button>`;
  const termLink = term => term ? button(escape(term.name), "data-term", term.code) : "";
  const codePill = code => `<span class="code-pill">${escape(code)}</span>`;

  function toast(message) {
    $("toast").textContent = message;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3500);
  }

  async function copy(text) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
    } catch {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.append(input);
      const previous = document.activeElement;
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      previous?.focus();
      if (!copied) { toast("Nettleseren tillot ikke kopiering. Marker teksten og kopier manuelt."); return; }
    }
    toast("Kopiert til utklippstavlen");
  }

  function setHash(key, value) {
    const hash = new URLSearchParams({ [key]: value }).toString();
    try { history.replaceState(null, "", `#${hash}`); } catch { /* Some file:// browsers restrict history. */ }
  }

  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".panel").forEach(panel => { panel.hidden = panel.id !== `panel-${tab}`; });
    document.querySelectorAll("[data-tab]").forEach(b => {
      if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
  }

  function highlighted(text) {
    const words = MTX.tokens($("query").value).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!words.length) return escape(text);
    // Match against a folded copy but render the original text, including accents.
    const original = String(text), folded = MTX.normalize(original);
    if (original.length !== folded.length) return escape(original);
    const ranges = [];
    for (const word of words) {
      let from = 0, index;
      while ((index = folded.indexOf(word, from)) !== -1) {
        ranges.push([index, index + word.length]);
        from = index + word.length;
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push(range);
    }
    let output = "", start = 0;
    for (const [a, b] of merged) { output += escape(original.slice(start, a)) + `<mark>${escape(original.slice(a, b))}</mark>`; start = b; }
    return output + escape(original.slice(start));
  }

  function noteHtml(note) {
    return String(note || "").split("£").map(part => {
      const value = part.trim();
      if (/^https?:\/\/\S/i.test(value)) {
        return `<a class="source-link" href="${escape(value)}" target="_blank" rel="noopener noreferrer">↗ ${escape(value)}</a>`;
      }
      return value ? `<div class="scope-note">${escape(value)}</div>` : "";
    }).join("");
  }

  function performSearch(resetPage = true, interpret = false) {
    clearTimeout(searchTimer);
    const query = $("query").value.trim();
    if (interpret && (query.includes("#") || /^F\d{2}\s*\./i.test(query))) {
      $("decode-input").value = query;
      $("query").value = query.includes("#") ? query.split("#")[0] : "";
      performSearch();
      decode();
      return;
    }
    if (resetPage) state.page = 1;
    state.results = catalogue.search(query, {
      hierarchy: $("hierarchy").value, type: $("term-type").value,
      status: $("status").value, branch: state.branch, sort: $("sort").value
    });
    renderResults();
    renderBrowser();
  }

  function renderResults() {
    $("result-count").textContent = `${number(state.results.length)} treff`;
    $("export-search").disabled = !state.results.length;
    const pages = Math.max(1, Math.ceil(state.results.length / pageSize));
    state.page = Math.min(state.page, pages);
    const terms = state.results.slice((state.page - 1) * pageSize, state.page * pageSize);
    $("results").innerHTML = terms.length ? terms.map(t => {
      const aliases = [...(t.attributes.A01 || []), ...(t.attributes.A02 || [])].join(" · ");
      return `<article class="result-card${t.code === state.selected ? " selected" : ""}"><button type="button" class="result-button" data-term="${escape(t.code)}" aria-label="Vis ${escape(t.code)}: ${escape(t.name)}" ${t.code === state.selected ? 'aria-pressed="true"' : 'aria-pressed="false"'}><div class="result-top">${codePill(t.code)}<span class="type-tag">${escape(MTX.typeNames[t.type] || t.type)} ${catalogue.expired(t) ? '<span class="badge expired">Utgått</span>' : ""}</span></div><h3>${highlighted(t.name)}</h3><p class="result-note">${highlighted(t.note.split("£")[0])}</p>${aliases ? `<p class="result-attrs">${highlighted(aliases)}</p>` : ""}</button></article>`;
    }).join("") : '<div class="empty-state"><h3>Ingen treff</h3><p>Prøv færre søkeord, et engelsk navn eller fjern et filter.</p></div>';
    $("pagination").innerHTML = state.results.length ? `<button type="button" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>← Forrige</button><span>Side ${number(state.page)} av ${number(pages)}</span><button type="button" data-page="${state.page + 1}" ${state.page >= pages ? "disabled" : ""}>Neste →</button>` : "";
  }

  function renderBrowser() {
    const h = $("hierarchy").value;
    $("branch-banner").hidden = !state.branch;
    if (state.branch) {
      const term = catalogue.byCode.get(state.branch);
      $("branch-banner").innerHTML = `Søker i grenen <strong>${escape(term?.name || state.branch)}</strong>, inkludert alle undertermer. ${button("Fjern avgrensning ×", "data-clear-branch", "true", "quiet")}`;
    }
    $("hierarchy-browser").hidden = !h;
    if (!h) return;
    const parent = state.branch ? catalogue.byCode.get(state.branch) : null;
    const children = parent ? catalogue.getChildren(h, parent.code) : catalogue.roots(h);
    const path = parent ? catalogue.path(parent, h) : [];
    $("hierarchy-browser").innerHTML = `<details ${state.branch ? "open" : ""}><summary>Bla i ${escape(catalogue.hierarchyMap.get(h)?.label || h)} · ${number(children.length)} ${parent ? "undertermer" : "rottermer"}</summary>${parent ? `<div class="breadcrumb">${button("Rot", "data-clear-branch", "true")} <span>›</span> ${path.map(t => button(escape(t.name), "data-branch", `${h}|${t.code}`)).join('<span>›</span>')}</div>` : ""}<div class="root-links">${children.slice(0, 150).map(t => button(`${codePill(t.code)} ${escape(t.name)}`, "data-branch", `${h}|${t.code}`, "")).join("")}</div>${children.length > 150 ? '<p class="small muted">De første 150 vises her. Alle er tilgjengelige i søkeresultatene.</p>' : ""}</details>`;
  }

  function implicitHtml(term) {
    const rows = catalogue.implicit(term);
    return rows.length ? rows.map(f => `<div class="implicit-row"><strong>${escape(f.facetCode)} · ${escape(f.facet?.label || "Ukjent fasett")}</strong>${f.term ? termLink(f.term) : escape(f.termCode)} <code>${escape(f.raw)}</code></div>`).join("") : '<p class="small muted">Ingen implisitte fasetter oppgitt i katalogen.</p>';
  }

  function showTerm(code, scroll = true) {
    const term = catalogue.byCode.get(code);
    if (!term) { toast(`Ukjent term: ${code}`); return; }
    state.selected = code;
    showTab("search");
    setHash("term", code);
    renderResults();
    const facetChoices = term.assignments.map(a => catalogue.facetByHierarchy.get(a.hierarchyCode)).filter(Boolean);
    const actions = [...new Map(facetChoices.map(f => [f.code, f])).values()].map(f => button(`Legg til ${escape(f.code)} · ${escape(f.label)}`, "data-add-facet", `${f.code}.${code}`, ""));
    const v = term.version;
    $("term-detail").innerHTML = `<div class="detail-header"><div class="result-top">${codePill(code)}<span class="type-tag">${escape(MTX.typeNames[term.type] || term.type)}</span></div><h2>${escape(term.name)}</h2><span class="badge ${catalogue.expired(term) ? "expired" : ""}">${catalogue.expired(term) ? "Utgått" : escape(v.status || "Status ikke oppgitt")}</span>${v.validTo ? `<span class="badge expired">Gyldig til ${escape(v.validTo.slice(0, 10))}</span>` : ""}<div class="detail-actions">${button("Kopier kode", "data-copy", code, "")}${button("Kopier lenke", "data-copy-link", code, "")}${button("Bruk som grunnkode", "data-use-base", code, "")}${actions.join("")}</div></div>
      <div class="detail-body"><h3>Beskrivelse</h3>${noteHtml(term.note) || '<p class="muted small">Ingen beskrivelse oppgitt.</p>'}
      <h3>Implisitte fasetter</h3><p class="small muted">Egenskaper oppgitt for termen i katalogen (allFacets / implicitFacets).</p>${implicitHtml(term)}
      <h3>Plassering i hierarkier</h3>${term.assignments.map(a => {
        const hierarchy = catalogue.hierarchyMap.get(a.hierarchyCode);
        const path = catalogue.path(term, a.hierarchyCode);
        const children = catalogue.getChildren(a.hierarchyCode, code).filter(t => t.code !== code);
        const limit = state.childLimits.get(`${a.hierarchyCode}:${code}`) || 30;
        return `<div class="path-block"><div class="path-heading"><strong>${escape(hierarchy?.label || a.hierarchyCode)}</strong><span class="badge">${a.reportable === "true" ? "Rapporterbar" : "Ikke rapporterbar"}</span></div><div class="breadcrumb">${path.map(t => t.code === code ? escape(t.name) : termLink(t)).join('<span>›</span>')}</div><div class="detail-actions">${button("Søk i denne grenen", "data-branch", `${a.hierarchyCode}|${code}`, "")}</div>${children.length ? `<details><summary class="small">${number(children.length)} direkte undertermer</summary><div class="children-list">${children.slice(0, limit).map(t => button(`${codePill(t.code)} ${escape(t.name)}`, "data-term", t.code, "")).join("")}</div>${children.length > limit ? button("Vis alle undertermer", "data-all-children", `${a.hierarchyCode}:${code}`, "quiet") : ""}</details>` : ""}</div>`;
      }).join("")}
      <h3>Attributter og alternative navn</h3><table class="data-table"><tbody>${Object.entries(term.attributes).map(([key, values]) => `<tr><th scope="row" title="${escape(catalogue.attributes.get(key)?.scopeNote || "")}">${escape(catalogue.attributes.get(key)?.label || key)}<br><code>${escape(key)}</code></th><td>${values.map(value => /^(?:[A-Z0-9]{5}#|F\d{2}\.)/.test(value) ? button(escape(value), "data-example", value) : escape(value)).join("<br>")}</td></tr>`).join("")}${Object.entries(term.extra).map(([key, value]) => `<tr><th scope="row">${escape(key)}</th><td>${escape(value)}</td></tr>`).join("")}</tbody></table>
      <h3>Termversjon</h3><table class="data-table"><tbody>${Object.entries(v).map(([key, value]) => `<tr><th scope="row">${escape({ version: "Versjon", lastUpdate: "Sist oppdatert", validFrom: "Gyldig fra", validTo: "Gyldig til", status: "Status" }[key] || key)}</th><td>${escape(value)}</td></tr>`).join("")}</tbody></table></div>`;
    if (scroll && window.matchMedia("(max-width: 760px)").matches) $("term-detail").scrollIntoView({ block: "start" });
    $("term-detail").scrollTop = 0;
  }

  function decode() {
    const lines = $("decode-input").value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    state.decoded = lines.map(line => catalogue.decode(line));
    showTab("decode");
    $("decode-count").textContent = lines.length ? `${number(lines.length)} ${lines.length === 1 ? "kode" : "koder"} tolket` : "";
    $("export-decode").disabled = !lines.length;
    if (lines.length === 1) setHash("decode", lines[0]);
    $("decoded-results").innerHTML = lines.length ? state.decoded.map((d, i) => {
      const parts = [];
      if (d.base) parts.push({ heading: "Grunnkode", code: d.base.code, term: d.base });
      parts.push(...d.facets.map(f => ({ heading: `${f.facetCode} · ${f.facet?.label || "Ukjent fasett"}`, code: f.raw, term: f.term, facet: f.facet })));
      return `<article class="decoded-card"><div class="decoded-heading"><code>${escape(d.code)}</code>${button("Kopier tolkning", "data-copy-decode", i, "quiet")}</div><p class="decoded-summary">${escape(d.summary || "Koden kunne ikke tolkes.")}</p>
      ${d.errors.length ? `<div class="notice error"><strong>Problemer med koden</strong><ul>${d.errors.map(e => `<li>${escape(e)}</li>`).join("")}</ul></div>` : '<span class="badge">Alle kodedeler funnet i katalogen</span>'}
      ${d.warnings.length ? `<div class="notice warning">${d.warnings.map(w => `<p>${escape(w)}</p>`).join("")}</div>` : ""}
      <div class="decoded-parts">${parts.map(p => `<section class="part-card"><p class="eyebrow">${escape(p.heading)}</p>${codePill(p.code)}<h3>${p.term ? termLink(p.term) : "Ukjent term"}</h3>${p.term ? `<p>${escape(p.term.note.split("£")[0])}</p>` : ""}${p.facet ? `<details><summary>Hva beskriver denne fasetten?</summary><p>${escape(p.facet.scopeNote)}</p></details>` : ""}</section>`).join("")}</div>
      ${d.base ? `<details><summary>Vis grunnkodens implisitte fasetter (separat fra oppgitt kode)</summary><p class="small muted">Dette er katalogens innebygde egenskaper. De er ikke automatisk slått sammen med dine fasetter.</p>${implicitHtml(d.base)}</details>` : ""}</article>`;
    }).join("") : '<div class="empty-state"><h3>Legg inn en kode for å starte</h3><p>Du kan også bruke eksempelknappen over.</p></div>';
  }

  function decodedText(d) {
    return [d.code, d.summary, ...d.errors.map(e => `FEIL: ${e}`), ...d.warnings.map(w => `MERKNAD: ${w}`)].join("\n");
  }

  function renderFacets() {
    const words = MTX.tokens($("facet-query").value);
    const facets = catalogue.facets.filter(f => words.every(w => MTX.normalize(`${f.code} ${f.name} ${f.label} ${f.scopeNote}`).includes(w)));
    $("facet-list").innerHTML = facets.length ? facets.map(f => {
      const h = catalogue.facetHierarchy(f), count = catalogue.members.get(h)?.size || 0;
      return `<article class="facet-card">${codePill(f.code)}<h3>${escape(f.label)}</h3><p>${escape(f.scopeNote)}</p><p class="facet-rule">XML: ${f.attributeSingleOrRepeatable === "repeatable" ? "repeatable" : "single"} · ${number(count)} termer</p>${button("Utforsk fasetten →", "data-facet-hierarchy", h, "")}</article>`;
    }).join("") : '<div class="empty-state"><h3>Ingen fasetter funnet</h3><p>Prøv en fasettkode eller et engelsk navn.</p></div>';
  }

  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadCsv(filename, rows) {
    const blob = new Blob(["\ufeff", rows.map(row => row.map(csvCell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${number(rows.length - 1)} rader eksportert`);
  }

  function resetFilters() {
    state.branch = "";
    $("hierarchy").value = ""; $("term-type").value = ""; $("status").value = "all";
  }

  function navigateHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has("term")) showTerm(params.get("term").toUpperCase());
    else if (params.has("decode")) { $("decode-input").value = params.get("decode"); decode(); }
    else if (params.has("q")) { $("query").value = params.get("q"); performSearch(true, true); }
  }

  function registerEvents() {
    $("search-form").addEventListener("submit", e => {
      e.preventDefault(); performSearch(true, true);
      if (state.tab === "search") {
        const exact = catalogue.byCode.get($("query").value.trim().toUpperCase());
        if (exact) showTerm(exact.code);
        else setHash("q", $("query").value);
      }
    });
    $("query").addEventListener("input", e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => performSearch(true, e.inputType === "insertFromPaste"), 180);
    });
    ["hierarchy", "term-type", "status", "sort"].forEach(id => $(id).addEventListener("change", () => {
      if (id === "hierarchy") state.branch = "";
      performSearch();
    }));
    $("reset").addEventListener("click", () => { resetFilters(); $("query").value = ""; $("sort").value = "relevance"; performSearch(); });
    $("decode-form").addEventListener("submit", e => { e.preventDefault(); decode(); });
    $("decode-examples").addEventListener("click", () => { $("decode-input").value = "A0C60#F02.A069M$F01.A04ZN\nA01QS#F01.A04YE"; decode(); });
    $("facet-query").addEventListener("input", renderFacets);
    $("export-search").addEventListener("click", () => downloadCsv("mtx-sokeresultater.csv", [
      ["Kode", "Navn", "Beskrivelse", "Type", "Status", "Gyldig til", "Vitenskapelige navn", "Alternative navn", "Hierarkier", "Implisitte fasetter", "Attributter (JSON)"],
      ...state.results.map(t => [t.code, t.name, t.note, MTX.typeNames[t.type] || t.type, t.version.status, t.version.validTo, (t.attributes.A01 || []).join(" | "), (t.attributes.A02 || []).join(" | "), t.assignments.map(a => a.hierarchyCode).join(" | "), catalogue.implicit(t).map(f => `${f.raw}: ${f.term?.name || ""}`).join(" | "), JSON.stringify(t.attributes)])
    ]));
    $("export-decode").addEventListener("click", () => downloadCsv("mtx-kodetolkninger.csv", [
      ["Kode", "Betydning", "Grunnkode", "Grunnkodebeskrivelse", "Fasetter", "Feil", "Merknader"],
      ...state.decoded.map(d => [d.code, d.summary, d.base?.code, d.base?.name, d.facets.map(f => `${f.raw} (${f.facet?.label || "?"}): ${f.term?.name || "?"}`).join(" | "), d.errors.join(" | "), d.warnings.join(" | ")])
    ]));
    document.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      const d = b.dataset;
      if (d.tab) { clearTimeout(searchTimer); showTab(d.tab); }
      if (d.term) showTerm(d.term);
      if (d.copy !== undefined) copy(d.copy);
      if (d.copyLink) { const url = new URL(location.href); url.hash = new URLSearchParams({ term: d.copyLink }).toString(); copy(url.href); }
      if (d.copyDecode !== undefined) copy(decodedText(state.decoded[Number(d.copyDecode)]));
      if (d.query) { resetFilters(); $("query").value = d.query; performSearch(); }
      if (d.example) { clearTimeout(searchTimer); $("decode-input").value = d.example; decode(); }
      if (d.page) { state.page = Number(d.page); renderResults(); $("result-count").scrollIntoView({ block: "start" }); }
      if (d.branch) {
        const [hierarchy, code] = d.branch.split("|");
        resetFilters(); $("hierarchy").value = hierarchy; $("query").value = ""; state.branch = code;
        showTab("search"); performSearch();
      }
      if (d.clearBranch) { state.branch = ""; performSearch(); }
      if (d.facetHierarchy) {
        resetFilters(); $("hierarchy").value = d.facetHierarchy; $("query").value = "";
        showTab("search"); performSearch();
        const details = $("hierarchy-browser").querySelector("details");
        if (details) details.open = true;
      }
      if (d.useBase) { $("decode-input").value = d.useBase; decode(); toast("Grunnkode satt. Finn en fasett i katalogen for å legge til flere egenskaper."); }
      if (d.addFacet) {
        const lines = $("decode-input").value.trim().split(/\r?\n/).filter(Boolean);
        const last = lines[lines.length - 1];
        if (!last || !catalogue.decode(last).base) { toast("Velg «Bruk som grunnkode» på en term først."); return; }
        lines[lines.length - 1] = last + (last.includes("#") ? "$" : "#") + d.addFacet;
        $("decode-input").value = lines.join("\n"); decode();
      }
      if (d.allChildren) {
        state.childLimits.set(d.allChildren, Infinity);
        const scroll = $("term-detail").scrollTop;
        showTerm(state.selected, false);
        $("term-detail").querySelectorAll("details").forEach(detail => { detail.open = true; });
        $("term-detail").scrollTop = scroll;
      }
    });
    document.addEventListener("keydown", e => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        e.preventDefault(); showTab("search"); $("query").focus();
      }
    });
    window.addEventListener("hashchange", navigateHash);
  }

  function start() {
    try {
      if (!window.MTX_DATA || !window.MTX) throw new Error("Datafilen mangler. Kjør python3 build_catalogue.py og sjekk at catalogue-data.js ligger ved siden av index.html.");
      catalogue = new MTX.Catalogue(window.MTX_DATA);
      const data = catalogue.data;
      $("version").textContent = `Versjon ${data.version.version}`;
      $("footer-version").textContent = `· v${data.version.version}`;
      $("statistics").innerHTML = [[data.terms.length, "termer"], [catalogue.facets.length, "fasetter"], [data.hierarchies.length, "hierarkier"]].map(([n, label]) => `<div class="stat"><strong>${number(n)}</strong><span>${label}</span></div>`).join("");
      $("hierarchy").insertAdjacentHTML("beforeend", catalogue.hierarchies.map(h => `<option value="${escape(h.code)}">${escape(h.label)}</option>`).join(""));
      $("term-type").insertAdjacentHTML("beforeend", Object.entries(MTX.typeNames).map(([key, label]) => `<option value="${key}">${label}</option>`).join(""));
      $("source-info").innerHTML = `<p>${escape(data.catalogue.label)} · versjon ${escape(data.version.version)} · gyldig fra ${escape(data.version.validFrom)} · ${escape(data.version.status)}</p><p>Kilde: <code>${escape(data.source.file)}</code><br>SHA-256: <code>${escape(data.source.sha256)}</code></p><p>${number(data.terms.length)} termer, ${number(data.attributes.length)} attributtdefinisjoner og ${number(data.hierarchies.length)} hierarkier. MTX-hovedtreet vises i tillegg.</p>`;
      registerEvents();
      performSearch(); renderFacets(); showTab("search");
      $("loading").hidden = true;
      navigateHash();
    } catch (error) {
      $("loading").className = "notice error";
      $("loading").textContent = `Kunne ikke starte katalogen: ${error.message}`;
      console.error(error);
    }
  }
  // Paint the loading message before building the search index.
  setTimeout(start, 30);
})();
