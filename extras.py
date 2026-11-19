"""Options de configuration avancées (programme CCNP), toutes optionnelles.

Principe de sûreté : ce module ne change rien tant qu'une option n'est pas
renseignée. Les entrées sont validées ici (listes blanches et regex strictes),
puis rendues en texte :
  - lignes FRR supplémentaires (« frrExtra ») ajoutées à frr.conf,
  - démons FRR à activer (« frrDaemons »),
  - commandes noyau (« tune ») : STP par port, timers du bridge, netem, routes
    à métrique.
Le rendu est du texte pur : il se teste sans Docker (voir tests/).
"""
import ipaddress
import re

DEV_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,14}$")
TAG_RE = re.compile(r"^[A-Za-z0-9_-]{1,16}$")
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,16}$")
NET_RE = re.compile(r"^[0-9a-f]{2}(\.[0-9a-f]{4}){4,9}\.00$")


def _int(value, label, lo, hi):
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} : entier attendu.")
    if not lo <= n <= hi:
        raise ValueError(f"{label} : valeur hors limites ({lo}-{hi}).")
    return n


def _dev(value, label="Interface"):
    value = str(value).strip()
    if not DEV_RE.fullmatch(value):
        raise ValueError(f"{label} invalide : {value}")
    return value


def _net4(value, label="Réseau"):
    try:
        net = ipaddress.ip_network(str(value).strip(), strict=False)
    except ValueError:
        raise ValueError(f"{label} invalide : {value}")
    if net.version != 4:
        raise ValueError(f"{label} : IPv4 uniquement ({value}).")
    return str(net)


def _subset(values, allowed, label):
    out = []
    for v in values or []:
        v = str(v).strip()
        if not v:
            continue
        if v not in allowed:
            raise ValueError(f"{label} : « {v} » non pris en charge ({', '.join(allowed)}).")
        if v not in out:
            out.append(v)
    return out


def _rid(value, label):
    if value in (None, ""):
        return None
    try:
        return str(ipaddress.IPv4Address(str(value).strip()))
    except ValueError:
        raise ValueError(f"{label} invalide : {value}")


# ----------------------------------------------------------------- validation
OSPF_REDIST = ("connected", "static", "bgp", "rip", "isis", "eigrp")
OSPF_AREA_TYPES = ("", "stub", "totally-stub", "nssa", "totally-nssa")


def clean_area_type(area, item):
    kind = str(area.get("type") or "").strip()
    if kind not in OSPF_AREA_TYPES:
        raise ValueError(f"OSPF aire {item['id']} : type inconnu ({kind}).")
    if kind:
        if item["id"] == "0.0.0.0":
            raise ValueError("OSPF : l'aire 0 (backbone) ne peut pas être stub ni NSSA.")
        item["type"] = kind


def clean_ospf_extra(cfg, out):
    """Options OSPF avancées, ajoutées à `out` (dict déjà validé)."""
    if cfg.get("autoCostRef") not in (None, ""):
        out["autoCostRef"] = _int(cfg["autoCostRef"], "OSPF auto-cost (Mbit/s)", 1, 4294967)
    dflt = str(cfg.get("defaultOriginate") or "")
    if dflt not in ("", "on", "always"):
        raise ValueError("OSPF default-information : « on » ou « always » attendu.")
    if dflt:
        out["defaultOriginate"] = dflt
    redist = _subset(cfg.get("redistribute"), OSPF_REDIST, "OSPF redistribution")
    if redist:
        out["redistribute"] = redist
    opts = {}
    for dev, o in (cfg.get("ifOptions") or {}).items():
        dev = _dev(dev, "OSPF interface")
        if not isinstance(o, dict):
            raise ValueError(f"OSPF {dev} : options invalides.")
        item = {}
        net = str(o.get("network") or "")
        if net not in ("", "point-to-point", "broadcast"):
            raise ValueError(f"OSPF {dev} : type de réseau inconnu ({net}).")
        if net:
            item["network"] = net
        for key, label, lo, hi in (("hello", "hello-interval", 1, 65535), ("dead", "dead-interval", 1, 65535),
                                   ("priority", "priorité DR", 0, 255)):
            if o.get(key) not in (None, ""):
                item[key] = _int(o[key], f"OSPF {dev} {label}", lo, hi)
        if "hello" in item and "dead" in item and item["dead"] <= item["hello"]:
            raise ValueError(f"OSPF {dev} : le dead-interval doit dépasser le hello-interval.")
        key = str(o.get("authKey") or "")
        if key:
            if not KEY_RE.fullmatch(key):
                raise ValueError(f"OSPF {dev} : clé MD5 invalide (1-16 caractères : lettres, chiffres, - _).")
            item["authKey"] = key
        if o.get("bfd"):
            item["bfd"] = True
        if item:
            opts[dev] = item
    if opts:
        out["ifOptions"] = opts


