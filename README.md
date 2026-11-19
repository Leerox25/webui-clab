# LAB/01 — Éditeur web pour Containerlab

Interface web locale pour dessiner une topologie, sauvegarder son état et produire/déployer un laboratoire Containerlab nommé `webui`.

## Prérequis

- Ubuntu (natif ou WSL2) et Python 3.
- Docker installé et démarré; votre utilisateur doit pouvoir l'utiliser (groupe `docker` ou accès via le mécanisme de votre installation).
- Containerlab installé; vérifier avec `containerlab version`.
- Paquets Python Ubuntu `python3-flask` et `python3-yaml` (installés par `install.sh`).
- Accès réseau au CDN Unpkg pour charger Cytoscape.js dans le navigateur.

Docker et Containerlab s'installent selon leur documentation officielle respective. Sur WSL, utilisez WSL2 et Docker Desktop avec l'intégration WSL activée, ou un démon Docker local. Le déploiement nécessite une installation Containerlab fonctionnelle dans le même environnement Linux que l'application.

## Installation et lancement

Décompressez l'archive dans un dossier, puis :

```bash
cd webui-clab
bash install.sh
cd "$HOME/labs/webui"
python3 app.py
```

Ouvrez ensuite <http://localhost:5001>. Arrêtez le serveur avec `Ctrl+C`. L'application écoute sur toutes les interfaces (`0.0.0.0`) pour faciliter certains environnements; ne l'exposez pas à un réseau non fiable.

L'état sauvegardé est écrit dans `~/labs/webui/lab/state.json`; le fichier Containerlab généré est `~/labs/webui/lab/lab.clab.yml`.

## Autoriser Containerlab sans mot de passe (sudoers)

La commande de déploiement et destruction appelle `sudo containerlab`. Pour éviter une demande de mot de passe à chaque action, identifiez d'abord le chemin réel :

```bash
which containerlab
```

Si la sortie est `/usr/bin/containerlab`, créez avec `sudo visudo -f /etc/sudoers.d/webui-containerlab` une règle limitée :

```sudoers
<user> ALL=(ALL) NOPASSWD: /usr/bin/containerlab
```

Remplacez `<user>` par le nom système exact retourné par `whoami`. Si `which containerlab` renvoie un autre chemin, adaptez le chemin dans la règle et vérifiez que la commande appelée par `sudo` résout le même binaire. Gardez ce droit réservé à un compte de confiance : Containerlab peut modifier les ressources réseau et conteneurs de la machine.

## Mode d'emploi

