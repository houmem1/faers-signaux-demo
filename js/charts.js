/*
 * Graphiques : carte des signaux (canvas), intervalles du ROR (SVG),
 * matrice molécule x effet (grille HTML). Sans dépendance externe.
 */
(function (root) {
  "use strict";

  var FAERS = (root.FAERS = root.FAERS || {});
  var SVG = "http://www.w3.org/2000/svg";
  var POLICE = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
  var NIVEAUX = ["aucun", "faible", "modere", "fort"];
  var NOM_NIVEAU = { aucun: "Sans signal", faible: "Faible", modere: "Modéré", fort: "Fort" };

  // ------------------------------------------------------------- utilitaires

  function el(tag, attrs, enfants) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (enfants || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function svg(tag, attrs, texte) {
    var n = document.createElementNS(SVG, tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (texte != null) n.textContent = texte;
    return n;
  }

  function css(nom) {
    return getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
  }

  function theme() {
    return {
      surface: css("--surface"), ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"),
      grid: css("--grid"), axis: css("--axis"),
      aucun: css("--sig-aucun"), faible: css("--sig-faible"), modere: css("--sig-modere"), fort: css("--sig-fort"),
      neg: css("--div-neg"), mid: css("--div-mid"), pos: css("--div-pos")
    };
  }

  var nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  var fmt = {
    entier: function (n) { return nf0.format(n); },
    ratio: function (x) { return x >= 100 ? nf0.format(x) : x >= 10 ? nf1.format(x) : nf2.format(x); },
    dec1: function (x) { return nf1.format(x); },
    dec2: function (x) { return nf2.format(x); },
    compact: function (n) {
      if (n >= 1e6) return nf1.format(n / 1e6).replace(",0", "") + " M";
      if (n >= 1e4) return nf0.format(n / 1e3) + " k";
      return nf0.format(n);
    },
    // Terme MedDRA en casse de phrase, sigles usuels conservés
    libelle: function (pt) {
      var s = pt.charAt(0) + pt.slice(1).toLowerCase();
      return s.replace(/\b(hiv|covid-19|ecg|qt|inr|dna|rna|hla|ige|igg|iga|igm|cd4|b-cell|t-cell|ii|iii|iv)\b/gi,
        function (m) { return /cell/i.test(m) ? m.charAt(0).toUpperCase() + m.slice(1) : m.toUpperCase(); })
        .replace(/\^/g, "'");
    },
    tronque: function (s, max) { return s.length > max ? s.slice(0, Math.max(1, max - 1)).trimEnd() + "…" : s; }
  };

  function hexRgb(h) {
    h = h.replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); });
  }

  function melange(a, b, t) {
    var x = hexRgb(a), y = hexRgb(b);
    return "rgb(" + x.map(function (v, i) { return Math.round(v + (y[i] - v) * t); }).join(",") + ")";
  }

  var IC_MAX = 5;
  function couleurIC(ic, th) {
    var t = Math.min(1, Math.abs(ic) / IC_MAX);
    return melange(th.mid, ic >= 0 ? th.pos : th.neg, 0.12 + 0.88 * t);
  }

  // ----------------------------------------------------------------- tooltip

  var tip = {
    noeud: function () { return document.getElementById("tooltip"); },
    montrer: function (x, y, contenu) {
      var t = tip.noeud();
      t.textContent = "";
      t.appendChild(contenu);
      t.hidden = false;
      var r = t.getBoundingClientRect();
      var gx = x + 14, gy = y + 14;
      if (gx + r.width > innerWidth - 8) gx = x - r.width - 14;
      if (gx < 8) gx = 8;
      if (gy + r.height > innerHeight - 8) gy = y - r.height - 14;
      if (gy < 8) gy = 8;
      t.style.left = gx + "px";
      t.style.top = gy + "px";
    },
    cacher: function () { tip.noeud().hidden = true; }
  };

  function ficheCouple(r) {
    var dl = el("dl");
    function ligne(k, v) { dl.appendChild(el("dt", { text: k })); dl.appendChild(el("dd", { text: v })); }
    ligne("Cas observés", fmt.entier(r.a));
    ligne("Cas attendus", r.attendu >= 10 ? fmt.entier(r.attendu) : fmt.dec1(r.attendu));
    ligne("ROR [IC 95 %]", fmt.ratio(r.ror) + " [" + fmt.ratio(r.rorInf) + " – " + fmt.ratio(r.rorSup) + "]");
    ligne("PRR", fmt.ratio(r.prr));
    ligne("IC (borne basse)", fmt.dec2(r.ic) + " (" + fmt.dec2(r.ic025) + ")");
    ligne("Niveau", NOM_NIVEAU[r.sig]);
    var notes = [];
    if (r.ind) notes.push("indication probable de la molécule");
    if (r.nc) notes.push("terme non clinique");
    if (r.g) notes.push("grappe suspecte de doublons");
    return el("div", {}, [
      el("div", { class: "t-title", text: r.mol }),
      el("div", { class: "t-sub", text: r.lib }),
      dl,
      notes.length ? el("div", { class: "t-note", text: "À interpréter avec réserve : " + notes.join(", ") + "." }) : null
    ]);
  }

  function vide(host, message) {
    host.textContent = "";
    host.appendChild(el("div", { class: "empty", text: message || "Aucun couple ne correspond aux filtres." }));
  }

  // ------------------------------------------------------ carte des signaux

  function carte(host, rows, opts) {
    opts = opts || {};
    tip.cacher();
    if (!rows.length) return vide(host);
    host.textContent = "";

    var th = theme();
    var W = Math.max(280, host.clientWidth), H = W < 520 ? 300 : 380;
    var m = { l: 50, r: 14, t: 26, b: 44 };
    var dpr = root.devicePixelRatio || 1;

    function toile(cls) {
      var c = el("canvas", { class: cls || "" });
      c.width = W * dpr; c.height = H * dpr;
      c.style.width = W + "px"; c.style.height = H + "px";
      var g = c.getContext("2d");
      g.scale(dpr, dpr);
      host.appendChild(c);
      return g;
    }
    var g = toile();
    var survol = toile("overlay");
    host.firstChild.setAttribute("role", "img");
    host.firstChild.setAttribute("aria-label",
      "Nuage de points : composante d'information en abscisse, nombre de cas en ordonnée. Les valeurs figurent dans le tableau.");

    var xmin = Infinity, xmax = -Infinity, ymax = 0, ymin = Infinity;
    rows.forEach(function (r) {
      if (r.ic < xmin) xmin = r.ic;
      if (r.ic > xmax) xmax = r.ic;
      if (r.a > ymax) ymax = r.a;
      if (r.a < ymin) ymin = r.a;
    });
    xmin = Math.floor(Math.min(xmin, 0) - 0.2); xmax = Math.ceil(xmax + 0.2);
    var ly0 = Math.log10(Math.max(1, ymin) * 0.8), ly1 = Math.log10(ymax * 1.4);
    if (ly1 - ly0 < 1) ly1 = ly0 + 1;

    function X(v) { return m.l + (v - xmin) / (xmax - xmin) * (W - m.l - m.r); }
    function Y(a) { return H - m.b - (Math.log10(a) - ly0) / (ly1 - ly0) * (H - m.t - m.b); }

    // grille et axes
    g.font = POLICE;
    g.lineWidth = 1;
    g.textBaseline = "middle";
    g.textAlign = "right";
    var decades = [];
    for (var p = Math.ceil(ly0); p <= Math.floor(ly1); p++) decades.push(Math.pow(10, p));
    decades.forEach(function (v) {
      var y = Math.round(Y(v)) + 0.5;
      g.strokeStyle = th.grid;
      g.beginPath(); g.moveTo(m.l, y); g.lineTo(W - m.r, y); g.stroke();
      g.fillStyle = th.muted;
      g.fillText(fmt.compact(v), m.l - 8, y);
    });
    g.textAlign = "center";
    g.textBaseline = "top";
    var pas = (xmax - xmin) * 44 > (W - m.l - m.r) ? 2 : 1;
    for (var v = Math.ceil(xmin / pas) * pas; v <= xmax; v += pas) {
      g.fillStyle = th.muted;
      g.fillText((v > 0 ? "+" : "") + v, X(v), H - m.b + 8);
    }
    // repère IC = 0 : autant de cas qu'attendu
    g.strokeStyle = th.axis;
    var x0 = Math.round(X(0)) + 0.5;
    g.beginPath(); g.moveTo(x0, m.t); g.lineTo(x0, H - m.b); g.stroke();
    g.beginPath(); g.moveTo(m.l, H - m.b + 0.5); g.lineTo(W - m.r, H - m.b + 0.5); g.stroke();
    g.fillStyle = th.ink2;
    g.fillText("IC = log₂ (cas observés / cas attendus)", m.l + (W - m.l - m.r) / 2, H - 16);
    g.textAlign = "left";
    g.fillText("Cas (échelle log)", 0, 2);

    // points : du moins au plus marqué
    var dense = rows.length > 1500;
    var pts = rows.map(function (r) { return { r: r, x: X(r.ic), y: Y(r.a) }; });
    NIVEAUX.forEach(function (niv) {
      var rayon = niv === "aucun" ? 2 : dense ? 2.6 : 4;
      g.fillStyle = th[niv];
      g.globalAlpha = dense ? (niv === "aucun" ? 0.45 : 0.7) : 1;
      pts.forEach(function (p) {
        if (p.r.sig !== niv) return;
        g.beginPath(); g.arc(p.x, p.y, rayon, 0, 6.2832); g.fill();
        if (!dense && niv !== "aucun") { g.strokeStyle = th.surface; g.lineWidth = 1.5; g.stroke(); }
      });
    });
    g.globalAlpha = 1;

    // étiquettes directes : quelques extrêmes seulement
    var boites = [];
    g.font = POLICE;
    g.textBaseline = "middle";
    pts.filter(function (p) { return p.r.sig !== "aucun"; })
      .sort(function (a, b) { return b.r.ic025 - a.r.ic025; })
      .slice(0, 40)
      .forEach(function (p) {
        if (boites.length >= 3) return;
        var texte = fmt.tronque(opts.sansMolecule ? p.r.lib : p.r.mol + " · " + p.r.lib, W < 520 ? 26 : 40);
        var w = g.measureText(texte).width;
        var aGauche = p.x - 8 - w > m.l;
        var bx = aGauche ? p.x - 8 - w : p.x + 8;
        var b = { x: bx - 2, y: p.y - 9, w: w + 4, h: 18 };
        if (b.x < m.l || b.x + b.w > W - 2 || b.y < 0) return;
        var chevauche = boites.some(function (o) {
          return b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h;
        });
        if (chevauche) return;
        // nuage peu dense : l'étiquette ne recouvre aucun autre point
        if (!dense && pts.some(function (o) {
          return o !== p && o.x > b.x - 4 && o.x < b.x + b.w + 4 && o.y > b.y - 2 && o.y < b.y + b.h + 2;
        })) return;
        boites.push(b);
        g.textAlign = "left";
        g.globalAlpha = 0.88;
        g.fillStyle = th.surface;
        g.beginPath(); g.roundRect(b.x - 2, b.y, b.w + 4, b.h, 4); g.fill();
        g.globalAlpha = 1;
        g.fillStyle = th.ink;
        g.fillText(texte, bx, p.y);
      });

    // survol : le point le plus proche dans un rayon de 24 px
    var attente = false;
    function proche(ev) {
      var rect = host.getBoundingClientRect();
      var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      var best = null, d2 = 24 * 24;
      for (var i = 0; i < pts.length; i++) {
        var dx = pts[i].x - mx, dy = pts[i].y - my, d = dx * dx + dy * dy;
        if (d < d2) { d2 = d; best = pts[i]; }
      }
      survol.clearRect(0, 0, W, H);
      if (!best) return tip.cacher();
      survol.beginPath(); survol.arc(best.x, best.y, 6, 0, 6.2832);
      survol.fillStyle = th[best.r.sig]; survol.fill();
      survol.lineWidth = 2; survol.strokeStyle = th.ink; survol.stroke();
      tip.montrer(ev.clientX, ev.clientY, ficheCouple(best.r));
    }
    host.onpointermove = function (ev) {
      if (attente) return;
      attente = true;
      requestAnimationFrame(function () { attente = false; proche(ev); });
    };
    host.onpointerleave = function () { survol.clearRect(0, 0, W, H); tip.cacher(); };
  }

  function legende(host, rows) {
    host.textContent = "";
    var n = { aucun: 0, faible: 0, modere: 0, fort: 0 };
    rows.forEach(function (r) { n[r.sig]++; });
    ["fort", "modere", "faible", "aucun"].forEach(function (niv) {
      if (!n[niv]) return;
      var dot = el("span", { class: "dot" });
      dot.style.background = "var(--sig-" + niv + ")";
      host.appendChild(el("span", { class: "item" }, [
        dot, el("span", { text: NOM_NIVEAU[niv] }), el("span", { class: "n", text: fmt.entier(n[niv]) })
      ]));
    });
  }

  // ------------------------------------------------- intervalles du ROR

  function intervalles(host, rows, opts) {
    tip.cacher();
    if (!rows.length) return vide(host, "Aucun signal pour ces filtres.");
    host.textContent = "";
    opts = opts || {};

    var W = Math.max(280, host.clientWidth);
    var valW = W >= 560 ? 128 : 0;
    var labelW = Math.round(Math.min(340, Math.max(130, W * (valW ? 0.44 : 0.56))));
    var rowH = 26, top = 4, axisH = 40;
    var H = top + rows.length * rowH + axisH;
    var px0 = labelW + 8, px1 = W - valW - 12;

    var lo = 1, hi = 2;
    rows.forEach(function (r) {
      if (r.rorInf < lo) lo = r.rorInf;
      if (r.rorSup > hi) hi = r.rorSup;
    });
    var l0 = Math.log10(lo * 0.85), l1 = Math.log10(hi * 1.15);
    function X(v) { return px0 + (Math.log10(v) - l0) / (l1 - l0) * (px1 - px0); }

    var s = svg("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": "Rapport de cotes de notification et intervalle de confiance des signaux les plus marqués." });

    // graduations 1-2-5, espacées d'au moins 46 px
    var ticks = [], dernier = -Infinity;
    for (var e = Math.floor(l0); e <= Math.ceil(l1); e++) {
      [1, 2, 5].forEach(function (k) {
        var v = k * Math.pow(10, e);
        if (v < Math.pow(10, l0) || v > Math.pow(10, l1)) return;
        var x = X(v);
        if (x - dernier < 46 && v !== 1) return;
        ticks.push(v); dernier = x;
      });
    }
    var bas = top + rows.length * rowH;
    ticks.forEach(function (v) {
      var x = Math.round(X(v)) + 0.5;
      s.appendChild(svg("line", { x1: x, x2: x, y1: top, y2: bas, class: v === 1 ? "baseline" : "gridline" }));
      s.appendChild(svg("text", { x: x, y: bas + 16, "text-anchor": "middle", class: "tick" }, fmt.compact(v)));
    });
    s.appendChild(svg("text", { x: W - valW - 12, y: bas + 34, "text-anchor": "end" },
      W < 420 ? "ROR, échelle log" : "ROR, échelle log (1 = pas de disproportion)"));

    var maxCar = Math.floor(labelW / 6.4);
    rows.forEach(function (r, i) {
      var y = top + i * rowH, cy = y + rowH / 2;
      var grp = svg("g", { class: "row", tabindex: "0", "aria-label":
        r.mol + ", " + r.lib + " : ROR " + fmt.ratio(r.ror) + ", intervalle " + fmt.ratio(r.rorInf) + " à " + fmt.ratio(r.rorSup) });
      grp.appendChild(svg("rect", { x: 0, y: y, width: W, height: rowH, rx: 4, class: "row-hit" }));

      var nom = svg("text", { x: labelW, y: cy + 4, "text-anchor": "end" });
      if (opts.sansMolecule) {
        nom.appendChild(svg("tspan", { class: "name" }, fmt.tronque(r.lib, maxCar)));
      } else {
        var reste = Math.max(6, maxCar - r.mol.length - 3);
        nom.appendChild(svg("tspan", { class: "name" }, r.mol));
        nom.appendChild(svg("tspan", {}, " · " + fmt.tronque(r.lib, reste)));
      }
      grp.appendChild(nom);

      var c = "var(--sig-" + r.sig + ")";
      grp.appendChild(svg("line", { x1: X(r.rorInf), x2: X(r.rorSup), y1: cy, y2: cy, stroke: c, "stroke-width": 2, "stroke-linecap": "round" }));
      grp.appendChild(svg("circle", { cx: X(r.ror), cy: cy, r: 5, fill: c, stroke: "var(--surface)", "stroke-width": 2 }));
      if (valW) grp.appendChild(svg("text", { x: W - 4, y: cy + 4, "text-anchor": "end", class: "val" },
        fmt.ratio(r.ror) + " [" + fmt.ratio(r.rorInf) + "–" + fmt.ratio(r.rorSup) + "]"));

      grp.addEventListener("pointermove", function (ev) { tip.montrer(ev.clientX, ev.clientY, ficheCouple(r)); });
      grp.addEventListener("pointerleave", tip.cacher);
      grp.addEventListener("focus", function () {
        var b = grp.getBoundingClientRect();
        tip.montrer(b.left + labelW, b.bottom - 8, ficheCouple(r));
      });
      grp.addEventListener("blur", tip.cacher);
      s.appendChild(grp);
    });
    host.appendChild(s);
  }

  // ------------------------------------------------- matrice molécule x effet

  function matrice(host, echelle, modele) {
    tip.cacher();
    var th = theme();

    echelle.textContent = "";
    var bar = el("span", { class: "bar" });
    [-5, -3, -1, 0, 1, 3, 5].forEach(function (v) {
      var i = el("i");
      i.style.background = couleurIC(v, th);
      bar.appendChild(i);
    });
    echelle.appendChild(el("span", { text: "Sous-déclaré" }));
    echelle.appendChild(bar);
    echelle.appendChild(el("span", { text: "Sur-déclaré" }));
    echelle.appendChild(el("span", { text: "· IC de −5 à +5" }));

    if (!modele.effets.length || !modele.mols.length) return vide(host, "Aucun signal à comparer pour ces filtres.");
    host.textContent = "";

    var grille = el("div", { class: "heat", role: "img",
      "aria-label": "Matrice de la composante d'information par molécule et par effet. Les valeurs figurent dans le tableau." });
    // les colonnes se partagent la largeur disponible, entre 22 et 56 px
    var nCol = modele.mols.length;
    var wNom = Math.round(Math.max(120, Math.min(260, host.clientWidth * 0.38)));
    var wCol = Math.max(22, Math.min(56, Math.floor((host.clientWidth - wNom - 2 * nCol) / nCol)));
    grille.style.gridTemplateColumns = wNom + "px repeat(" + nCol + ", " + wCol + "px)";
    grille.appendChild(el("div", { class: "corner" }));
    modele.mols.forEach(function (mo) {
      grille.appendChild(el("div", { class: "col" + (mo.actif ? " on" : "") }, [el("span", { text: mo.nom })]));
    });

    var cellules = [];
    modele.effets.forEach(function (pt) {
      grille.appendChild(el("div", { class: "rowlabel", title: fmt.libelle(pt), text: fmt.libelle(pt) }));
      modele.mols.forEach(function (mo) {
        var r = modele.couple(mo.idx, pt);
        var c = el("div", { class: "cell" + (r ? "" : " vide") });
        if (r) { c.style.background = couleurIC(r.ic, th); c.dataset.i = cellules.length; cellules.push(r); }
        grille.appendChild(c);
      });
    });
    grille.onpointermove = function (ev) {
      var i = ev.target && ev.target.dataset ? ev.target.dataset.i : undefined;
      if (i === undefined) return tip.cacher();
      tip.montrer(ev.clientX, ev.clientY, ficheCouple(cellules[+i]));
    };
    grille.onpointerleave = tip.cacher;
    host.appendChild(grille);
  }

  FAERS.fmt = fmt;
  FAERS.el = el;
  FAERS.NOM_NIVEAU = NOM_NIVEAU;
  FAERS.charts = { carte: carte, legende: legende, intervalles: intervalles, matrice: matrice };
})(window);
