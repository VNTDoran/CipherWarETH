# CipherChain — tirage de clé vérifiable

Module blockchain du mini-projet. Rend **prouvable** le tirage aléatoire que le
serveur de Cipher War effectue aujourd'hui en secret.

Même pile que le TP `smart-contract-local` : Hardhat 2.22, Solidity 0.8.20,
nœud local sur `127.0.0.1:8545` (chainId 31337), front en HTML + ethers v6
depuis le CDN, signature via MetaMask.

---

## 1. Le problème

Dans Cipher War, chaque messager transporte 10 clés de déchiffrement dont une
seule est la bonne. Aujourd'hui, dans `server/engine/match.ts` :

```ts
realKeyIndex: Math.floor(Math.random() * count),
```

Le serveur tire cet index, le garde en mémoire pendant toute la durée du vol, et
ne le divulgue jamais. Les joueurs n'ont **aucun moyen de vérifier** que ce
tirage est honnête. Un serveur malveillant pourrait :

- déplacer la bonne clé au moment où un joueur s'apprête à la trouver ;
- avantager un joueur en lui soufflant l'index ;
- réécrire après coup l'historique d'un tournoi.

C'est un problème de **confiance envers un tiers**, pas un problème de stockage.
Une base de données centralisée n'y répond pas : c'est précisément son
administrateur que l'on soupçonne.

## 2. Le mécanisme : engagement / révélation

Deux propriétés font tout le travail.

| Propriété | Ce qu'elle garantit | Ce qui la produit |
| --- | --- | --- |
| **Liante** (*binding*) | Le serveur ne peut plus changer sa réponse | keccak256 est résistante aux collisions : aucune autre entrée ne donne la même empreinte |
| **Masquante** (*hiding*) | Personne ne peut lire l'index à l'avance | le **nonce** aléatoire de 32 octets rend la préimage impossible à deviner |

Le nonce n'est pas un détail. Sans lui il n'y aurait que **10 empreintes
possibles** : n'importe qui hacherait les index 0 à 9 et trouverait la vôtre
instantanément. C'est la question la plus probable à la soutenance.

### Déroulé

```
AVANT le départ du messager
  serveur : index = 6, nonce = 0x2b14…
  empreinte = keccak256(matchId, courierId, index, nonce)
  → commitCourier(matchId, courierId, empreinte, 10, 600)      [TX 1]
  la chaîne ne voit QUE l'empreinte

PENDANT le vol (~30 s, hors chaîne)
  les joueurs attaquent, éliminent des clés candidates, tentent un commit
  le serveur ne peut plus bouger : sa réponse est déjà figée

À LA RÉSOLUTION
  → revealCourier(matchId, courierId, 6, 0x2b14…)              [TX 2]
  le contrat recalcule l'empreinte et REFUSE si elle diffère

À TOUT MOMENT ENSUITE
  n'importe qui : getCourier() + recalcul local → conforme ou non
```

L'empreinte inclut `matchId` et `courierId`, donc un engagement **ne peut pas
être rejoué** sur un autre messager (test couvert).

### La contrainte à ne pas rater

L'engagement doit être publié **avant** que le messager ne devienne attaquable.
Un engagement tardif laisserait au serveur une fenêtre pour choisir la clé après
coup, ce qui annulerait toute la garantie. Dans l'intégration, `commitCourier`
doit donc être confirmé avant que le messager n'apparaisse dans l'état envoyé
aux clients.

### Le serveur qui se tait