def clean_rip_config(cfg):
    if cfg is None:
        return None
    if not isinstance(cfg, dict):
        raise ValueError("Configuration RIP invalide.")
    out = {"networks": [_net4(n, "RIP réseau") for n in cfg.get("networks") or []]}
    if not out["networks"]:
        raise ValueError("RIP : au moins un réseau est nécessaire.")
    out["passive"] = [_dev(d, "RIP interface passive") for d in cfg.get("passive") or [] if str(d).strip()]
    out["redistribute"] = _subset(cfg.get("redistribute"), ("connected", "static", "ospf", "bgp"), "RIP redistribution")
    out["defaultOriginate"] = bool(cfg.get("defaultOriginate"))
    return out


def clean_eigrp_config(cfg):
    if cfg is None:
        return None
    if not isinstance(cfg, dict):
        raise ValueError("Configuration EIGRP invalide.")
    out = {"asn": _int(cfg.get("asn"), "EIGRP numéro d'AS", 1, 65535)}
    rid = _rid(cfg.get("routerId"), "EIGRP router-id")
    if rid:
        out["routerId"] = rid
    out["networks"] = [_net4(n, "EIGRP réseau") for n in cfg.get("networks") or []]
    if not out["networks"]:
        raise ValueError("EIGRP : au moins un réseau est nécessaire.")
    out["passive"] = [_dev(d, "EIGRP interface passive") for d in cfg.get("passive") or [] if str(d).strip()]
    out["redistribute"] = _subset(cfg.get("redistribute"), ("connected", "static", "ospf", "bgp"), "EIGRP redistribution")
    if cfg.get("variance") not in (None, ""):
        out["variance"] = _int(cfg["variance"], "EIGRP variance", 1, 128)
    return out


def clean_isis_config(cfg):
    if cfg is None:
        return None
    if not isinstance(cfg, dict):
        raise ValueError("Configuration IS-IS invalide.")
    tag = str(cfg.get("tag") or "LAB").strip()
    if not TAG_RE.fullmatch(tag):
        raise ValueError("IS-IS : nom de processus invalide (1-16 caractères : lettres, chiffres, - _).")
    net = str(cfg.get("net") or "").strip().lower()
    if not NET_RE.fullmatch(net):
        raise ValueError("IS-IS : NET invalide (format attendu 49.0001.0000.0000.0001.00).")
    level = str(cfg.get("level") or "level-2-only")
    if level not in ("level-1", "level-1-2", "level-2-only"):
        raise ValueError("IS-IS : niveau inconnu.")
    out = {"tag": tag, "net": net, "level": level, "loopback": cfg.get("loopback") is not False,
           "redistribute": _subset(cfg.get("redistribute"), ("connected", "static"), "IS-IS redistribution"),
           "interfaces": []}
    seen = set()
    for it in cfg.get("interfaces") or []:
        if not isinstance(it, dict):
            raise ValueError("IS-IS : interface invalide.")
        dev = _dev(it.get("dev"), "IS-IS interface")
        if dev in seen:
            raise ValueError(f"IS-IS : interface {dev} dupliquée.")
        seen.add(dev)
        item = {"dev": dev}
        if it.get("metric") not in (None, ""):
            item["metric"] = _int(it["metric"], f"IS-IS {dev} métrique", 1, 16777214)
        if str(it.get("network") or "") == "point-to-point":
            item["network"] = "point-to-point"
        if it.get("passive"):
            item["passive"] = True
        out["interfaces"].append(item)
    if not out["interfaces"] and not out["loopback"]:
        raise ValueError("IS-IS : activez au moins une interface.")
    return out


