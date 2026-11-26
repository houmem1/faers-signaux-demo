/*
 * État, filtres, tableau et câblage de l'interface.
 * Une seule rangée de filtres pilote tous les graphiques et le tableau.
 */
(function () {
  "use strict";

  var D = window.FAERS_DATA;
  var S = FAERS.stats, C = FAERS.charts, fmt = FAERS.fmt, el = FAERS.el;
  var $ = function (id) { return document.getElementById(id); };

  if (!D) {
    $("lede").textContent = "Données introuvables : générez data/signals.js avec pipeline/faers_signals.py.";
    return;
  }

  var N = D.meta.N;
  var PAR_PAGE = 25;
  var DIRECT = "Analyse en direct";
  var DEFAUT = { classe: "", mol: "", effet: "", cas: D.meta.min_cas, force: "signal", nc: true, ind: true, grappe: true };
  var etat = Object.assign({}, DEFAUT, { tri: "ic025", sens: -1, page: 0 });

  // ------------------------------------------------------------------ données

  var lignes = [];
  var index = {};          // "molécule|effet" -> ligne

  function ajouterLigne(mi, effet, a, ind) {
    var mol = D.molecules[mi];
    var s = S.disproportionnalite(a, mol.n, effet.m, N);
    if (!s) return;
    s.mi = mi; s.mol = mol.nom; s.cls = mol.classe;
    s.pt = effet.t; s.lib = fmt.libelle(effet.t);
    s.nc = effet.nc; s.g = effet.g || 0; s.ind = ind;
    s.sig = S.force(s);
    lignes.push(s);
    index[mi + "|" + effet.t] = s;
  }

  D.couples.forEach(function (c) { ajouterLigne(c[0], D.effets[c[1]], c[2], c[3]); });

  var RANG = { aucun: 0, faible: 1, modere: 2, fort: 3 };
  var SEUIL = { tous: 0, signal: 1, modere: 2, fort: 3 };

  function passe(r, sansNiveau, sansMolecule) {
    if (!sansMolecule) {
      if (etat.mol !== "" && r.mi !== +etat.mol) return false;
      if (etat.classe && r.cls !== etat.classe) return false;
    }
    if (r.a < etat.cas) return false;
    if (etat.nc && r.nc) return false;
    if (etat.ind && r.ind) return false;
    if (etat.grappe && r.g) return false;
    if (etat.effet && r.pt.indexOf(etat.effet) < 0) return false;
    if (!sansNiveau && RANG[r.sig] < SEUIL[etat.force]) return false;
    return true;
  }

  // ------------------------------------------------------------------ filtres

  function classes() {
    var vues = [];
    D.molecules.forEach(function (m) { if (vues.indexOf(m.classe) < 0) vues.push(m.classe); });
    return vues;
  }

  function remplirSelects() {
    var sc = $("f-classe"), sm = $("f-mol");
    sc.textContent = "";
    sc.appendChild(el("option", { value: "", text: "Toutes les classes" }));
    classes().forEach(function (c) { sc.appendChild(el("option", { value: c, text: c })); });
    sc.value = etat.classe;

    sm.textContent = "";
    sm.appendChild(el("option", { value: "", text: etat.classe ? "Toutes (" + etat.classe + ")" : "Toutes les molécules" }));
    classes().forEach(function (c) {
      if (etat.classe && c !== etat.classe) return;
      var grp = el("optgroup", { label: c });
      D.molecules.forEach(function (m, i) {
        if (m.classe === c) grp.appendChild(el("option", { value: String(i), text: m.nom }));
      });
      sm.appendChild(grp);
    });
    sm.value = etat.mol;
  }

  function lireFiltres() {
    etat.effet = $("f-effet").value.trim().toUpperCase();
    etat.cas = Math.max(3, parseInt($("f-cas").value, 10) || D.meta.min_cas);
    etat.force = $("f-force").value;
    etat.nc = $("f-nc").checked;
    etat.ind = $("f-ind").checked;
    etat.grappe = $("f-grappe").checked;
    etat.page = 0;
  }

  function ecrireFiltres() {
    $("f-effet").value = etat.effet;
    $("f-cas").value = etat.cas;
    $("f-force").value = etat.force;
    $("f-nc").checked = etat.nc;
    $("f-ind").checked = etat.ind;
    $("f-grappe").checked = etat.grappe;
    remplirSelects();
  }

  function choisirMolecule(i) {
    etat.mol = String(i);
    etat.classe = D.molecules[i].classe;
    etat.page = 0;
    remplirSelects();
    rendre();
    $("filters").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // --------------------------------------------------------------------- KPI

  function kpi(label, valeur, aide) {
    return el("div", { class: "kpi" }, [
      el("div", { class: "label", text: label }),
      el("div", { class: "value", text: valeur }),
      el("div", { class: "hint", text: aide })
    ]);
  }

  function rendreKpis(evalues, vus) {
    var host = $("kpis");
    host.textContent = "";
    var nSig = 0, nFort = 0;
    evalues.forEach(function (r) { if (r.sig !== "aucun") nSig++; if (r.sig === "fort") nFort++; });
    if (etat.mol !== "") {
      var m = D.molecules[+etat.mol];
      host.appendChild(kpi("Déclarations · " + m.nom, fmt.entier(m.n), fmt.dec2(100 * m.n / N) + " % de la base analysée"));
    } else {
      host.appendChild(kpi("Déclarations analysées", fmt.compact(N), "sur " + fmt.compact(D.meta.base_complete) + " dans FAERS"));
    }
    host.appendChild(kpi("Couples évalués", fmt.entier(evalues.length), "molécule × effet, après exclusions"));
    host.appendChild(kpi("Signaux retenus", fmt.entier(nSig),
      evalues.length ? fmt.entier(100 * nSig / evalues.length) + " % des couples évalués" : "—"));
    host.appendChild(kpi("Signaux forts", fmt.entier(nFort), "borne basse de l'IC ≥ 3"));
    $("table-count").textContent = fmt.entier(vus.length) + " couple" + (vus.length > 1 ? "s" : "") + " affiché" + (vus.length > 1 ? "s" : "") + " selon les filtres.";
  }

  // ----------------------------------------------------------------- matrice

  function modeleMatrice() {
    var mols = [];
    var classe = etat.mol !== "" ? D.molecules[+etat.mol].classe : etat.classe;
    // une molécule analysée en direct se compare à tout le panel
    if (classe === DIRECT) classe = "";
    D.molecules.forEach(function (m, i) {
      var actif = etat.mol !== "" && +etat.mol === i;
      if (m.classe === DIRECT && !actif && etat.classe !== DIRECT) return;
      if (!classe || m.classe === classe) mols[actif && m.classe === DIRECT ? "unshift" : "push"]({ idx: i, nom: m.nom, actif: actif });
    });
        // lignes : effets des signaux les plus marqués de la sélection courante
    var effets = [];
    vusCourants.filter(function (r) { return r.sig !== "aucun"; })
      .sort(function (x, y) { return y.ic025 - x.ic025; })
      .some(function (r) {
        if (effets.indexOf(r.pt) < 0) effets.push(r.pt);
        return effets.length >= 16;
      });

    $("heat-title").textContent = etat.mol !== ""
      ? "Effet propre à la molécule ou effet de classe ?"
      : "Comparaison entre molécules" + (classe ? " · " + classe : "");
    return { mols: mols, effets: effets, couple: function (mi, pt) { return index[mi + "|" + pt] || null; } };
  }

  // ----------------------------------------------------------------- tableau

  var COLONNES = [
    { cle: "mol", titre: "Molécule" },
    { cle: "lib", titre: "Effet indésirable" },
    { cle: "a", titre: "Cas", num: true },
    { cle: "attendu", titre: "Attendus", num: true },
    { cle: "prr", titre: "PRR", num: true },
    { cle: "ror", titre: "ROR [IC 95 %]", num: true },
    { cle: "chi2", titre: "χ²", num: true },
    { cle: "ic025", titre: "IC025", num: true },
    { cle: "sig", titre: "Niveau" }
  ];

  function rendreEntete() {
    var tr = el("tr");
    COLONNES.forEach(function (c) {
      var actif = etat.tri === c.cle;
      var b = el("button", { type: "button" }, [
        el("span", { text: c.titre }),
        el("span", { class: "arrow", text: actif ? (etat.sens < 0 ? "↓" : "↑") : "" })
      ]);
      b.addEventListener("click", function () {
        if (etat.tri === c.cle) etat.sens = -etat.sens;
        else { etat.tri = c.cle; etat.sens = (c.cle === "mol" || c.cle === "lib") ? 1 : -1; }
        etat.page = 0;
        rendre();
      });
      var th = el("th", { class: c.num ? "num" : "", scope: "col" }, [b]);
      if (actif) th.setAttribute("aria-sort", etat.sens < 0 ? "descending" : "ascending");
      tr.appendChild(th);
    });
    var thead = $("table").querySelector("thead");
    thead.textContent = "";
    thead.appendChild(tr);
  }

  function trier(liste) {
    var k = etat.tri, s = etat.sens;
    return liste.slice().sort(function (x, y) {
      var a = k === "sig" ? RANG[x.sig] * 100 + x.ic025 : x[k];
      var b = k === "sig" ? RANG[y.sig] * 100 + y.ic025 : y[k];
      if (typeof a === "string") return s * a.localeCompare(b, "fr");
      return s * (a - b);
    });
  }

  function rendreTableau(vus) {
    rendreEntete();
    var tries = trier(vus);
    var pages = Math.max(1, Math.ceil(tries.length / PAR_PAGE));
    if (etat.page >= pages) etat.page = pages - 1;
    var corps = $("table").querySelector("tbody");
    corps.textContent = "";

    tries.slice(etat.page * PAR_PAGE, (etat.page + 1) * PAR_PAGE).forEach(function (r) {
      var bmol = el("button", { type: "button", class: "mol-btn", text: r.mol, title: "Filtrer sur " + r.mol });
      bmol.addEventListener("click", function () { choisirMolecule(r.mi); });

      var effet = el("td", { class: "effet" }, [el("span", { text: r.lib })]);
      if (r.ind) effet.appendChild(el("span", { class: "tag", text: "indication" }));
      if (r.nc) effet.appendChild(el("span", { class: "tag", text: "non clinique" }));
      if (r.g) effet.appendChild(el("span", { class: "tag", text: "grappe" }));

      corps.appendChild(el("tr", {}, [
        el("td", {}, [bmol, el("span", { class: "cls", text: r.cls })]),
        effet,
        el("td", { class: "num", text: fmt.entier(r.a) }),
        el("td", { class: "num", text: r.attendu >= 10 ? fmt.entier(r.attendu) : fmt.dec1(r.attendu) }),
        el("td", { class: "num", text: fmt.ratio(r.prr) }),
        el("td", { class: "num" }, [
          el("span", { text: fmt.ratio(r.ror) + " " }),
          el("span", { class: "ci", text: "[" + fmt.ratio(r.rorInf) + " – " + fmt.ratio(r.rorSup) + "]" })
        ]),
        el("td", { class: "num", text: fmt.compact(Math.round(r.chi2)) }),
        el("td", { class: "num", text: fmt.dec2(r.ic025) }),
        el("td", {}, [el("span", { class: "badge " + r.sig }, [
          el("span", { class: "bars", "aria-hidden": "true" }, [el("i"), el("i"), el("i")]),
          el("span", { text: FAERS.NOM_NIVEAU[r.sig] })
        ])])
      ]));
    });
    if (!tries.length) {
      corps.appendChild(el("tr", {}, [el("td", { colspan: String(COLONNES.length), class: "empty", text: "Aucun couple ne correspond aux filtres." })]));
    }

    var pager = $("pager");
    pager.textContent = "";
    var prec = el("button", { type: "button", class: "btn", text: "Précédent" });
    var suiv = el("button", { type: "button", class: "btn", text: "Suivant" });
    prec.disabled = etat.page === 0;
    suiv.disabled = etat.page >= pages - 1;
    prec.addEventListener("click", function () { etat.page--; rendreTableau(vus); });
    suiv.addEventListener("click", function () { etat.page++; rendreTableau(vus); });
    pager.appendChild(el("span", { text: "Page " + (etat.page + 1) + " sur " + fmt.entier(pages) }));
    pager.appendChild(prec);
    pager.appendChild(suiv);
  }

  function exporter(vus) {
    var entete = ["molecule", "classe", "effet_meddra_pt", "cas", "attendus", "PRR", "PRR_IC95_inf", "PRR_IC95_sup",
      "ROR", "ROR_IC95_inf", "ROR_IC95_sup", "khi2", "IC", "IC025", "signal", "terme_non_clinique", "indication_probable", "grappe_suspecte"];
    var out = [entete.join(";")];
    trier(vus).forEach(function (r) {
      out.push([r.mol, r.cls, '"' + r.pt.replace(/"/g, '""') + '"', r.a, r.attendu.toFixed(1), r.prr.toFixed(2), r.prrInf.toFixed(2),
        r.prrSup.toFixed(2), r.ror.toFixed(2), r.rorInf.toFixed(2), r.rorSup.toFixed(2), r.chi2.toFixed(1), r.ic.toFixed(2),
        r.ic025.toFixed(2), r.sig, r.nc, r.ind, r.g].join(";"));
    });
    var blob = new Blob(["﻿" + out.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = el("a", { href: URL.createObjectURL(blob), download: "signaux_faers.csv" });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ------------------------------------------------------------------- rendu

  var vusCourants = [];

  function rendreGraphiques() {
    C.legende($("scatter-legend"), vusCourants);
    C.carte($("scatter"), vusCourants, { sansMolecule: etat.mol !== "" });
    var top = vusCourants.filter(function (r) { return r.sig !== "aucun"; })
      .sort(function (a, b) { return b.ic025 - a.ic025; }).slice(0, 15);
    C.intervalles($("forest"), top, { sansMolecule: etat.mol !== "" });
    C.matrice($("heat"), $("heat-scale"), modeleMatrice());
  }

  function rendre() {
    var evalues = lignes.filter(function (r) { return passe(r, true); });
    vusCourants = evalues.filter(function (r) { return RANG[r.sig] >= SEUIL[etat.force]; });
    rendreKpis(evalues, vusCourants);
    rendreGraphiques();
    rendreTableau(vusCourants);
  }

  // ----------------------------------------------------------- analyse directe

  function analyseDirecte() {
    var statut = $("live-status"), bouton = $("live-go");
    var saisie = $("live-nom").value.trim();
    var terme = saisie.toUpperCase();
    statut.className = "status";

    for (var i = 0; i < D.molecules.length; i++) {
      if (D.molecules[i].termes.indexOf(terme) >= 0) {
        statut.textContent = D.molecules[i].nom + " figure déjà dans les données : filtre appliqué.";
        return choisirMolecule(i);
      }
    }

    bouton.disabled = true;
    FAERS.openfda.analyser(saisie, D, function (msg) { statut.textContent = msg; })
      .then(function (res) {
        var mi = D.molecules.length;
        D.molecules.push(res.molecule);
        var parTerme = {};
        D.effets.forEach(function (e) { parTerme[e.t] = e; });
        Object.keys(res.nouvellesMarges).forEach(function (pt) {
          var e = { t: pt, m: res.nouvellesMarges[pt], nc: S.estNonClinique(pt) ? 1 : 0, g: 0 };
          D.effets.push(e);
          parTerme[pt] = e;
        });
        var avant = lignes.length;
        res.effets.forEach(function (c) { ajouterLigne(mi, parTerme[c.pt], c.a, c.ind); });
        var signaux = lignes.slice(avant).filter(function (r) { return r.sig !== "aucun"; }).length;
        statut.textContent = res.molecule.nom + " : " + fmt.entier(res.molecule.n) + " déclarations, " +
          fmt.entier(lignes.length - avant) + " couples évalués, " + fmt.entier(signaux) + " signaux" +
          (res.ignores ? " (" + res.ignores + " effets rares sans fréquence de référence, non évalués)." : ".");
        choisirMolecule(mi);
      })
      .catch(function (err) {
        statut.className = "status erreur";
        statut.textContent = err && err.message === "Failed to fetch"
          ? "openFDA est injoignable depuis ce navigateur. Vérifiez la connexion."
          : (err && err.message) || "L'analyse a échoué.";
      })
      .then(function () { bouton.disabled = false; });
  }

  // ----------------------------------------------------------------- câblage

  $("lede").textContent = fmt.entier(N) + " déclarations spontanées analysées, " + D.molecules.length +
    " molécules, " + fmt.entier(lignes.length) + " couples molécule–effet. Données openFDA mises à jour le " +
    new Date(D.meta.maj_openfda).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) + ".";

  $("method-source").textContent = "FDA Adverse Event Reporting System (FAERS), interrogé par l'API openFDA. " +
    "L'analyse porte sur les " + fmt.entier(N) + " déclarations dont la substance active est renseignée, sur " +
    fmt.entier(D.meta.base_complete) + " au total. Extraction du " +
    new Date(D.meta.genere_le).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) + ".";

  $("f-classe").addEventListener("change", function () {
    etat.classe = this.value;
    if (etat.mol !== "" && etat.classe && D.molecules[+etat.mol].classe !== etat.classe) etat.mol = "";
    if (!etat.classe) etat.mol = "";
    etat.page = 0;
    remplirSelects();
    rendre();
  });
  $("f-mol").addEventListener("change", function () {
    etat.mol = this.value;
    etat.page = 0;
    rendre();
  });
  ["f-force", "f-nc", "f-ind", "f-grappe"].forEach(function (id) {
    $(id).addEventListener("change", function () { lireFiltres(); rendre(); });
  });
  var minuterie;
  ["f-effet", "f-cas"].forEach(function (id) {
    $(id).addEventListener("input", function () {
      clearTimeout(minuterie);
      minuterie = setTimeout(function () { lireFiltres(); rendre(); }, 180);
    });
  });
  $("f-reset").addEventListener("click", function () {
    Object.assign(etat, DEFAUT, { tri: "ic025", sens: -1, page: 0 });
    ecrireFiltres();
    rendre();
  });
  $("export").addEventListener("click", function () { exporter(vusCourants); });
  $("live").addEventListener("submit", analyseDirecte);

  // les graphiques suivent la largeur de leur conteneur et le thème du système
  var largeur = 0, redim;
  new ResizeObserver(function () {
    var w = $("scatter").clientWidth;
    if (w === largeur) return;
    largeur = w;
    clearTimeout(redim);
    redim = setTimeout(rendreGraphiques, 120);
  }).observe($("scatter"));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rendreGraphiques);

  ecrireFiltres();
  rendre();
})();