Un serveur qui ne révèle jamais ne triche pas « discrètement » : passé le délai,
`statusOf()` renvoie `Defaulted`, ce qui est une preuve publique de défaillance.
Avec un contrat de séquestre (comme l'`Escrow` du TP), on peut rendre ce silence
coûteux : mise remboursée aux joueurs si le délai expire.

---

## 3. Les contrats

| Contrat | Rôle |
| --- | --- |
| `CommitRevealRegistry` | Cœur du système. `commitCourier`, `revealCourier` (rejette toute révélation non conforme), `computeCommitment`, `statusOf`, `isProven` |
| `MatchRegistry` | Ancrage du résultat final et des totaux de carrière. Une écriture par match, pas par action |

Les deux n'acceptent d'écriture que du `gameServer` fixé au déploiement
(`immutable`), via un modificateur `onlyServer` — même motif que `onlyBuyer` /
`onlyArbiter` dans l'`Escrow` du TP.

---

## 4. Lancer (exactement comme le TP)

Quatre terminaux, ou trois si vous ne lancez pas le jeu.

```bash
# 1 — le nœud local (laisser tourner)
cd chain
npx hardhat node
```

```bash
# 2 — compiler, tester, déployer
cd chain
npx hardhat test
npx hardhat run scripts/deploy.js --network localhost
```

Le déploiement écrit `public/cipherchain-info.json` (adresse + ABI), que la page
va chercher au chargement — même principe que `escrow-info.json`.

```bash
# 3 — servir la page de démonstration
cd chain
npx http-server public -p 8080 -c-1
```

Puis ouvrir <http://127.0.0.1:8080> **dans Chrome avec MetaMask**.

### MetaMask

1. Réseau → *Ajouter un réseau manuellement*
   - Nom : `Hardhat local`
   - RPC : `http://127.0.0.1:8545`
   - Chain ID : `31337`
   - Symbole : `ETH`
2. Importer le **compte #0** affiché par `hardhat node` — c'est lui le serveur de
   jeu, le seul autorisé à engager et révéler :
   ```
   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```
3. Importer éventuellement le compte #1 pour jouer l'observateur : la page
   détecte le rôle et grise ce qui n'est pas permis.

> Si MetaMask dit « nonce trop élevé » après un redémarrage du nœud :
> Paramètres → Avancés → *Effacer les données d'activité*. Le nœud repart de
> zéro, pas MetaMask.

---

## 5. La démonstration (5 étapes)

Depuis la page, compte #0 connecté :

1. **Envoyer un messager** → signez. Seule l'empreinte part on-chain ; l'index et
   le nonce restent affichés localement, pour montrer qu'ils n'ont pas été
   publiés.
2. **Tricher : annoncer un autre index** → MetaMask soumet, le contrat **rejette**
   avec `BadCommitment`. Le mensonge n'est même pas inscriptible.
3. **Révéler honnêtement** → accepté, l'état passe à *Révélé et prouvé*.
4. **Vérifier** → l'empreinte est recalculée côté navigateur et comparée à celle
   stockée. Faites-le depuis le compte #1 pour montrer qu'aucun privilège n'est
   requis.

Version console, sans MetaMask, pour répéter avant la soutenance :

```bash
npx hardhat run scripts/demo-cheat.js --network localhost
```

---

## 6. Où cela se branche dans le jeu

Deux points d'accroche dans `server/engine/match.ts` :

| Moment | Code actuel | Ajout |
| --- | --- | --- |
| Création du messager | `spawnMessenger()` tire `realKeyIndex` | générer le nonce, calculer l'empreinte, `commitCourier`, n'exposer le messager qu'une fois la TX confirmée |
| Résolution | `resolveCrack()` / `resolveArrival()` | `revealCourier(index, nonce)` |
| Fin de match | `persistResult()` dans `server/rooms.ts` | `finalizeMatch(...)` |

Le jeu reste jouable sans chaîne : si les variables `CHAIN_*` sont absentes,
l'intégration se désactive et le comportement est celui d'origine. Les adresses
sont écrites par le déploiement dans `chain/chain.env`, à recopier dans le `.env`
du jeu.

---

## 7. Coût et limites

- **~2 transactions par messager** (engagement + révélation), soit 40 à 80 par
  partie. Gratuit sur un nœud local ou un testnet ; en production il faudrait
  regrouper les engagements par vague ou passer sur un L2.
- **Le jeu ne peut pas vivre on-chain** : 10 mises à jour par seconde. Seuls les
  deux instants qui exigent de la confiance y sont inscrits.
- **Ce qui n'est pas couvert** : le contrat prouve que le serveur n'a pas changé
  la clé. Il ne prouve pas que le tirage initial était uniformément aléatoire —
  pour cela il faudrait une source partagée (contribution des joueurs au nonce,
  ou un oracle de type VRF). C'est l'extension naturelle du projet, et une bonne
  réponse à donner si la question est posée.