def clean_l2_config(cfg):
    """Options L2 avancées d'un switch : timers STP, vieillissement MAC, IGMP snooping, STP par port."""
    if cfg is None:
        return None
    if not isinstance(cfg, dict):
        raise ValueError("Options L2 invalides.")
    out = {}
    if cfg.get("ageing") not in (None, ""):
        out["ageing"] = _int(cfg["ageing"], "Vieillissement MAC (s)", 10, 1000000)
    timers = {k: cfg.get(k) for k in ("hello", "forwardDelay", "maxAge") if cfg.get(k) not in (None, "")}
    if timers:
        hello = _int(timers.get("hello", 2), "STP hello-time (s)", 1, 10)
        fwd = _int(timers.get("forwardDelay", 15), "STP forward-delay (s)", 4, 30)
        age = _int(timers.get("maxAge", 20), "STP max-age (s)", 6, 40)
        if age < 2 * (hello + 1):
            raise ValueError("STP : max-age doit valoir au moins 2 × (hello + 1).")
        if age > 2 * (fwd - 1):
            raise ValueError("STP : max-age doit valoir au plus 2 × (forward-delay − 1).")
        out.update({"hello": hello, "forwardDelay": fwd, "maxAge": age})
    if cfg.get("mcastSnooping"):
        out["mcastSnooping"] = True
        if cfg.get("mcastQuerier"):
            out["mcastQuerier"] = True
    ports = {}
    for dev, p in (cfg.get("ports") or {}).items():
        dev = _dev(dev, "STP port")
        if not isinstance(p, dict):
            raise ValueError(f"STP {dev} : options invalides.")
        item = {}
        if p.get("cost") not in (None, ""):
            item["cost"] = _int(p["cost"], f"STP {dev} coût", 1, 200000000)
        if p.get("priority") not in (None, ""):
            item["priority"] = _int(p["priority"], f"STP {dev} priorité", 0, 63)
        if p.get("rootGuard"):
            item["rootGuard"] = True
        if p.get("bpduGuard"):
            item["bpduGuard"] = True
        if item:
            ports[dev] = item
    if ports:
        out["ports"] = ports
    return out or None


def clean_link(dev, link):
    """Qualité de lien simulée (tc netem) sur une interface."""
    if not link:
        return None
    if not isinstance(link, dict):
        raise ValueError(f"{dev} : qualité de lien invalide.")
    out = {}
    if link.get("delay") not in (None, ""):
        out["delay"] = _int(link["delay"], f"{dev} délai (ms)", 0, 60000)
    if link.get("jitter") not in (None, ""):
        out["jitter"] = _int(link["jitter"], f"{dev} gigue (ms)", 0, 60000)
        if "delay" not in out or out["delay"] == 0:
            raise ValueError(f"{dev} : la gigue nécessite un délai.")
    if link.get("loss") not in (None, ""):
        try:
            loss = float(link["loss"])
        except (TypeError, ValueError):
            raise ValueError(f"{dev} : perte invalide.")
        if not 0 <= loss <= 100:
            raise ValueError(f"{dev} : perte hors limites (0-100 %).")
        out["loss"] = round(loss, 2)
    if link.get("rate") not in (None, ""):
        out["rate"] = _int(link["rate"], f"{dev} débit (kbit/s)", 8, 10000000)
    return out or None


def clean_metric(value):
    if value in (None, ""):
        return None
    return _int(value, "Métrique de route", 1, 65535)


