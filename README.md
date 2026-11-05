# Pronos du Jour

Application web (installable sur Android) qui liste les matchs du jour proposés par **Betclic et Winamax**, tous sports confondus, et propose le meilleur pari pour chacun avec la cote de ces deux bookmakers.

## Ce qu'elle fait

- **Bouton « Mettre à jour » (gratuit)** : interroge environ 70 compétitions couvertes par Betclic et Winamax (football, tennis ATP/WTA, basket NBA/WNBA, rugby, NHL, NFL, MLB, UFC, AFL) pour aujourd'hui ou demain. Elle règle aussi les pronos et paris des 7 jours précédents restés en attente.
- **Paris value du jour** : avec une clé The Odds API, l'app lit la cote de **Pinnacle** (le bookmaker de référence des parieurs professionnels) et la compare aux vraies cotes de Betclic, Winamax, Unibet, Parions Sport, PMU et NetBet. Un pari est **value** quand votre bookmaker paie au moins 2 % de plus que la cote juste Pinnacle. Sans pari value, l'app le dit : ne pas parier est aussi une décision gagnante.
- **Pronos indicatifs** : les issues les plus probables à une cote correcte, clairement séparées des paris value (pas d'avantage prouvé).
- **Mode Rentabilité** (par défaut) : seules les compétitions où la cote Pinnacle est une référence fiable et où les sites français laissent passer de la value sont suivies : les 5 grands championnats européens, les coupes d'Europe, Ligue 2, Championship, 2. Bundesliga, Serie B, Liga Portugal, Eredivisie, tennis ATP/WTA, NBA, Coupe du monde. Les vraies cotes sont chargées dans cet ordre de priorité. D'autres compétitions (NHL, NFL, Top 14, coupes nationales…) peuvent être cochées dans ⚙ ; « Toutes les compétitions » rétablit la liste complète.
- **Comparateur de cotes** : pour chaque pari, cotes Betclic, Winamax et meilleure cote des autres sites français.
- **Mise conseillée** : Kelly fractionné (1/4 par défaut), plafonné à 3 % de la bankroll, uniquement sur les paris value.
- **Onglet Suivi** : journal des paris réellement joués (réglés automatiquement), bankroll, bénéfice, ROI, **CLV** (cote prise comparée à la cote juste au coup d'envoi), bilan des pronos de l'app par type, par sport et **par compétition** (pour retirer celles qui ne rapportent pas), calibration, export CSV.
- **Compos (football)**, **scores en direct** et **estimation en direct** comme avant.
- **Onglet Défis & freebets** : lecture des captures de défis, plus deux outils : **convertir un freebet** (les paris qui en récupèrent le plus de valeur) et **cote boostée : rentable ou pas ?**
- Fonctionne hors connexion avec les dernières données chargées.

## Comment les pronostics sont calculés

1. **Référence de marché** : cotes Pinnacle (sinon Betfair Exchange) sans marge. La marge est retirée par la méthode « power », qui corrige le biais favori / outsider. Avec Pinnacle, la probabilité affichée est celle du marché seul : un petit modèle statistique ne fait pas mieux qu'un bookmaker sharp.
2. Sans Pinnacle : moyenne des bookmakers français (ou des cotes ESPN), mélangée à 70 % avec le modèle statistique. Dans ce cas, aucun pari n'est marqué value.
3. **Modèle statistique** : note de force (bilan, forme, domicile/extérieur), force d'attaque et de défense, 5 derniers matchs, confrontations directes. Football : loi de Poisson avec correction de Dixon-Coles (0-0 et 1-1 un peu plus fréquents). Sports collectifs : loi normale sur l'écart et le total (rugby en 1N2, avec le nul). Tennis : points ATP/WTA, au meilleur des 5 sets en Grand Chelem masculin.
4. **Compos et blessés** : effet complet sans cote ; réduit quand des cotes existent (le marché les intègre déjà) ; nul si les cotes Pinnacle ont été relevées après la compo officielle.
5. **Règlement** : football sur le temps réglementaire (90 minutes, prolongation exclue) comme les bookmakers ; hockey : victoire prolongation comprise (vérifiez le marché joué, le 1N2 temps réglementaire est différent).

**Règle d'or** : ne jouez un pari que si la cote de votre bookmaker est *supérieure* à la « cote juste » affichée, et suivez votre CLV : c'est le meilleur indicateur que vous battez le marché.

## Vraies cotes Betclic et Winamax (facultatif, gratuit)

1. Créez un compte sur https://the-odds-api.com (offre **Starter**, gratuite : 500 crédits par mois).
2. Dans l'app, touchez l'icône ⚙ (en haut), collez la clé reçue par e-mail, puis **Enregistrer**. Le bouton **« Charger les vraies cotes »** apparaît sous la date.
3. Une compétition coûte 1 à 3 crédits par actualisation (une requête lit jusqu'à 10 bookmakers pour le même prix : les 6 sites français, Pinnacle et Betfair). Le réglage « Crédits maximum par actualisation » (20 par défaut, 15 conseillé pour tenir le mois) limite la dépense. Le nombre de crédits restants s'affiche dans les réglages.

Avec une clé, les matchs qu'aucun bookmaker français ne propose sont retirés de la liste. Dans les réglages ⚙, cochez les bookmakers où vous avez un compte et indiquez votre bankroll pour voir les mises conseillées.

## Installer l'app sur votre téléphone Android

L'app doit être en ligne en https pour s'ouvrir sur le téléphone et s'installer. Le plus simple et gratuit : **GitHub Pages**.

1. Créez un compte gratuit sur https://github.com, puis cliquez sur **New repository** (nom : `pronos-du-jour`, *Public*).
2. Sur la page du dépôt : **Add file → Upload files**, glissez-y *tout le contenu* de ce dossier (`index.html`, `app.js`, `engine.js`, `suivi.js`, `defis.js`, `styles.css`, `sw.js`, `manifest.webmanifest` et le dossier `icons`), puis **Commit changes**.
3. **Settings → Pages → Branch : `main` / `(root)` → Save**. Au bout d'environ 1 minute l'adresse s'affiche : `https://<votre-pseudo>.github.io/pronos-du-jour/`.
4. Sur le téléphone, ouvrez cette adresse dans **Chrome**, puis menu **⋮ → Ajouter à l'écran d'accueil / Installer l'application**.

L'app s'ouvre ensuite comme une application normale depuis son icône. Chaque matin, appuyez sur **Mettre à jour** (gratuit), puis si besoin sur **Charger les vraies cotes**.

## Tester sur le PC

```bash
node serve.js
```

puis ouvrez http://localhost:5173.

Tests du moteur de pronostics (Node 18 ou plus) :

```bash
node --test tests/*.test.js
```

## Limites

- Données : API publique d'ESPN (gratuite, sans clé). Certains petits championnats ou sports (handball, volley…) ne sont pas couverts. Pas de xG, de tirs ni de possession avant match : ESPN ne les publie pas gratuitement.
- Sans clé The Odds API, les cotes Betclic/Winamax sont des estimations (marge habituelle de chaque bookmaker appliquée au prix du marché) : vérifiez la cote réelle avant de parier.
- Les « compos probables » des journalistes ne sont disponibles dans aucune source gratuite : l'app estime la sienne à partir des titularisations et des blessures connues, puis utilise la compo officielle dès sa publication (environ 1 h avant le match).
- Aucun pronostic ne garantit un gain. Interdit aux mineurs. Jouer comporte des risques : 09 74 75 13 13.
