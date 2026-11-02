# Pronos du Jour

Application web (installable sur Android) qui liste les matchs du jour proposés par **Betclic et Winamax**, tous sports confondus, et propose le meilleur pari pour chacun avec la cote de ces deux bookmakers.

## Ce qu'elle fait

- **Bouton Actualiser** : interroge environ 70 compétitions couvertes par Betclic et Winamax (une cinquantaine de championnats et coupes de football, tennis ATP/WTA, basket NBA/WNBA/NCAA, rugby Top 14/Premiership/URC/Champions Cup…, hockey NHL, NFL, MLB, UFC, AFL) pour aujourd'hui ou demain.
- **Estimation pour chaque match** : uniquement des paris proposés par Betclic et Winamax (1N2, double chance, remboursé si nul, plus/moins de buts, les deux équipes marquent, handicap, nombre de sets au tennis…), avec la probabilité, la « cote juste » et la cote **Betclic** et **Winamax** : réelle avec une clé The Odds API, sinon estimée (marquée ≈).
- **Compos (football)** : compos officielles chargées automatiquement pour les matchs qui commencent dans moins de 80 min (bouton « Charger les compos » sinon). Avant leur publication, compo probable = les 11 joueurs les plus titularisés, moins les blessés connus. Les titulaires habituels absents (buts et passes perdus, défenseurs, gardien) modifient les buts attendus.
- **Top 5 du jour** et un **combiné de 3 matchs**.
- **Bilan** : chaque pronostic est mémorisé avant le match, puis marqué gagné ou perdu une fois le match terminé.
- Fonctionne hors connexion avec les dernières données chargées.

## Comment les pronostics sont calculés

1. Une **note de force** par équipe : bilan de la saison (victoires/nuls/défaites), forme sur les 5 derniers matchs, bilan à domicile ou à l'extérieur.
2. Les **cotes du marché** sont converties en probabilités, marge retirée : vraies cotes Betclic/Winamax si une clé est configurée, sinon cotes internationales publiées par ESPN. Elles comptent pour 70 % de l'estimation : le marché est l'indicateur le plus fiable.
3. Football : un modèle de Poisson (buts attendus) donne les scores, plus/moins de buts et « les deux équipes marquent ». Sports collectifs : une loi normale sur l'écart de points et le total. Tennis : les points au classement mondial.
4. Football : les compos (officielles ou probables) corrigent les buts attendus de chaque équipe.
5. Le « meilleur pari » doit offrir une cote Betclic/Winamax d'au moins 1,30 ; il favorise la meilleure espérance de gain à cette cote.

**Règle d'or** : ne jouez un pari que si la cote de votre bookmaker est *supérieure* à la « cote juste » affichée.

## Vraies cotes Betclic et Winamax (facultatif, gratuit)

1. Créez un compte sur https://the-odds-api.com (offre **Starter**, gratuite : 500 crédits par mois).
2. Dans l'app, touchez l'icône ⚙ (en haut), collez la clé reçue par e-mail, puis **Enregistrer** et **Actualiser**.
3. Une compétition coûte 1 à 3 crédits par actualisation. Le réglage « Crédits maximum par actualisation » (20 par défaut, 15 conseillé pour tenir le mois) limite la dépense. Le nombre de crédits restants s'affiche dans les réglages.

Avec une clé, les matchs que ni Betclic ni Winamax ne proposent sont retirés de la liste.

## Installer l'app sur votre téléphone Android

L'app doit être en ligne en https pour s'ouvrir sur le téléphone et s'installer. Le plus simple et gratuit : **GitHub Pages**.

1. Créez un compte gratuit sur https://github.com, puis cliquez sur **New repository** (nom : `pronos-du-jour`, *Public*).
2. Sur la page du dépôt : **Add file → Upload files**, glissez-y *tout le contenu* de ce dossier (`index.html`, `app.js`, `engine.js`, `styles.css`, `sw.js`, `manifest.webmanifest` et le dossier `icons`), puis **Commit changes**.
3. **Settings → Pages → Branch : `main` / `(root)` → Save**. Au bout d'environ 1 minute l'adresse s'affiche : `https://<votre-pseudo>.github.io/pronos-du-jour/`.
4. Sur le téléphone, ouvrez cette adresse dans **Chrome**, puis menu **⋮ → Ajouter à l'écran d'accueil / Installer l'application**.

L'app s'ouvre ensuite comme une application normale depuis son icône. Chaque matin, appuyez sur **Actualiser**.

## Tester sur le PC

```bash
node serve.js
```

puis ouvrez http://localhost:5173.

## Limites

- Données : API publique d'ESPN (gratuite, sans clé). Certains petits championnats ou sports (handball, volley…) ne sont pas couverts.
- Sans clé The Odds API, les cotes Betclic/Winamax sont des estimations (marge habituelle de chaque bookmaker appliquée au prix du marché) : vérifiez la cote réelle avant de parier.
- Les « compos probables » des journalistes ne sont disponibles dans aucune source gratuite : l'app estime la sienne à partir des titularisations et des blessures connues, puis utilise la compo officielle dès sa publication (environ 1 h avant le match).
- Aucun pronostic ne garantit un gain. Interdit aux mineurs. Jouer comporte des risques : 09 74 75 13 13.