# --------------------------------------------------------------------- rendu
def frr_extra(node):
    """Retourne (lignes FRR à ajouter, démons à activer)."""
    lines, daemons = [], []

    def block(header, body):
        lines.extend([header, *(" " + b for b in body), "exit", "!"])

    ospf = node.get("ospf")
    if ospf:
        body = []
        if ospf.get("autoCostRef"):
            body.append(f"auto-cost reference-bandwidth {ospf['autoCostRef']}")
        for area in ospf.get("areas", []):
            kind = area.get("type")
            if kind == "stub":
                body.append(f"area {area['id']} stub")
            elif kind == "totally-stub":
                body.append(f"area {area['id']} stub no-summary")
            elif kind == "nssa":
                body.append(f"area {area['id']} nssa")
            elif kind == "totally-nssa":
                body.append(f"area {area['id']} nssa no-summary")
        if ospf.get("defaultOriginate"):
            body.append("default-information originate" + (" always" if ospf["defaultOriginate"] == "always" else ""))
        for proto in ospf.get("redistribute", []):
            body.append(f"redistribute {proto}")
        if body:
            block("router ospf", body)
        for dev, o in (ospf.get("ifOptions") or {}).items():
            ib = []
            if o.get("network"):
                ib.append(f"ip ospf network {o['network']}")
            if "hello" in o:
                ib.append(f"ip ospf hello-interval {o['hello']}")
            if "dead" in o:
                ib.append(f"ip ospf dead-interval {o['dead']}")
            if "priority" in o:
                ib.append(f"ip ospf priority {o['priority']}")
            if o.get("authKey"):
                ib.append("ip ospf authentication message-digest")
                ib.append(f"ip ospf message-digest-key 1 md5 {o['authKey']}")
            if o.get("bfd"):
                ib.append("ip ospf bfd")
                if "bfdd" not in daemons:
                    daemons.append("bfdd")
            if ib:
                block(f"interface {dev}", ib)

    rip = node.get("rip")
    if rip:
        body = ["version 2"]
        body += [f"network {n}" for n in rip["networks"]]
        body += [f"passive-interface {d}" for d in rip.get("passive", [])]
        body += [f"redistribute {p}" for p in rip.get("redistribute", [])]
        if rip.get("defaultOriginate"):
            body.append("default-information originate")
        block("router rip", body)
        daemons.append("ripd")

    eigrp = node.get("eigrp")
    if eigrp:
        body = []
        if eigrp.get("routerId"):
            body.append(f"eigrp router-id {eigrp['routerId']}")
        body += [f"network {n}" for n in eigrp["networks"]]
        body += [f"passive-interface {d}" for d in eigrp.get("passive", [])]
        body += [f"redistribute {p}" for p in eigrp.get("redistribute", [])]
        if eigrp.get("variance"):
            body.append(f"variance {eigrp['variance']}")
        block(f"router eigrp {eigrp['asn']}", body)
        daemons.append("eigrpd")

    isis = node.get("isis")
    if isis:
        body = [f"net {isis['net']}", f"is-type {isis['level']}", "metric-style wide"]
        lvl = "level-1" if isis["level"] == "level-1" else "level-2"
        body += [f"redistribute ipv4 {p} {lvl}" for p in isis.get("redistribute", [])]
        block(f"router isis {isis['tag']}", body)
        ifaces = list(isis["interfaces"])
        if isis.get("loopback") and not any(i["dev"] == "lo" for i in ifaces):
            ifaces.append({"dev": "lo", "passive": True})
        for it in ifaces:
            ib = [f"ip router isis {isis['tag']}"]
            if it.get("network"):
                ib.append("isis network point-to-point")
            if it.get("metric"):
                ib.append(f"isis metric {it['metric']}")
            if it.get("passive"):
                ib.append("isis passive")
            block(f"interface {it['dev']}", ib)
        daemons.append("isisd")
    return lines, daemons


def tune_commands(node):
    """Commandes noyau (sh) exécutées en fin de démarrage du nœud."""
    cmds = []
    l2 = node.get("l2")
    if l2:
        br = []
        if "ageing" in l2:
            br.append(f"ageing_time {l2['ageing'] * 100}")
        if "hello" in l2:
            br += [f"forward_delay {l2['forwardDelay'] * 100}", f"hello_time {l2['hello'] * 100}",
                   f"max_age {l2['maxAge'] * 100}"]
        if l2.get("mcastSnooping"):
            br.append("mcast_snooping 1")
            if l2.get("mcastQuerier"):
                br.append("mcast_querier 1")
        if br:
            cmds.append("ip link set dev br0 type bridge " + " ".join(br))
        for dev, p in (l2.get("ports") or {}).items():
            opts = []
            if "cost" in p:
                opts.append(f"cost {p['cost']}")
            if "priority" in p:
                opts.append(f"priority {p['priority']}")
            if p.get("rootGuard"):
                opts.append("root_block on")
            if p.get("bpduGuard"):
                opts.append("guard on")
            if opts:
                cmds.append(f"ip link set dev {dev} type bridge_slave " + " ".join(opts))
    for iface in (node.get("ip") or {}).get("ifaces", []):
        link = iface.get("link")
        if not link:
            continue
        parts = [f"tc qdisc replace dev {iface['dev']} root netem"]
        if "delay" in link:
            parts.append(f"delay {link['delay']}ms" + (f" {link['jitter']}ms" if link.get("jitter") else ""))
        if "loss" in link:
            parts.append(f"loss {link['loss']}%")
        if "rate" in link:
            parts.append(f"rate {link['rate']}kbit")
        if len(parts) > 1:
            cmds.append(" ".join(parts))
    for route in (node.get("ip") or {}).get("routes", []):
        if "metric" in route:
            cmd = ("ip -6 route add " if ":" in route["dst"] else "ip route add ") + route["dst"]
            if route.get("via"):
                cmd += f" via {route['via']}"
            if route.get("dev"):
                cmd += f" dev {route['dev']}"
            cmds.append(cmd + f" metric {route['metric']}")
    return cmds
