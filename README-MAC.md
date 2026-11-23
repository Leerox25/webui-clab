# webui-clab sur macOS avec Docker Desktop

Cette variante lance l’éditeur Flask et Containerlab dans un conteneur Linux, sans WSL ni installation de paquets avec `apt` sur le Mac. Docker Desktop doit être installé, démarré et prêt à utiliser. Une connexion Internet est nécessaire au premier build pour télécharger l’image Ubuntu et les paquets/outils.

## Démarrage

1. Décompressez `webui-clab-mac.zip` dans un dossier.
2. Dans Terminal, placez-vous dans ce dossier puis exécutez :

   ```sh
   ./run-mac.sh
   ```

   Le script crée `lab/` si nécessaire, construit l’image des nœuds `lab01/node:latest` (nécessaire avant tout déploiement) puis lance `docker compose up --build`.
3. Ouvrez <http://localhost:5001>.

Pour arrêter, faites `Ctrl+C` dans le terminal, puis exécutez au besoin :

```sh
docker compose down
```

L’état de l’éditeur et le fichier généré `lab.clab.yml` sont dans `./lab` sur le Mac. Ce dossier est monté dans le conteneur **avec le même chemin absolu** (`${PWD}/lab`) : c’est indispensable, car les fichiers de configuration référencés dans le YAML Containerlab (par exemple `configs/sw1.json`) sont résolus par le démon Docker de l’hôte, donc le chemin doit exister à l’identique sur le Mac et dans le conteneur. L’état JSON est `lab/state.json`.

## Ce que fait la configuration

L’image part d’Ubuntu, installe Python 3, Flask, PyYAML et Containerlab (avec la procédure officielle d’installation). Compose transmet le socket Docker Desktop à l’application, publie le port 5001 (port d’écoute de Flask) et active `privileged` et `pid: host`, utilisés par Containerlab pour créer les labs. Le processus étant root dans le conteneur, l’application invoque Containerlab sans `sudo` (`CLAB_SUDO=0`). Le démon Docker reste celui de Docker Desktop : aucun démon Docker séparé n’est lancé dans l’image.

Une seconde image, `lab01/node:latest`, est construite par `run-mac.sh` à partir de `nodes/` : elle sert à tous les nœuds du laboratoire (switch, routeur, PC, serveur) et embarque `iproute2`, `bridge-utils`, `frr`, `keepalived` et `dnsmasq`. Elle est native à l’architecture de la machine (arm64 sur Apple Silicon), donc sans émulation.

Le montage du socket Docker donne à l’application un contrôle très étendu sur le démon et les conteneurs visibles par Docker Desktop. Utilisez-la uniquement localement et avec des laboratoires de confiance. L’interface n’a pas d’authentification ni de HTTPS. Le port publié est accessible via l’hôte; ne l’exposez pas à un réseau non fiable.

## Limites connues — macOS

Docker Desktop exécute les conteneurs dans une VM Linux. Containerlab est conçu pour Linux; les opérations réseau nécessaires à la création des topologies dépendent de cette VM et de Docker Desktop. Les labs simples reposant sur les images FRR et Alpine fonctionnent généralement dans cet environnement, mais **ce mode macOS n’a pas été testé ici** et le fonctionnement de tous les types de liens/topologies n’est pas garanti.

Sur Apple Silicon, les images `frrouting/frr` et `alpine` utilisées par l’éditeur sont multi-architecture. Des images tierces ou des équipements demandant une architecture/capacité particulière peuvent nécessiter une configuration spécifique. Les performances et le comportement réseau peuvent différer d’un hôte Linux natif.

Cytoscape.js est embarqué dans `static/vendor/` : l’interface fonctionne sans accès Internet. Gardez Docker Desktop démarré pendant l’utilisation.

## Fichiers fournis

- `app.py` et `static/index.html` : application et interface web.
- `Dockerfile`, `docker-compose.yml`, `run-mac.sh` : construction et lancement sur Mac.
- `README.md` : instructions générales de la version Linux/WSL.
- `install.sh` : installation de la variante Linux/WSL (pas nécessaire sur macOS).
