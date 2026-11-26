/*
 * Mesures de disproportionnalité pour la détection de signaux.
 * Même calcul que pipeline/faers_signals.py : toute modification doit être
 * reportée des deux côtés.
 *
 *                    effet       autres effets
 *    molécule          a              b           nMol
 *    autres            c              d
 *                    nEffet                       N
 */
(function (root) {
  "use strict";

  // Termes MedDRA décrivant une circonstance, une issue ou un problème de
  // produit plutôt qu'un effet indésirable clinique.
  var NON_CLINIQUE = new RegExp(
    "PRODUCT|OFF LABEL|\\bDOSE\\b|DOSAGE|MEDICATION ERROR|INTENTIONAL|THERAPY|" +
    "THERAPEUTIC|TREATMENT|DEVICE|ADMINISTRATION|ADMINISTERED|EXPOSURE|" +
    "NO ADVERSE|INEFFECTIVE|COMPLIANCE|WRONG|INCORRECT|INAPPROPRIATE|OVERDOSE|" +
    "HOSPITALISATION|^DEATH$|PRESCRI|CONDITION AGGRAVATED|DISEASE PROGRESSION|" +
    "ILLNESS$|^MALAISE$|UNEVALUABLE|ILL-DEFINED|CIRCUMSTANCE|DRUG USE|" +
    "DRUG ABUSE|DRUG DEPENDENCE|^ACCIDENT|SURGERY|OPERATION$"
  );

  function disproportionnalite(a, nMol, nEffet, N) {
    var b = nMol - a;
    var c = nEffet - a;
    var d = N - nMol - nEffet + a;
    if (Math.min(a, b, c, d) <= 0) return null;

    var prr = (a / nMol) / (c / (N - nMol));
    var sePrr = Math.sqrt(1 / a - 1 / nMol + 1 / c - 1 / (N - nMol));
    var ror = (a * d) / (b * c);
    var seRor = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
    // Khi-deux avec correction de Yates
    var chi2 = N * Math.pow(Math.abs(a * d - b * c) - N / 2, 2) /
      (nMol * (N - nMol) * nEffet * (N - nEffet));
    // Composante d'information (BCPNN) et intervalle de crédibilité à 95 %
    // (Norén et al., Stat Methods Med Res 2013)
    var attendu = nMol * nEffet / N;
    var ic = Math.log2((a + 0.5) / (attendu + 0.5));
    var ic025 = ic - 3.3 * Math.pow(a + 0.5, -0.5) - 2.0 * Math.pow(a + 0.5, -1.5);
    var ic975 = ic + 2.4 * Math.pow(a + 0.5, -0.5) - 0.5 * Math.pow(a + 0.5, -1.5);

    return {
      a: a, b: b, c: c, d: d, attendu: attendu,
      prr: prr,
      prrInf: Math.exp(Math.log(prr) - 1.96 * sePrr),
      prrSup: Math.exp(Math.log(prr) + 1.96 * sePrr),
      ror: ror,
      rorInf: Math.exp(Math.log(ror) - 1.96 * seRor),
      rorSup: Math.exp(Math.log(ror) + 1.96 * seRor),
      chi2: chi2, ic: ic, ic025: ic025, ic975: ic975
    };
  }

  // Un signal est retenu seulement si les trois familles de critères concordent :
  // Evans (PRR >= 2, khi-deux >= 4, au moins 3 cas), borne basse du ROR > 1
  // et borne basse de l'IC > 0.
  function estSignal(s) {
    var evans = s.a >= 3 && s.prr >= 2 && s.chi2 >= 4;
    return evans && s.rorInf > 1 && s.ic025 > 0;
  }

  function force(s) {
    if (!estSignal(s)) return "aucun";
    if (s.ic025 >= 3) return "fort";
    if (s.ic025 >= 1.5) return "modere";
    return "faible";
  }

  var api = {
    disproportionnalite: disproportionnalite,
    estSignal: estSignal,
    force: force,
    estNonClinique: function (pt) { return NON_CLINIQUE.test(pt); }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FAERS = root.FAERS || {};
  root.FAERS.stats = api;
})(typeof window !== "undefined" ? window : globalThis);
