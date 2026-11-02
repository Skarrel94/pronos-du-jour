# Pronos du Jour

Application web (installable sur Android) qui liste tous les matchs du jour, tous sports confondus, et propose le meilleur pari pour chacun.

## Ce qu'elle fait

- **Bouton Actualiser** : interroge 22 compétitions (football du monde entier, tennis ATP/WTA, basket NBA/NCAA, rugby Top 14/Premiership/URC/Champions Cup…, hockey NHL, NFL, MLB, UFC, AFL) pour aujourd'hui ou demain.
- **Estimation pour chaque match** : probabilité de chaque type de pari (1N2, double chance, remboursé si nul, plus/moins de buts, les deux équipes marquent, handicap, sets au tennis…) et la « cote juste » à comparer avec celle de votre bookmaker.
- **Top 5 du jour** et un **combiné de 3 matchs**.
- **Bilan** : chaque pronostic est mémorisé avant le match, puis marqué gagné ou perdu une fois le match terminé.
- Fonctionne hors connexion avec les dernières données chargées.

## Comment les pronostics sont calculés

1. Une **note de force** par équipe : bilan de la saison (victoires/nuls/défaites), forme sur les 5 derniers matchs, bilan à domicile ou à l'extérieur.
2. Quand ESPN publie les **cotes d'un bookmaker** (souvent DraftKings), elles sont converties en probabilités, marge retirée. Elles comptent pour 70 % de l'estimation : le marché est l'indicateur le plus fiable.
3. Football : un modèle de Poisson (buts attendus) donne les scores, plus/moins de buts et « les deux équipes marquent ». Sports collectifs : une loi normale sur l'écart de points et le total. Tennis : les points au classement mondial.
4. Le « meilleur pari » privilégie une forte probabilité avec une cote juste d'au moins 1,25.

**Règle d'or** : ne jouez un pari que si la cote de votre bookmaker est *supérieure* à la « cote juste » affichée.

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
- Les cotes ne sont pas disponibles pour tous les matchs : l'estimation est alors purement statistique (barres de fiabilité plus basses).
- Aucun pronostic ne garantit un gain. Interdit aux mineurs. Jouer comporte des risques : 09 74 75 13 13.