- Choisissez Routeur, Switch, PC ou Serveur, puis cliquez dans le plan pour poser un équipement. Les identifiants sont auto-incrémentés (`r1`, `sw1`, `pc1`, `srv1`, etc.). Tous les nœuds utilisent la même image `lab01/node:latest` (bridge, VLAN, FRR, keepalived, dnsmasq) : elle doit être construite sur l'hôte avant tout déploiement (`docker build -t lab01/node:latest nodes/`, fait automatiquement par `install.sh` et `run-mac.sh`).
- Choisissez **Relier 2 nœuds**, puis cliquez sur les deux équipements à connecter. Les interfaces `eth1`, `eth2`, etc. sont affectées automatiquement par nœud selon l'ordre des liens.
- **Propriétés du switch** (panneau affiché quand un switch est sélectionné) : activez/désactivez **STP** et réglez sa **priorité** (pas de 4096), puis configurez chaque port en **access** (un VLAN) ou **trunk** (liste de VLANs taggés, avec un **VLAN natif** non taggé optionnel). La liste des VLANs accepte les **plages** : `10-20,30`. Une **base VLAN locale** permet de nommer les VLANs (`10 = BUREAU`) ; elle sert de documentation et figure dans le JSON de configuration du nœud.
- **Switch L3 (SVI)** : dans le panneau « Adressage IP » d'un switch, le bouton « SVI par VLAN » crée une interface `br0.<vlan>` adressable. Une SVI posée sur un bridge déclare automatiquement la VLAN sur le port local du bridge, sans quoi la passerelle interne ne verrait aucun trafic. Le nœud route alors entre ses VLANs (le *forwarding* est activé dès qu'un nœud a une configuration IP).
- **Adressage IP** (panneau de droite, dès qu'un nœud est sélectionné) : ajoutez une interface, puis renseignez son adresse IPv4 et/ou IPv6 avec préfixe. Vous pouvez aussi préciser un **MTU**, une **adresse MAC**, cocher **DHCP (client)**, ou créer une **sous-interface 802.1Q** (VLAN) sur une interface existante — c'est ce qui permet le montage « router-on-a-stick » avec un port trunk côté switch. Le panneau gère également les **adresses de loopback** (une par ligne) et les **routes statiques** (destination, passerelle `via` et/ou interface `dev`).
- Un nœud peut enfin devenir **serveur DHCP** (dnsmasq) : cochez l'option et indiquez l'interface, la plage `début,fin`, la passerelle et le DNS annoncés.
- **OSPF** (panneau « OSPF ») : cochez « Activer OSPF », renseignez éventuellement un `router-id`, puis, pour chaque aire, la liste des **réseaux annoncés** (un par ligne, format `10.0.0.0/24`) et les **interfaces passives**. Un champ « coût par interface » accepte une liste `eth1=10, eth2=100`. La configuration est traduite en `frr.conf` et `ospfd` est démarré dans le conteneur ; `vtysh` est disponible via le *Test rapide* (par exemple `r1` / `vtysh -c "show ip ospf neighbor"`).
- **VRRP** (panneau « VRRP ») : cochez « Activer VRRP », puis ajoutez une instance par interface : interface, VRID (1-255), priorité (1-254), *preempt* et la ou les **adresses virtuelles** (avec préfixe, une par ligne, par exemple `10.10.0.254/24`). Configurez le même VRID sur au moins deux nœuds du même segment pour obtenir un couple Master/Backup. L'entrypoint crée les interfaces **macvlan** exigées par le `vrrpd` de FRR (mode `bridge`, MAC virtuelle `00:00:5e:00:01:<VRID>`).
- **IPsec** (panneau « IPsec ») : tunnels site-à-site IKEv2 (strongSwan). Pour chaque connexion : nom, **adresses locale et distante** (IPv4 ou `%interface`), **identités** (`localId`/`remoteId`), **clé partagée**, **sélecteurs de trafic** (`localTs` = votre réseau local, `remoteTs` = celui du pair), propositions IKE/ESP et mode d'amorçage. Par défaut `trap` : le tunnel s'établit au premier paquet. Contrôle : `swanctl --list-sas` via le *Test rapide*.
- **Tunnel GRE** (panneau « Adressage IP », bouton « Ajouter un tunnel GRE ») : crée une interface `greN` entre deux adresses IP, avec TTL et clé GRE optionnels. Le tunnel se comporte comme une interface normale : adresse IPv4/IPv6, MTU, routes statiques, et on peut y faire tourner **OSPF ou BGP**. C'est le montage classique « GRE + routage » (et GRE peut ensuite être protégé par IPsec).
- **MPLS / LDP** (panneau « MPLS ») : activez MPLS, renseignez le **router-id** (l'adresse d'une loopback du nœud) et, si besoin, une adresse de transport, puis cochez les interfaces à activer. L'entrypoint lève `net.mpls.platform_labels` (la valeur par défaut, 0, interdit toute étiquette) et active `mpls enable` sur ces interfaces. LDP distribue des étiquettes pour les préfixes appris par l'IGP : configurez donc **OSPF** sur le même nœud, avec une loopback comme router-id. Contrôle : `vtysh -c "show mpls ldp neighbor"` pour les sessions, `ip -f mpls route show` pour le LFIB.
- **BGP** (panneau « BGP ») : activez BGP, renseignez l'**AS local** et un router-id, puis les **réseaux annoncés** et une éventuelle **redistribution** (`connected`, `static`, `ospf`). Chaque **voisin** accepte l'IP, l'AS distant, une description, l'interface source (`update-source`), `ebgp-multihop`, les timers keepalive/hold, les options iBGP `next-hop-self` / `route-reflector-client` / `send-community`, et les route-maps entrante/sortante. Les blocs **Prefix-lists**, **Community-lists** et **Route-maps** permettent de filtrer et de modifier les annonces (match préfixe/communauté ; `set local-preference`, `metric`, `community`, `as-path prepend`). Contrôle : `vtysh -c "show bgp summary"` via le *Test rapide*.
- **Agrégation de liens / EtherChannel** (panneau « Agrégation de liens ») : cochez l'option, puis pour chaque agrégation choisissez un nom (`bond0`), un mode (`802.3ad`/LACP, `active-backup`, `balance-rr`, `balance-xor`) et cochez les ports membres. Les membres sont esclaves du bond et **disparaissent de la liste des ports du switch** : c'est le bond qui devient port du bridge et porte la configuration VLAN (trunk ou access). Configurez la même agrégation des deux côtés du lien.
- **Texte** pose une annotation après saisie. **Zone** permet de dessiner un rectangle (minimum 20 px); un double-clic sur la zone permet de modifier sa taille au format `LxH`.
- **Sélection** permet de déplacer les nœuds. Cliquez un élément puis appuyez sur Suppr pour le supprimer. Les raccourcis d'outils visibles à l'écran sont disponibles lorsque le focus n'est pas dans un champ; `Ctrl+S` sauvegarde.
- Utilisez **Sauvegarder** / **Charger** pour conserver/restaurer nœuds, liens, textes et dimensions des zones.
- **Déployer** génère `lab.clab.yml` puis appelle `sudo containerlab deploy -t … --reconfigure`. **Détruire** appelle `sudo containerlab destroy -t … --cleanup`.
- **Test rapide** exécute `docker exec clab-webui-<nœud> sh -c <commande>` et affiche stdout/stderr dans la console (ex. `r1` / `ip a`).

## Limites et sécurité

- Cytoscape.js est chargé depuis Unpkg : une connexion au CDN est nécessaire. Les annotations (textes et zones) ne figurent pas dans le YAML Containerlab.
- La suppression des conteneurs/ressources Containerlab est une action destructive. Aucun déploiement n'est lancé sans action explicite; la destruction demande confirmation dans l'interface.
- Le serveur Flask n'intègre ni authentification, ni HTTPS, ni protection CSRF et écoute sur `0.0.0.0`. Utilisez-le sur une machine/réseau de confiance seulement. `/api/exec` permet d'exécuter une commande dans un conteneur du laboratoire.
- Les images des nœuds sont génériques; la configuration avancée des équipements et les paramètres propres à chaque scénario ne sont pas gérés par cet éditeur.
- **VTP n'est pas pris en charge** : c'est un protocole propriétaire Cisco, sans équivalent sous Linux. Il n'existe pas de moyen de le simuler fidèlement avec des bridges Linux, l'option a donc été écartée.
- Pour que le routage du laboratoire fonctionne, l'entrypoint active le *forwarding* IPv4/IPv6 sur les nœuds configurés en IP et **retire la route par défaut de l'interface de management** (`eth0`, métrique 0) posée par containerlab : sans cela, elle court-circuite les routes du lab. Le sous-réseau de management reste joignable via sa route connectée, donc `docker exec` et l'accès de gestion continuent de fonctionner.
- Les switchs ont STP activé par défaut : un port met environ 30 secondes à passer en `forwarding` (délais STP standards). Un client DHCP peut donc attendre ce délai avant d'obtenir son bail. Désactivez STP pour un lab où les boucles sont impossibles.
- La route par défaut de l'interface de management est retirée **avant** l'ajout des routes du nœud : sinon `ip route add default` échoue en « File exists » (deux routes par défaut de même métrique), et un hôte se retrouve sans route par défaut.
- BGP est limité à l'**IPv4** (`address-family ipv4 unicast`). La configuration générée contient `no bgp ebgp-requires-policy` : depuis FRR 8, un eBGP sans politique n'annonce ni n'accepte rien, ce qui est surprenant lors d'un premier test.
- Une **route-map sortante filtre réellement** : un préfixe absent de la prefix-list autorisée n'est pas annoncé au voisin. C'est le comportement attendu, mais il faut y penser quand un préfixe « manque » côté voisin.
- **MPLS/LDP a besoin d'un IGP** pour distribuer des étiquettes vers des préfixes distants : sans OSPF sur le même nœud, seules les étiquettes locales apparaissent et aucun LSP ne se construit.
- LDP fait du **PHP** (*penultimate hop popping*) par défaut : l'avant-dernier routeur dépile l'étiquette et le dernier saut reçoit de l'IP nue. C'est conforme, mais une capture sur le dernier lien ne montre donc aucune étiquette.
- La validation **refuse une adresse d'interface qui est l'adresse de diffusion de son sous-réseau** (sur un `/30`, utilisez `.1` et `.2`). Ce piège casse silencieusement OSPF, BGP et LDP : l'adjacence reste bloquée en `Exchange`/`ExStart` sans message d'erreur explicite.
- **IPsec** : en mode `trap` (défaut), le tunnel n'apparaît dans `swanctl --list-sas` qu'après le premier paquet. N'utilisez le mode `start` que sur **un seul** côté : si les deux extrémités amorcent en même temps, deux CHILD SA concurrents se créent et chacun ne sert que dans un sens. Seuls le PSK et l'IPv4 sont gérés (pas de certificats). Les interfaces **XFRM** ne sont pas supportées par ce noyau (pas de VPN route-based par interface XFRM) ; les interfaces **VTI**, elles, le sont.
- **GRE** : le noyau refuse de créer un tunnel dont l'adresse locale n'existe pas encore — l'entrypoint crée donc les tunnels **après** l'adressage des interfaces physiques.
- OSPF sur un segment partagé (deux routeurs reliés directement, type de réseau `broadcast`) élit un DR : l'élection n'a lieu qu'à l'expiration du *wait timer* (40 s par défaut, égal au `dead interval`). Les voisins restent en `2-Way` puis passent en `Full` après ce délai. Pour un lien strictement point à point, une topologie réelle utiliserait `ip ospf network point-to-point`.
- VRRP s'appuie sur le `vrrpd` de FRR, qui exige des interfaces **macvlan** : elles sont créées automatiquement par l'entrypoint. Seul l'**IPv4** est pris en charge (l'IPv6 demanderait `addrgenmode random` et un traitement distinct). Les adresses virtuelles doivent appartenir au sous-réseau de l'interface et ne pas être déjà portées par le nœud — ces deux points sont vérifiés à la sauvegarde.
- Ne redémarrez pas un conteneur du laboratoire avec `docker stop` / `docker start` : les liens veth sont créés par containerlab et ne sont pas rétablis, l'interface `eth1` disparaît alors du nœud (les conteneurs restants ne communiquent plus). Utilisez le bouton **Déployer** pour recréer le laboratoire.
- Une agrégation exige au moins **deux ports membres**, chaque port ne pouvant appartenir qu'à une seule agrégation, et les membres doivent être des liens réellement connectés — ces trois points sont vérifiés à la sauvegarde. En mode `802.3ad`, les deux extrémités doivent utiliser le même mode pour que le LACP se négocie (vérifiable avec `cat /proc/net/bonding/bond0` : les esclaves doivent partager le même *Aggregator ID*).
