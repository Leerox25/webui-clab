# État du projet — note de reprise

_Dernière mise à jour : 19/11/2026_

## Où en est le projet

Application Flask + UI web au-dessus de containerlab. Tout est livré et **testé en
déploiement réel** sur ce Mac (Docker Desktop, arm64) :

| Brique | État |
|---|---|
| Image unique `lab01/node:latest` (bridge, VLAN, FRR, keepalived, dnsmasq) | ✔ |
| Adressage IP : statique IPv4/IPv6, sous-interfaces 802.1Q, MTU/MAC, loopback, routes statiques | ✔ |
| Client DHCP (udhcpc) et serveur DHCP (dnsmasq) | ✔ |
| Switch : bridge, VLAN access/trunk, VLAN natif, plages (`10-20,30`), base VLAN nommée, STP + priorité | ✔ |
| SVI par VLAN sur le switch (switch L3) | ✔ |
| OSPF (router-id, aires multiples, réseaux, interfaces passives, coûts) | ✔ |
| BGP (AS, voisins, réseaux, redistribution, iBGP/RR/next-hop-self, prefix-lists, community-lists, route-maps, prepend/LP/MED/communities, multihop, timers) | ✔ |
| MPLS / LDP (router-id, adresse de transport, interfaces ; platform_labels levé par l'entrypoint) | ✔ |
| IPsec (tunnels site-à-site IKEv2/PSK, sélecteurs de trafic, propositions) | ✔ |
| Tunnel GRE (local/remote, TTL, clé ; interface routable) | ✔ |
| VRRP (`vrrpd` de FRR, macvlan créées par l'entrypoint) | ✔ |
| EtherChannel (802.3ad/LACP, active-backup, balance-rr, balance-xor) | ✔ |
| VTP | ✗ écarté : propriétaire Cisco, aucune équivalence Linux |

## Environnement — capacités du noyau vérifiées

| Brique | Verdict |
|---|---|
| bonding (LACP), bridge, VLAN 802.1Q, macvlan | ✅ |
| WireGuard, VXLAN, GRE/gretap | ✅ |
| MPLS | ✅ **mais** `net.mpls.platform_labels` vaut 0 par défaut : il faut le lever à `1048575` |
| Multicast (`mc_forwarding`, `/proc/net/igmp`) | ✅ à confirmer avec `pimd` |
| `tc` / netem | ✅ |
| VRF | ❌ non supporté → pas de MPLS L3VPN |
| iptables / nftables | ❌ pas de NAT ni de pare-feu |
| IP-in-IP | ⚠️ fait planter la VM Docker Desktop |

Démons disponibles dans l'image : `bgpd`, `ospfd`, `ospf6d`, `isisd`, `ripd`,
`eigrpd`, `babeld`, `ldpd`, `pimd`, `bfdd`, `pbrd`, `fabricd`, `pathd`, `staticd`, `mgmtd`.

## Prochaines étapes proposées

1. **WireGuard** — dernier protocole du brief d'origine.
2. Puis, selon l'envie : **SR-MPLS** (Segment Routing), OSPFv3, IS-IS, BFD,
   `tc`/netem (simulation de panne), BGP EVPN + VXLAN, IPsec *route-based* via VTI.

## Pièges rencontrés (à ne pas rechercher deux fois)

- **LDP dans `frr.conf`** : le bloc `mpls ldp` doit être écrit **avant** `router ospf`
  et `router bgp`, sinon FRR rejette `address-family ipv4` (les trois nœuds exposent
  un `address-family`, et l'ordre les fait entrer en conflit). Le sous-nœud
  `interface` se referme par `exit`, jamais par `!`.
- **Adresse de diffusion** : une adresse d'interface égale à l'adresse de diffusion
  de son sous-réseau (sur un `/30`, la `.3`) casse OSPF/BGP/LDP sans message clair.
  La validation le refuse désormais.
- **VRRP** : `vrrpd` de FRR ne crée pas ses interfaces macvlan, et l'option
  `addrgenmode random` fait échouer leur création sur ce noyau.
- **IPsec** : charon est à `/usr/lib/strongswan/charon` sur Alpine ; les secrets PSK
  doivent être nommés `ike-<nom>` (sinon « unsupported secret ») ; amorcer les deux
  côtés crée deux CHILD SA — le mode `trap` par défaut évite cela.
- **GRE** : impossible de créer le tunnel avant que son adresse locale existe.
- **IP-in-IP** (`type ipip`) fait **planter la VM Docker Desktop** : à ne jamais
  utiliser dans une sonde. Un crash de la VM laisse les conteneurs clab sans leurs
  liens veth — un redéploiement via l'application les restaure.

## Relancer

```sh
cd /Users/eliott/webui-clab-mac
./run-mac.sh          # construit lab01/node puis docker compose up --build
```

Interface : <http://localhost:5001>. Le bouton **Déployer** recrée le laboratoire
depuis `lab/state.json` (dernière topologie enregistrée : trunk à VLAN natif,
4 PC, base VLAN, SVI).

## Points d'attention pour la reprise

- Après modification de `app.py` ou de `static/` : `docker compose up -d --build`
  (l'application est copiée dans l'image, un simple redémarrage ne suffit pas).
- Après modification de `nodes/` : `docker build -t lab01/node:latest nodes/`
  (containerlab ne construit pas cette image).
- Ne jamais faire `docker stop` / `docker start` sur un conteneur du lab : les
  liens veth sont créés par containerlab et ne sont pas rétablis.
- `Dockerfile-2` est un doublon inutilisé de `Dockerfile` (seul `EXPOSE` diffère).
- Les contrôles à repasser après chaque modification :
  `python3 -m py_compile app.py`, `sh -n nodes/entrypoint.sh`,
  `node --check` sur le script extrait de `static/index.html`.
