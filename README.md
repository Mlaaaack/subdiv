# Slider Chords — synthé RNBO pour le web

Interface web pour le patch RNBO "Slider Chords". Structure pensée pour
être hébergée sur GitHub Pages et modifiée facilement, sans tout
regénérer à chaque fois.

## Structure

```
index.html              structure de la page (à ne presque jamais toucher)
style.css                toute l'apparence (couleurs, formes des knobs, layout)
app.js                   logique : chargement RNBO, audio, contrôles, bang
patch/patch_export.json  l'export RNBO (remplaçable)
patch/dependencies.json  dépendances du patch (samples éventuels)
```

## Changer de patch

Il suffit d'écraser les deux fichiers dans `patch/` par un nouvel export
RNBO (Export → Web dans Max/RNBO). Rien d'autre à modifier : les
contrôles (knobs, interrupteurs) sont générés automatiquement à partir
des paramètres déclarés dans le patch, et la version de `@rnbo/js`
chargée correspond automatiquement à celle du patch.

Si les nouveaux paramètres ont des noms différents, ajoute-les dans
l'objet `LABELS` en haut de `app.js` pour leur donner un libellé
français — sinon le nom brut du paramètre RNBO s'affiche.

## Changer l'interface (GUI)

Thème actuel : "gravure lino" — papier crème, encre noire, une seule
couleur d'accent (bichromie façon atelier), formes dessinées à la main
via [rough.js](https://roughjs.com) (chargé en CDN dans `index.html`,
pas d'installation nécessaire).

- **Couleurs** : tout est dans les variables en haut de `style.css`
  (`--paper`, `--ink`, `--spot`, etc.). `app.js` lit ces mêmes couleurs
  au moment de dessiner (fonction `palette()`) — donc changer les
  variables CSS suffit à changer aussi la couleur des knobs.
- **Caractère "dessiné à la main"** : réglable via les paramètres
  `roughness` et `bowing` passés à rough.js dans `app.js` (plus la
  valeur est haute, plus le trait est irrégulier). Chaque commande a
  une "graine" fixe (`seedKey`) pour garder un tracé cohérent d'un
  rafraîchissement à l'autre plutôt que de trembler à chaque frame.
- **Polices** : Permanent Marker (titre), Kalam (labels), Special
  Elite (petit texte) — à changer dans le `<link>` Google Fonts et les
  `font-family` de `style.css`.
- **Repartir sur un tout autre style** (ex. métal/graphite comme la
  première version) : dupliquer `style.css`, remplacer les fonctions
  de dessin dans `app.js` par du CSS pur si tu ne veux plus de
  rough.js, ou simplement changer les options passées à rough.js pour
  un rendu plus net (`roughness: 0.3`) ou plus brut (`roughness: 3`).

`app.js` ne dépend d'aucune valeur de style codée en dur ailleurs que
dans ces variables — tu peux repenser l'apparence sans casser le
fonctionnement.

## Déploiement sur GitHub Pages

1. Crée un repo GitHub et pousse ces fichiers à la racine
2. Repo → Settings → Pages → Source : sélectionne la branche
   (généralement `main`) et le dossier `/ (root)`
3. Le site sera servi à `https://<utilisateur>.github.io/<repo>/`

## Test en local

Le chargement du patch se fait via `fetch()`, ce qui ne fonctionne pas
en ouvrant simplement `index.html` avec `file://` (restriction des
navigateurs). Sers le dossier avec un petit serveur local :

```bash
python3 -m http.server
# puis ouvrir http://localhost:8000
```

## Intégration dans un site Figma (ou autre)

Une fois déployé sur GitHub Pages, intègre la page via un `iframe` dans
un bloc Embed (Figma Sites : Insert → Embeds → HTML) :

```html
<iframe src="https://<utilisateur>.github.io/<repo>/"
        width="100%" height="640" style="border:none;" allow="autoplay">
</iframe>
```
