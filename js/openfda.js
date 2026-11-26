/*
 * Analyse en direct d'une molécule via l'API publique openFDA.
 * Aucune clé n'est nécessaire (limite : 240 requêtes par minute, 1 000 par jour
 * et par adresse IP). Fonctionne depuis n'importe quel hébergement statique.
 */
(function (root) {
  "use strict";

  var FAERS = (root.FAERS = root.FAERS || {});
  var API = "https://api.fda.gov/drug/event.json";
  var F_SUBST = "patient.drug.activesubstance.activesubstancename";
  var F_PT = "patient.reaction.reactionmeddrapt.exact";
  var F_IND = "patient.drug.drugindication.exact";
  var UNIVERS = "_exists_:" + F_SUBST;
  var MARGES_MAX = 12;   // effets hors référentiel interrogés un par un

  function appel(params) {
    var q = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetch(API + "?" + q).then(function (rep) {
      if (rep.status === 404) return { meta: { results: { total: 0 } }, results: [] };
      if (rep.status === 429) throw new Error("Limite de requêtes openFDA atteinte. Réessayez dans une minute.");
      if (!rep.ok) throw new Error("openFDA a répondu " + rep.status + ".");
      return rep.json();
    });
  }

  function total(search) {
    return appel({ search: search, limit: 1 }).then(function (d) { return d.meta.results.total; });
  }

  function compter(search, champ, limite) {
    return appel({ search: search, count: champ, limit: limite }).then(function (d) { return d.results || []; });
  }

  /**
   * @param {string} nom       substance active, en anglais
   * @param {object} donnees   window.FAERS_DATA (fournit N et les marges connues)
   * @param {function} etape   rappel de progression (texte)
   * @returns {Promise<{molecule: object, effets: Array, nouvellesMarges: object, ignores: number}>}
   */
  function analyser(nom, donnees, etape) {
    var terme = String(nom || "").trim().toUpperCase().replace(/\s+/g, " ");
    if (!/^[A-Z0-9][A-Z0-9 ,.'\/-]{2,59}$/.test(terme)) {
      return Promise.reject(new Error("Saisissez un nom de substance (3 à 60 caractères, lettres et chiffres)."));
    }
    var clause = F_SUBST + ':"' + terme + '" AND ' + UNIVERS;
    var minCas = donnees.meta.min_cas;
    etape("Interrogation d'openFDA pour « " + terme + " »…");

    return Promise.all([
      total(clause),
      compter(clause, F_PT, 500),
      compter(clause, F_IND, 40)
    ]).then(function (rep) {
      var n = rep[0], effets = rep[1], indBrutes = rep[2];
      if (!n) throw new Error("Aucune déclaration FAERS pour « " + terme + " ». Vérifiez l'orthographe anglaise.");

      var connues = {};
      donnees.effets.forEach(function (e) { connues[e.t] = e.m; });

      var ind = {};
      indBrutes.forEach(function (r) {
        var t = r.term.toUpperCase();
        if (t.indexOf("UNKNOWN INDICATION") >= 0) return;
        ind[t] = (ind[t] || 0) + r.count;
      });
      var indications = Object.keys(ind)
        .filter(function (t) { return ind[t] >= 0.005 * n; })
        .sort(function (a, b) { return ind[b] - ind[a]; })
        .slice(0, 20);

      var retenus = effets.filter(function (r) { return r.count >= minCas; });
      var manquants = retenus.filter(function (r) { return !(r.term in connues); });
      var aChercher = manquants.slice(0, MARGES_MAX).filter(function (r) { return !/["\\^]/.test(r.term); });
      etape(n.toLocaleString("fr-FR") + " déclarations trouvées. Fréquences de référence en cours (" + aChercher.length + ")…");

      var nouvelles = {};
      // par lots de 4 pour ménager l'API
      var chaine = Promise.resolve();
      for (var i = 0; i < aChercher.length; i += 4) {
        (function (lot) {
          chaine = chaine.then(function () {
            return Promise.all(lot.map(function (r) {
              return total(UNIVERS + " AND " + F_PT + ':"' + r.term + '"')
                .then(function (m) { if (m) nouvelles[r.term] = m; })
                .catch(function () { /* marge indisponible : effet ignoré */ });
            }));
          });
        })(aChercher.slice(i, i + 4));
      }

      return chaine.then(function () {
        var liste = retenus
          .filter(function (r) { return r.term in connues || r.term in nouvelles; })
          .map(function (r) { return { pt: r.term, a: r.count, ind: indications.indexOf(r.term) >= 0 ? 1 : 0 }; });
        return {
          molecule: {
            id: "direct-" + terme.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            nom: terme.charAt(0) + terme.slice(1).toLowerCase(),
            classe: "Analyse en direct",
            termes: [terme],
            n: n,
            indications: indications
          },
          effets: liste,
          nouvellesMarges: nouvelles,
          ignores: retenus.length - liste.length
        };
      });
    });
  }

  FAERS.openfda = { analyser: analyser };
})(window);
