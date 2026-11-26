#!/usr/bin/env python3
"""Éditeur Web minimal pour des laboratoires containerlab."""
from pathlib import Path
import ipaddress
import json
import os
import re
import socket
import subprocess

from flask import Flask, jsonify, request, send_from_directory
import yaml

import extras

app = Flask(__name__, static_folder="static")
# Par défaut le laboratoire est créé dans ./lab, à côté de l'application : aucune
# écriture n'est imposée en dehors du dossier du projet. La variable
# d'environnement LAB_DIR permet de choisir un autre emplacement.
BASE_DIR = Path(__file__).resolve().parent
LAB_DIR = Path(os.environ.get("LAB_DIR", str(BASE_DIR / "lab"))).expanduser()
STATE_FILE = LAB_DIR / "state.json"
TOPO_FILE = LAB_DIR / "lab.clab.yml"
CONFIG_DIR = LAB_DIR / "configs"

# Image unique : elle embarque le bridge, FRR, keepalived et dnsmasq. Tous les
# types de nœuds l'utilisent afin que l'adressage IP soit appliqué partout.
NODE_IMAGE = "lab01/node:latest"
LAB_NAME = "webui"
NODE_TYPES = {"router": NODE_IMAGE, "switch": NODE_IMAGE,
            "pc": NODE_IMAGE, "server": NODE_IMAGE}
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,48}$")
PORT_RE = re.compile(r"^(eth[0-9]{1,3}|bond[0-9]{1,2})$")
DEV_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,14}$")
MAC_RE = re.compile(r"^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$")
BOND_RE = re.compile(r"^bond[0-9]{1,2}$")
LAG_MODES = ("802.3ad", "active-backup", "balance-rr", "balance-xor")
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
COMMUNITY_RE = re.compile(r"^[0-9]{1,10}:[0-9]{1,10}$")
BGP_REDISTRIBUTE = ("connected", "static", "ospf")


def parse_vlan_list(value):
    """Accepte [10, 20] ou « 10-20,30 » et renvoie une liste triée d'entiers."""
    if value in (None, ""):
        return []
    items = value if isinstance(value, (list, tuple)) else str(value).replace(";", ",").split(",")
    out = []
    for item in items:
        text = str(item).strip()
        if not text:
            continue
        if "-" in text:
            start, _, end = text.partition("-")
            try:
                start, end = int(start), int(end)
            except ValueError:
                raise ValueError(f"Plage de VLANs invalide : {text}")
            if start > end:
                raise ValueError(f"Plage de VLANs inversée : {text}")
            out.extend(range(start, end + 1))
        else:
            try:
                out.append(int(text))
            except ValueError:
                raise ValueError(f"VLAN invalide : {text}")
    return sorted(set(out))


def clean_vlan_database(value):
    """Valide la base VLAN locale d'un switch (identifiant + nom)."""
    if value in (None, ""):
        return None
    if not isinstance(value, list):
        raise ValueError("Base VLAN invalide.")
    out, seen = [], set()
    for entry in value:
        if not isinstance(entry, dict):
            raise ValueError("Entrée de base VLAN invalide.")
        try:
            vid = int(entry.get("id", 0))
        except (TypeError, ValueError):
            raise ValueError("Identifiant de VLAN invalide.")
        if not 1 <= vid <= 4094 or vid in seen:
            raise ValueError(f"VLAN {vid} invalide ou en double dans la base.")
        seen.add(vid)
        name = str(entry.get("name", "")).strip()[:32]
        out.append({"id": vid, "name": name} if name else {"id": vid})
    return out or None


def clean_switch_config(cfg):
    """Valide la config d'un switch : STP, base VLAN, ports access/trunk."""
    if cfg is None:
        return None
    if not isinstance(cfg, dict):
        raise ValueError("Config de switch invalide.")
    out = {"stp": bool(cfg.get("stp", True)), "ports": {}}
    prio = int(cfg.get("priority", 32768))
    if prio < 0 or prio > 61440:
        raise ValueError("Priorité STP hors limites (0-61440).")
    out["priority"] = prio
    vlan_db = clean_vlan_database(cfg.get("vlans"))
    if vlan_db:
        out["vlans"] = vlan_db
    for port, pc in (cfg.get("ports") or {}).items():
        if not PORT_RE.fullmatch(str(port)) or not isinstance(pc, dict):
            raise ValueError("Port de switch invalide.")
        if pc.get("mode") == "trunk":
            vlans = parse_vlan_list(pc.get("vlans"))
            if not vlans or any(v < 1 or v > 4094 for v in vlans):
                raise ValueError("VLAN de trunk invalides (1-4094).")
            item = {"mode": "trunk", "vlans": vlans}
            native = pc.get("native")
            if native not in (None, ""):
                try:
                    native = int(native)
                except (TypeError, ValueError):
                    raise ValueError(f"VLAN natif invalide sur {port}.")
                if not 1 <= native <= 4094:
                    raise ValueError(f"VLAN natif hors limites (1-4094) sur {port}.")
                if native in vlans:
                    raise ValueError(
                        f"{port} : le VLAN natif {native} figure aussi dans les VLANs taggés.")
                item["native"] = native
            out["ports"][port] = item
        else:
            try:
                vlan = int(pc.get("vlan", 1))
            except (TypeError, ValueError):
                raise ValueError("VLAN invalide (1-4094).")
            if vlan < 1 or vlan > 4094:
                raise ValueError("VLAN invalide (1-4094).")
            out["ports"][port] = {"mode": "access", "vlan": vlan}
    return out


def clean_ip(value, version):
    """Normalise « adresse/préfixe » (IPv4 ou IPv6)."""
    if value in (None, ""):
        return None
    try:
        iface = ipaddress.ip_interface(str(value).strip())
    except ValueError:
        raise ValueError(f"Adresse IP invalide : {value}")
    if version and iface.version != version:
        raise ValueError(f"Adresse IPv{version} attendue : {value}")
    return str(iface)


def clean_addr(value, version=None):
    """Normalise une adresse seule (sans préfixe)."""
    if value in (None, ""):
        return None
    try:
        addr = ipaddress.ip_address(str(value).strip())
    except ValueError:
        raise ValueError(f"Adresse invalide : {value}")
    if version and addr.version != version:
        raise ValueError(f"Adresse IPv{version} attendue : {value}")
    return str(addr)


def clean_network(value):
    if value in (None, ""):
        raise ValueError("Destination de route manquante.")
    try:
        return str(ipaddress.ip_network(str(value).strip(), strict=False))
    except ValueError:
        raise ValueError(f"Destination de route invalide : {value}")


def clean_ip_config(cfg):
    """Valide l'adressage IP d'un nœud : interfaces, VLAN 802.1Q, routes, DHCP."""
    if cfg is None:
        return None
    if not isinstance(cfg, dict):
        raise ValueError("Configuration IP invalide.")
    out = {"ifaces": [], "loopback": [], "routes": []}
    seen = set()
    for iface in cfg.get("ifaces") or []:
        if not isinstance(iface, dict):
            raise ValueError("Interface IP invalide.")
        dev = str(iface.get("dev", ""))
        if not DEV_RE.fullmatch(dev) or dev in seen:
            raise ValueError("Nom d'interface invalide ou dupliqué.")
        seen.add(dev)
        item = {"dev": dev}
        vlan = iface.get("vlan")
        if vlan:
            if not isinstance(vlan, dict):
                raise ValueError("Sous-interface VLAN invalide.")
            parent = str(vlan.get("parent", ""))
            try:
                vid = int(vlan.get("id", 0))
            except (TypeError, ValueError):
                raise ValueError("VLAN de sous-interface invalide.")
            if not DEV_RE.fullmatch(parent) or not 1 <= vid <= 4094:
                raise ValueError("Parent ou VLAN de sous-interface invalide.")
            item["vlan"] = {"parent": parent, "id": vid}
        gre = iface.get("gre")
        if gre:
            if item.get("vlan"):
                raise ValueError(f"{dev} : une interface ne peut pas être à la fois VLAN et GRE.")
            if not isinstance(gre, dict):
                raise ValueError(f"{dev} : tunnel GRE invalide.")
            try:
                tunnel = {"local": str(ipaddress.IPv4Address(str(gre.get("local", "")).strip())),
                          "remote": str(ipaddress.IPv4Address(str(gre.get("remote", "")).strip()))}
            except ValueError:
                raise ValueError(f"{dev} : adresses locale ou distante du tunnel GRE invalides.")
            if gre.get("ttl") not in (None, ""):
                try:
                    ttl = int(gre["ttl"])
                except (TypeError, ValueError):
                    raise ValueError(f"{dev} : TTL GRE invalide.")
                if not 1 <= ttl <= 255:
                    raise ValueError(f"{dev} : TTL GRE hors limites (1-255).")
                tunnel["ttl"] = ttl
            if gre.get("key") not in (None, ""):
                try:
                    key = int(gre["key"])
                except (TypeError, ValueError):
                    raise ValueError(f"{dev} : clé GRE invalide.")
                if not 0 <= key <= 4294967295:
                    raise ValueError(f"{dev} : clé GRE hors limites (0-4294967295).")
                tunnel["key"] = key
            item["gre"] = tunnel
        ipv4 = clean_ip(iface.get("ipv4"), 4)
        ipv6 = clean_ip(iface.get("ipv6"), 6)
        dhcp = bool(iface.get("dhcp", False))
        if dhcp and (ipv4 or ipv6):
            raise ValueError(f"{dev} : DHCP et adresse statique sont exclusifs.")
        if ipv4:
            item["ipv4"] = ipv4
            # Piège classique : sur un /30, la dernière adresse est celle de
            # diffusion ; l'utiliser casse le trafic unicast (OSPF, BGP, LDP…).
            network = ipaddress.ip_interface(ipv4).network
            if network.prefixlen <= 30 \
                    and ipaddress.ip_interface(ipv4).ip == network.broadcast_address:
                detail = " (sur un /30, utilisez les adresses .1 et .2)" if network.prefixlen == 30 else ""
                raise ValueError(
                    f"{dev} : {ipv4} est l'adresse de diffusion de {network}{detail}.")
        if ipv6:
            item["ipv6"] = ipv6
        if dhcp:
            item["dhcp"] = True
        mtu = iface.get("mtu")
        if mtu not in (None, ""):
            try:
                mtu = int(mtu)
            except (TypeError, ValueError):
                raise ValueError(f"{dev} : MTU invalide.")
            if not 576 <= mtu <= 65535:
                raise ValueError(f"{dev} : MTU hors limites (576-65535).")
            item["mtu"] = mtu
        mac = iface.get("mac")
        if mac:
            mac = str(mac).strip().lower()
            if not MAC_RE.fullmatch(mac):
                raise ValueError(f"{dev} : adresse MAC invalide.")
            item["mac"] = mac
        link = extras.clean_link(dev, iface.get("link"))
        if link:
            item["link"] = link
        if not dhcp and not ipv4 and not ipv6 and not item.get("vlan") and not item.get("gre") \
                and "mtu" not in item and "mac" not in item and "link" not in item:
            raise ValueError(f"{dev} : précisez une adresse, DHCP, un VLAN, un MTU ou une MAC.")
        out["ifaces"].append(item)

    for addr in cfg.get("loopback") or []:
        cleaned = clean_ip(addr, None)
        if cleaned:
            out["loopback"].append(cleaned)

    for route in cfg.get("routes") or []:
        if not isinstance(route, dict):
            raise ValueError("Route invalide.")
        item = {"dst": clean_network(route.get("dst"))}
        via, dev = clean_addr(route.get("via")), str(route.get("dev", "") or "")
        if via:
            item["via"] = via
        if dev:
            if not DEV_RE.fullmatch(dev):
                raise ValueError("Interface de route invalide.")
            item["dev"] = dev
        if not via and not dev:
            raise ValueError("Une route doit préciser une passerelle (via) ou une interface (dev).")
        metric = extras.clean_metric(route.get("metric"))
        if metric:
            item["metric"] = metric
        out["routes"].append(item)

    ds = cfg.get("dhcpServer")
    if ds:
        if not isinstance(ds, dict):
            raise ValueError("Serveur DHCP invalide.")
        dev = str(ds.get("dev", ""))
        if not DEV_RE.fullmatch(dev):
            raise ValueError("Serveur DHCP : interface invalide.")
        parts = [p.strip() for p in str(ds.get("range", "")).split(",")]
        if len(parts) != 2:
            raise ValueError("Serveur DHCP : plage attendue au format « debut,fin ».")
        start, end = clean_addr(parts[0], 4), clean_addr(parts[1], 4)
        if not start or not end:
            raise ValueError("Serveur DHCP : plage invalide.")
        item = {"dev": dev, "range": f"{start},{end}"}
        router, dns = clean_addr(ds.get("router"), 4), clean_addr(ds.get("dns"), 4)
        if router:
            item["router"] = router
        if dns:
            item["dns"] = dns
        out["dhcpServer"] = item

    if not out["ifaces"] and not out["loopback"] and not out["routes"] and "dhcpServer" not in out:
        return None
    return out


def clean_area_id(value):
    """Normalise un identifiant d'aire OSPF (notation décimale pointée)."""
    text = str(value).strip()
    if not text:
        raise ValueError("Aire OSPF manquante.")
    try:
        if "." in text:
            return str(ipaddress.IPv4Address(text))
        return str(ipaddress.IPv4Address(int(text)))
    except (ValueError, TypeError):
        raise ValueError(f"Aire OSPF invalide : {value}")


def clean_ospf_config(cfg):
    """Valide une configuration OSPF (FRR) : router-id, aires, coûts."""
    if cfg is None:
        return None
    if not isinstance(cfg, dict):
        raise ValueError("Configuration OSPF invalide.")
    out = {"areas": []}
    router_id = cfg.get("routerId")
    if router_id not in (None, ""):
        try:
            out["routerId"] = str(ipaddress.IPv4Address(str(router_id).strip()))
        except ValueError:
            raise ValueError(f"Router-id OSPF invalide : {router_id}")
    areas = cfg.get("areas") or []
    if not isinstance(areas, list) or not areas:
        raise ValueError("OSPF : au moins une aire est nécessaire.")
    for area in areas:
        if not isinstance(area, dict):
            raise ValueError("Aire OSPF invalide.")
        item = {"id": clean_area_id(area.get("id"))}
        extras.clean_area_type(area, item)
        networks = area.get("networks") or []
        if not isinstance(networks, list) or not networks:
            raise ValueError(f"OSPF aire {item['id']} : aucun réseau annoncé.")
        item["networks"] = []
        for net in networks:
            cleaned = clean_network(net)
            if ipaddress.ip_network(cleaned).version != 4:
                raise ValueError("OSPF ne prend en charge que l'IPv4.")
            item["networks"].append(cleaned)
        passive = []
        for dev in area.get("passive") or []:
            dev = str(dev).strip()
            if not dev:
                continue
            if not DEV_RE.fullmatch(dev):
                raise ValueError(f"Interface passive invalide : {dev}")
            passive.append(dev)
        if passive:
            item["passive"] = passive
        out["areas"].append(item)
    costs = {}
    for dev, cost in (cfg.get("costs") or {}).items():
        if not DEV_RE.fullmatch(str(dev)):
            raise ValueError(f"Interface de coût OSPF invalide : {dev}")
        try:
            cost = int(cost)
        except (TypeError, ValueError):
            raise ValueError(f"Coût OSPF invalide pour {dev}.")
        if not 1 <= cost <= 65535:
            raise ValueError(f"Coût OSPF hors limites (1-65535) pour {dev}.")
        costs[str(dev)] = cost
    if costs:
        out["costs"] = costs
    extras.clean_ospf_extra(cfg, out)
    return out


def clean_vrrp_config(cfg):
    """Valide des instances VRRP (FRR vrrpd)."""
    if cfg is None:
        return None
    if not isinstance(cfg, list):
        raise ValueError("Configuration VRRP invalide.")
    out, seen = [], set()
    for inst in cfg:
        if not isinstance(inst, dict):
            raise ValueError("Instance VRRP invalide.")
        dev = str(inst.get("dev", ""))
        if not DEV_RE.fullmatch(dev):
            raise ValueError("VRRP : interface invalide.")
        try:
            vrid, priority = int(inst.get("vrid", 0)), int(inst.get("priority", 100))
        except (TypeError, ValueError):
            raise ValueError("VRRP : VRID ou priorité invalide.")
        if not 1 <= vrid <= 255:
            raise ValueError("VRRP : le VRID doit être compris entre 1 et 255.")
        if not 1 <= priority <= 254:
            raise ValueError("VRRP : la priorité doit être comprise entre 1 et 254 (255 est réservé).")
        if (dev, vrid) in seen:
            raise ValueError(f"VRRP : instance {vrid} en double sur {dev}.")
        seen.add((dev, vrid))
        item = {"dev": dev, "vrid": vrid, "priority": priority}
        vips = []
        for vip in inst.get("ipv4") or []:
            cleaned = clean_ip(vip, 4)
            if not cleaned:
                continue
            if "/" not in str(vip):
                raise ValueError(f"VRRP : l'adresse virtuelle {vip} doit préciser un préfixe.")
            vips.append(cleaned)
        if not vips:
            raise ValueError(f"VRRP {dev}/{vrid} : aucune adresse virtuelle IPv4.")
        item["ipv4"] = vips
        if inst.get("preempt") is False:
            item["preempt"] = False
        out.append(item)
    return out or None


def check_vrrp_consistency(node):
    """Vérifie que les adresses virtuelles sont cohérentes avec l'adressage du nœud."""
    ip_cfg = node.get("ip") or {}
    per_dev, own = {}, set()
    for iface in ip_cfg.get("ifaces", []):
        if iface.get("ipv4"):
            addr = ipaddress.ip_interface(iface["ipv4"])
            per_dev.setdefault(iface["dev"], []).append(addr)
            own.add(str(addr.ip))
    for inst in node.get("vrrp") or []:
        parent = per_dev.get(inst["dev"])
        for vip in inst["ipv4"]:
            addr = ipaddress.ip_interface(vip)
            if str(addr.ip) in own:
                raise ValueError(f"VRRP : l'adresse virtuelle {addr.ip} est déjà portée par le nœud.")
            if parent and not any(addr.ip in a.network for a in parent):
                raise ValueError(
                    f"VRRP : l'adresse virtuelle {addr.ip} n'est pas dans le sous-réseau de {inst['dev']}.")


def clean_portchannel_config(cfg):
    """Valide les agrégations de liens (EtherChannel / bonding Linux)."""
    if cfg is None:
        return None
    if not isinstance(cfg, list):
        raise ValueError("Configuration d'agrégation invalide.")
    out, names, used = [], set(), set()
    for lag in cfg:
        if not isinstance(lag, dict):
            raise ValueError("Agrégation invalide.")
        name = str(lag.get("name", ""))
        if not BOND_RE.fullmatch(name) or name in names:
            raise ValueError(f"Nom d'agrégation invalide ou dupliqué : {name}")
        names.add(name)
        mode = str(lag.get("mode", "802.3ad"))
        if mode not in LAG_MODES:
            raise ValueError(f"Mode d'agrégation inconnu : {mode}")
        ports = []
        for port in lag.get("members") or []:
            port = str(port)
            if not PORT_RE.fullmatch(port):
                raise ValueError(f"Port d'agrégation invalide : {port}")
            if port in used:
                raise ValueError(f"Le port {port} appartient déjà à une autre agrégation.")
            used.add(port)
            ports.append(port)
        if len(ports) < 2:
            raise ValueError(f"Agrégation {name} : il faut au moins deux ports membres.")
        out.append({"name": name, "mode": mode, "members": ports})
    return out or None


def _clean_asn(value, label="numéro d'AS"):
    try:
        asn = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} invalide.")
    if not 1 <= asn <= 4294967295:
        raise ValueError(f"{label} hors limites (1-4294967295).")
    return asn


def _clean_seq(value, label):
    try:
        seq = int(value) if value not in (None, "") else 10
    except (TypeError, ValueError):
        raise ValueError(f"{label} : numéro de séquence invalide.")
    if not 1 <= seq <= 4294967295:
        raise ValueError(f"{label} : numéro de séquence hors limites.")
    return seq


def _clean_action(value, label):
    action = str(value or "permit").strip().lower()
    if action not in ("permit", "deny"):
        raise ValueError(f"{label} : action « permit » ou « deny » attendue.")
    return action


def _clean_community(value, label):
    text = str(value or "").strip()
    if not COMMUNITY_RE.fullmatch(text):
        raise ValueError(f"{label} : communauté attendue au format « AS:valeur ».")
    return text


def clean_bgp_config(cfg):
    """Valide une configuration BGP (FRR) : AS, voisins, listes, route-maps."""
    if cfg is None:
        return None
    if not isinstance(cfg, dict):
        raise ValueError("Configuration BGP invalide.")
    out = {"asn": _clean_asn(cfg.get("asn"))}
    rid = cfg.get("routerId")
    if rid not in (None, ""):
        try:
            out["routerId"] = str(ipaddress.IPv4Address(str(rid).strip()))
        except ValueError:
            raise ValueError(f"Router-id BGP invalide : {rid}")

    def name_of(entry, kind, seen):
        if not isinstance(entry, dict):
            raise ValueError(f"{kind} invalide.")
        name = str(entry.get("name", ""))
        if not NAME_RE.fullmatch(name) or name in seen:
            raise ValueError(f"Nom de {kind} invalide ou dupliqué : {name}")
        seen.add(name)
        return name

    prefix_names, prefix_lists = set(), []
    for pl in cfg.get("prefixLists") or []:
        name = name_of(pl, "prefix-list", prefix_names)
        entries = []
        for entry in pl.get("entries") or []:
            if not isinstance(entry, dict):
                raise ValueError(f"{name} : entrée de prefix-list invalide.")
            item = {"seq": _clean_seq(entry.get("seq"), name),
                    "action": _clean_action(entry.get("action"), name)}
            net = clean_network(entry.get("prefix"))
            network = ipaddress.ip_network(net)
            if network.version != 4:
                raise ValueError(f"{name} : seule l'IPv4 est prise en charge par BGP ici.")
            item["prefix"] = net
            for key in ("ge", "le"):
                if entry.get(key) not in (None, ""):
                    try:
                        bound = int(entry[key])
                    except (TypeError, ValueError):
                        raise ValueError(f"{name} : {key} invalide.")
                    if not network.prefixlen <= bound <= 32:
                        raise ValueError(
                            f"{name} : {key} doit être compris entre {network.prefixlen} et 32.")
                    item[key] = bound
            if "ge" in item and "le" in item and item["le"] < item["ge"]:
                raise ValueError(f"{name} : « le » doit être supérieur ou égal à « ge ».")
            entries.append(item)
        if not entries:
            raise ValueError(f"{name} : aucun préfixe déclaré.")
        prefix_lists.append({"name": name, "entries": entries})
    if prefix_lists:
        out["prefixLists"] = prefix_lists

    community_names, community_lists = set(), []
    for cl in cfg.get("communityLists") or []:
        name = name_of(cl, "community-list", community_names)
        entries = []
        for entry in cl.get("entries") or []:
            if not isinstance(entry, dict):
                raise ValueError(f"{name} : entrée de community-list invalide.")
            entries.append({"seq": _clean_seq(entry.get("seq"), name),
                            "action": _clean_action(entry.get("action"), name),
                            "community": _clean_community(entry.get("community"), name)})
        if not entries:
            raise ValueError(f"{name} : aucune communauté déclarée.")
        community_lists.append({"name": name, "entries": entries})
    if community_lists:
        out["communityLists"] = community_lists

    route_names, route_maps = set(), []
    for rm in cfg.get("routeMaps") or []:
        name = name_of(rm, "route-map", route_names)
        entries = []
        for entry in rm.get("entries") or []:
            if not isinstance(entry, dict):
                raise ValueError(f"{name} : entrée de route-map invalide.")
            item = {"seq": _clean_seq(entry.get("seq"), name),
                    "action": _clean_action(entry.get("action"), name)}
            match_pl = str(entry.get("matchPrefixList", "") or "").strip()
            if match_pl:
                if match_pl not in prefix_names:
                    raise ValueError(f"{name} : la prefix-list « {match_pl} » n'existe pas.")
                item["matchPrefixList"] = match_pl
            match_cl = str(entry.get("matchCommunity", "") or "").strip()
            if match_cl:
                if match_cl not in community_names:
                    raise ValueError(f"{name} : la community-list « {match_cl} » n'existe pas.")
                item["matchCommunity"] = match_cl
            for key in ("setLocalPreference", "setMed"):
                if entry.get(key) not in (None, ""):
                    try:
                        value = int(entry[key])
                    except (TypeError, ValueError):
                        raise ValueError(f"{name} : {key} invalide.")
                    if not 0 <= value <= 4294967295:
                        raise ValueError(f"{name} : {key} hors limites (0-4294967295).")
                    item[key] = value
            if entry.get("setCommunity") not in (None, ""):
                item["setCommunity"] = _clean_community(entry["setCommunity"], name)
            if entry.get("setAsPathPrepend") not in (None, ""):
                try:
                    count = int(entry["setAsPathPrepend"])
                except (TypeError, ValueError):
                    raise ValueError(f"{name} : setAsPathPrepend invalide.")
                if not 1 <= count <= 10:
                    raise ValueError(f"{name} : de 1 à 10 répétitions d'AS sont possibles.")
                item["setAsPathPrepend"] = count
            if len(item) == 2:
                raise ValueError(f"{name} : l'entrée {item['seq']} n'a ni correspondance ni action.")
            entries.append(item)
        if not entries:
            raise ValueError(f"{name} : aucune entrée déclarée.")
        route_maps.append({"name": name, "entries": entries})
    if route_maps:
        out["routeMaps"] = route_maps

    networks = []
    for net in cfg.get("networks") or []:
        cleaned = clean_network(net)
        if ipaddress.ip_network(cleaned).version != 4:
            raise ValueError("BGP : seuls les préfixes IPv4 sont pris en charge ici.")
        networks.append(cleaned)
    if networks:
        out["networks"] = sorted(set(networks))

    redistribute = []
    for item in cfg.get("redistribute") or []:
        item = str(item).strip().lower()
        if item not in BGP_REDISTRIBUTE:
            raise ValueError(f"Redistribution BGP inconnue : {item}")
        redistribute.append(item)
    if redistribute:
        out["redistribute"] = sorted(set(redistribute))

    neighbors, seen_ips = [], set()
    for nb in cfg.get("neighbors") or []:
        if not isinstance(nb, dict):
            raise ValueError("Voisin BGP invalide.")
        try:
            ip = str(ipaddress.IPv4Address(str(nb.get("ip", "")).strip()))
        except ValueError:
            raise ValueError(f"Adresse de voisin BGP invalide : {nb.get('ip')}")
        if ip in seen_ips:
            raise ValueError(f"Voisin BGP {ip} déclaré deux fois.")
        seen_ips.add(ip)
        item = {"ip": ip, "remoteAs": _clean_asn(nb.get("remoteAs"), "AS distant")}
        desc = str(nb.get("description", "") or "").strip()[:64]
        if desc:
            item["description"] = desc
        src = str(nb.get("updateSource", "") or "").strip()
        if src:
            if not DEV_RE.fullmatch(src):
                raise ValueError(f"Voisin {ip} : interface source invalide.")
            item["updateSource"] = src
        if nb.get("multihop") not in (None, ""):
            try:
                hops = int(nb["multihop"])
            except (TypeError, ValueError):
                raise ValueError(f"Voisin {ip} : ebgp-multihop invalide.")
            if not 2 <= hops <= 255:
                raise ValueError(f"Voisin {ip} : ebgp-multihop doit être compris entre 2 et 255.")
            item["multihop"] = hops
        keep, hold = nb.get("keepalive"), nb.get("hold")
        if keep not in (None, "") or hold not in (None, ""):
            try:
                keep = int(keep) if keep not in (None, "") else 30
                hold = int(hold) if hold not in (None, "") else 90
            except (TypeError, ValueError):
                raise ValueError(f"Voisin {ip} : timers invalides.")
            if not 0 <= keep <= 65535 or not 0 <= hold <= 65535:
                raise ValueError(f"Voisin {ip} : timers hors limites (0-65535).")
            if hold and hold < keep:
                raise ValueError(f"Voisin {ip} : le hold time doit être >= au keepalive.")
            item["keepalive"], item["hold"] = keep, hold
        for flag in ("nextHopSelf", "routeReflectorClient", "sendCommunity"):
            if nb.get(flag):
                item[flag] = True
        for field in ("routeMapIn", "routeMapOut"):
            value = str(nb.get(field, "") or "").strip()
            if value:
                if value not in route_names:
                    raise ValueError(f"Voisin {ip} : la route-map « {value} » n'existe pas.")
                item[field] = value
        neighbors.append(item)
    if neighbors:
        out["neighbors"] = neighbors
    return out


def clean_mpls_config(cfg):
    """Valide une configuration MPLS (LDP)."""
    if cfg is None:
        return None
    if not isinstance(cfg, dict):
        raise ValueError("Configuration MPLS invalide.")
    ldp = cfg.get("ldp")
    if not isinstance(ldp, dict):
        raise ValueError("MPLS : la section « ldp » est attendue.")
    rid = ldp.get("routerId")
    if rid in (None, ""):
        raise ValueError("MPLS/LDP : un router-id est nécessaire (adresse d'une loopback).")
    try:
        out = {"routerId": str(ipaddress.IPv4Address(str(rid).strip()))}
    except ValueError:
        raise ValueError(f"MPLS/LDP : router-id invalide : {rid}")
    transport = ldp.get("transportAddress")
    if transport not in (None, ""):
        try:
            out["transportAddress"] = str(ipaddress.IPv4Address(str(transport).strip()))
        except ValueError:
            raise ValueError(f"MPLS/LDP : adresse de transport invalide : {transport}")
    ifaces = []
    for dev in ldp.get("interfaces") or []:
        dev = str(dev).strip()
        if not DEV_RE.fullmatch(dev):
            raise ValueError(f"MPLS/LDP : interface invalide : {dev}")
        if dev not in ifaces:
            ifaces.append(dev)
    if not ifaces:
        raise ValueError("MPLS/LDP : au moins une interface doit être activée.")
    out["interfaces"] = ifaces
    return {"ldp": out}


def check_mpls_consistency(node):
    """Le router-id LDP doit être une adresse locale du nœud."""
    mpls = node.get("mpls")
    if not mpls:
        return
    ip_cfg = node.get("ip") or {}
    local = {str(ipaddress.ip_interface(a).ip) for a in ip_cfg.get("loopback") or []}
    for iface in ip_cfg.get("ifaces", []):
        if iface.get("ipv4"):
            local.add(str(ipaddress.ip_interface(iface["ipv4"]).ip))
    if local and mpls["ldp"]["routerId"] not in local:
        raise ValueError(
            f"MPLS/LDP : le router-id {mpls['ldp']['routerId']} n'est pas une adresse de ce nœud "
            "(utilisez l'adresse d'une loopback).")


def _clean_endpoint(value, name, which):
    """Extrémité d'un tunnel : adresse IPv4 ou « %interface »."""
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"IPsec {name} : adresse {which} manquante.")
    if text.startswith("%"):
        if not DEV_RE.fullmatch(text[1:]):
            raise ValueError(f"IPsec {name} : interface invalide dans l'adresse {which}.")
        return text
    try:
        return str(ipaddress.IPv4Address(text))
    except ValueError:
        raise ValueError(f"IPsec {name} : adresse {which} invalide : {text}")


def _clean_traffic_selectors(value, name, field):
    items = value if isinstance(value, list) else [p.strip() for p in str(value or "").split(",")]
    nets = []
    for net in items:
        if not str(net).strip():
            continue
        cleaned = clean_network(net)
        if ipaddress.ip_network(cleaned).version != 4:
            raise ValueError(f"IPsec {name} : {field} ne prend en charge que l'IPv4.")
        nets.append(cleaned)
    if not nets:
        raise ValueError(f"IPsec {name} : {field} manquant.")
    return nets


def clean_ipsec_config(cfg):
    """Valide des tunnels IPsec site-à-site (IKEv2, strongSwan)."""
    if cfg is None:
        return None
    if not isinstance(cfg, dict):
        raise ValueError("Configuration IPsec invalide.")
    conns = cfg.get("connections")
    if not isinstance(conns, list) or not conns:
        raise ValueError("IPsec : au moins une connexion est nécessaire.")
    out, names = [], set()
    for conn in conns:
        if not isinstance(conn, dict):
            raise ValueError("Connexion IPsec invalide.")
        name = str(conn.get("name", ""))
        if not NAME_RE.fullmatch(name) or name in names:
            raise ValueError(f"Nom de connexion IPsec invalide ou dupliqué : {name}")
        names.add(name)
        item = {"name": name,
                "localAddrs": _clean_endpoint(conn.get("localAddrs"), name, "locale"),
                "remoteAddrs": _clean_endpoint(conn.get("remoteAddrs"), name, "distante")}
        for key in ("localId", "remoteId"):
            value = str(conn.get(key, "") or "").strip()
            if not value:
                raise ValueError(f"IPsec {name} : identité {key} manquante.")
            item[key] = value[:64]
        psk = str(conn.get("psk", "") or "")
        if not psk:
            raise ValueError(f"IPsec {name} : clé partagée (PSK) manquante.")
        item["psk"] = psk[:128]
        item["localTs"] = _clean_traffic_selectors(conn.get("localTs"), name, "localTs")
        item["remoteTs"] = _clean_traffic_selectors(conn.get("remoteTs"), name, "remoteTs")
        for key, default in (("proposals", "aes256-sha256-modp2048"),
                             ("espProposals", "aes256-sha256")):
            value = str(conn.get(key, default) or default).strip()
            if not re.fullmatch(r"[A-Za-z0-9_,\-]+", value):
                raise ValueError(f"IPsec {name} : {key} invalide.")
            item[key] = value
        action = str(conn.get("startAction", "trap") or "trap").strip().lower()
        if action not in ("trap", "start", "none"):
            raise ValueError(f"IPsec {name} : startAction doit être « trap », « start » ou « none ».")
        item["startAction"] = action
        out.append(item)
    return {"connections": out}


def check_ipsec_consistency(node):
    """L'extrémité locale d'un tunnel doit être une adresse du nœud."""
    ipsec = node.get("ipsec")
    if not ipsec:
        return
    ip_cfg = node.get("ip") or {}
    local = {str(ipaddress.ip_interface(a).ip) for a in ip_cfg.get("loopback") or []}
    for iface in ip_cfg.get("ifaces", []):
        if iface.get("ipv4"):
            local.add(str(ipaddress.ip_interface(iface["ipv4"]).ip))
    if not local:
        return
    for conn in ipsec["connections"]:
        addr = conn["localAddrs"]
        if addr.startswith("%"):
            continue
        if addr not in local:
            raise ValueError(
                f"IPsec {conn['name']} : l'adresse locale {addr} n'appartient pas à ce nœud.")


def clean_state(data):
    """Valide et réduit les données avant stockage ou génération de topologie."""
    if not isinstance(data, dict):
        raise ValueError("L'état doit être un objet JSON.")
    result = {"nodes": [], "links": [], "shapes": []}
    seen = set()
    for n in data.get("nodes", []):
        if not isinstance(n, dict) or n.get("type") not in NODE_TYPES:
            raise ValueError("Type de nœud invalide.")
        ident = str(n.get("id", ""))
        if not ID_RE.fullmatch(ident) or ident in seen:
            raise ValueError("Identifiant de nœud invalide ou dupliqué.")
        seen.add(ident)
        node = {"id": ident, "type": n["type"],
                "x": float(n.get("x", 0)), "y": float(n.get("y", 0))}
        if n["type"] == "switch":
            cfg = clean_switch_config(n.get("config"))
            if cfg is not None:
                node["config"] = cfg
            if n.get("l3") is True:  # switch niveau 3 (routage) : simple marqueur, sans effet sur le déploiement
                node["l3"] = True
        ip_cfg = clean_ip_config(n.get("ip"))
        if ip_cfg is not None:
            node["ip"] = ip_cfg
        ospf_cfg = clean_ospf_config(n.get("ospf"))
        if ospf_cfg is not None:
            node["ospf"] = ospf_cfg
        vrrp_cfg = clean_vrrp_config(n.get("vrrp"))
        if vrrp_cfg is not None:
            node["vrrp"] = vrrp_cfg
        lag_cfg = clean_portchannel_config(n.get("portchannels"))
        if lag_cfg is not None:
            node["portchannels"] = lag_cfg
        bgp_cfg = clean_bgp_config(n.get("bgp"))
        if bgp_cfg is not None:
            node["bgp"] = bgp_cfg
        mpls_cfg = clean_mpls_config(n.get("mpls"))
        if mpls_cfg is not None:
            node["mpls"] = mpls_cfg
        ipsec_cfg = clean_ipsec_config(n.get("ipsec"))
        if ipsec_cfg is not None:
            node["ipsec"] = ipsec_cfg
        for key, cleaner in (("rip", extras.clean_rip_config), ("eigrp", extras.clean_eigrp_config),
                             ("isis", extras.clean_isis_config)):
            extra_cfg = cleaner(n.get(key))
            if extra_cfg is not None:
                node[key] = extra_cfg
        if n["type"] == "switch":
            l2_cfg = extras.clean_l2_config(n.get("l2"))
            if l2_cfg is not None:
                node["l2"] = l2_cfg
        check_ipsec_consistency(node)
        check_mpls_consistency(node)
        check_vrrp_consistency(node)
        result["nodes"].append(node)
    for link in data.get("links", []):
        if not isinstance(link, dict):
            raise ValueError("Lien invalide.")
        source, target = str(link.get("source", "")), str(link.get("target", ""))
        if source not in seen or target not in seen or source == target:
            raise ValueError("Chaque lien doit relier deux nœuds distincts existants.")
        result["links"].append({"source": source, "target": target})
    shape_ids = set()
    for shape in data.get("shapes", []):
        if not isinstance(shape, dict) or shape.get("type") not in ("zone", "text"):
            raise ValueError("Forme invalide.")
        ident = str(shape.get("id", ""))
        if not ID_RE.fullmatch(ident) or ident in shape_ids or ident in seen:
            raise ValueError("Identifiant de forme invalide ou dupliqué.")
        shape_ids.add(ident)
        item = {"id": ident, "type": shape["type"], "label": str(shape.get("label", ""))[:120],
                "x": float(shape.get("x", 0)), "y": float(shape.get("y", 0))}
        if item["type"] == "zone":
            item["w"] = max(20, min(3000, float(shape.get("w", 180))))
            item["h"] = max(20, min(3000, float(shape.get("h", 120))))
        result["shapes"].append(item)

    # Les ports sont dérivés des liens : on peut donc vérifier que les membres
    # d'une agrégation correspondent bien à des liens réels du nœud.
    _, ports = assign_ports(result)
    for node in result["nodes"]:
        for lag in node.get("portchannels") or []:
            for member in lag["members"]:
                if member not in ports[node["id"]]:
                    raise ValueError(
                        f"Agrégation {lag['name']} : {member} n'est pas connecté sur {node['id']}.")
        mpls = node.get("mpls")
        if mpls:
            for dev in mpls["ldp"]["interfaces"]:
                if dev not in ports[node["id"]]:
                    raise ValueError(
                        f"MPLS/LDP : l'interface {dev} n'est pas connectée sur {node['id']}.")
    return result


def switch_config(node, port_names):
    """Config finale d'un switch : tout port non configuré passe en access VLAN 1."""
    cfg = node.get("config") or {}
    ports = {}
    for p in port_names:
        ports[p] = (cfg.get("ports") or {}).get(p) or {"mode": "access", "vlan": 1}
    out = {"stp": cfg.get("stp", True), "priority": cfg.get("priority", 32768), "ports": ports}
    if cfg.get("vlans"):
        out["vlans"] = cfg["vlans"]
    return out


def assign_ports(state):
    """Attribue eth1, eth2… à chaque nœud selon l'ordre des liens."""
    counter = {n["id"]: 0 for n in state["nodes"]}
    ports = {n["id"]: [] for n in state["nodes"]}
    links = []
    for edge in state["links"]:
        ends = []
        for key in ("source", "target"):
            counter[edge[key]] += 1
            port = f"eth{counter[edge[key]]}"
            ports[edge[key]].append(port)
            ends.append(f"{edge[key]}:{port}")
        links.append({"endpoints": ends})
    return links, ports


def aggregate_ports(node, ports):
    """Remplace les ports membres d'une agrégation par le nom de l'agrégation."""
    lags = node.get("portchannels") or []
    members = {m for lag in lags for m in lag["members"]}
    kept = [p for p in ports if p not in members]
    kept.extend(lag["name"] for lag in lags)
    return kept


def ipsec_initiator(ipsec, nodes):
    """Deux extrémités en « start » s'amorcent en même temps et créent deux tunnels
    concurrents : seule l'adresse la plus basse amorce, l'autre attend (trap)."""
    starts = {(c["localAddrs"], c["remoteAddrs"]) for n in nodes
              for c in (n.get("ipsec") or {}).get("connections", []) if c["startAction"] == "start"}
    conns = []
    for c in ipsec["connections"]:
        local, remote = c["localAddrs"], c["remoteAddrs"]
        if (c["startAction"] == "start" and (remote, local) in starts
                and "%" not in local + remote
                and ipaddress.IPv4Address(local) > ipaddress.IPv4Address(remote)):
            c = {**c, "startAction": "trap"}
        conns.append(c)
    return {"connections": conns}


def build_lab(state):
    """Retourne (dict containerlab, {id_noeud: config de nœud})."""
    state = clean_state(state)
    links, node_ports = assign_ports(state)
    nodes, node_cfgs = {}, {}
    for node in state["nodes"]:
        d = {"kind": "linux", "image": NODE_IMAGE}
        cfg = {"id": node["id"], "type": node["type"]}
        if node["type"] == "switch":
            sw_ports = aggregate_ports(node, node_ports[node["id"]])
            if node.get("l3"):
                # Port routé d'un switch L3 (« no switchport ») : il porte une adresse IP
                # et ne rejoint donc pas le bridge.
                routed = {i["dev"] for i in (node.get("ip") or {}).get("ifaces", [])
                          if PORT_RE.fullmatch(i["dev"]) and "vlan" not in i and "gre" not in i}
                sw_ports = [p for p in sw_ports if p not in routed]
            cfg["switch"] = switch_config(node, sw_ports)
        if node.get("ip"):
            ip_cfg = dict(node["ip"])
            # Les routes à métrique (routes flottantes) sont posées en fin de démarrage.
            ip_cfg["routes"] = [r for r in ip_cfg.get("routes", []) if "metric" not in r]
            cfg["ip"] = ip_cfg
        if node.get("ospf"):
            cfg["ospf"] = node["ospf"]
        if node.get("vrrp"):
            cfg["vrrp"] = node["vrrp"]
        if node.get("portchannels"):
            cfg["portchannels"] = node["portchannels"]
        if node.get("bgp"):
            cfg["bgp"] = node["bgp"]
        if node.get("mpls"):
            cfg["mpls"] = node["mpls"]
        if node.get("ipsec"):
            cfg["ipsec"] = ipsec_initiator(node["ipsec"], state["nodes"])
        frr_lines, frr_daemons = extras.frr_extra(node)
        if frr_lines:
            cfg["frrExtra"] = frr_lines
            cfg["frrDaemons"] = frr_daemons
        tune = extras.tune_commands(node)
        if tune:
            cfg["tune"] = tune
        # Un nœud sans configuration n'a pas besoin de bind : son entrypoint
        # s'arrête proprement.
        if len(cfg) > 2 or node["type"] == "router":  # un routeur a toujours FRR (vtysh)
            d["binds"] = [f"configs/{node['id']}.json:/etc/lab01/node.json:ro"]
            node_cfgs[node["id"]] = cfg
        nodes[node["id"]] = d
    return {"name": LAB_NAME, "topology": {"nodes": nodes, "links": links}}, node_cfgs


def to_clab(state):
    """Dictionnaire Containerlab seul (testable)."""
    return build_lab(state)[0]


def write_topology(state):
    LAB_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    topo, node_cfgs = build_lab(state)
    for ident, cfg in node_cfgs.items():
        (CONFIG_DIR / f"{ident}.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    # Nettoie les configurations de nœuds supprimés depuis le dernier déploiement.
    for stale in CONFIG_DIR.glob("*.json"):
        if stale.stem not in node_cfgs:
            stale.unlink()
    content = yaml.safe_dump(topo, sort_keys=False, allow_unicode=True)
    TOPO_FILE.write_text(content, encoding="utf-8")
    return content


def containerlab_command(*args):
    """Construit la commande clab; pas de sudo en conteneur/root."""
    clab = ["containerlab", *args]
    sudo_setting = os.environ.get("CLAB_SUDO")
    use_sudo = (sudo_setting not in ("0", "false", "False", "no", "NO")
                and os.geteuid() != 0)
    return (["sudo", *clab] if use_sudo else clab)


def run_clab(*args, timeout=600):
    """Exécute une commande containerlab dans le répertoire du laboratoire."""
    return subprocess.run(containerlab_command(*args), capture_output=True, text=True,
                          timeout=timeout, check=False, cwd=str(LAB_DIR))


def remove_lab_containers():
    """Supprime les conteneurs du lab identifiés par leur label Docker.

    Nécessaire car `containerlab destroy` s'appuie sur le fichier de topologie
    et le répertoire du lab : si la topologie a changé entre deux déploiements,
    il ne retrouve plus les conteneurs de l'ancienne version.
    """
    listed = subprocess.run(["docker", "ps", "-aq", "--filter", f"label=containerlab={LAB_NAME}"],
                            capture_output=True, text=True, check=False)
    ids = listed.stdout.split()
    if not ids:
        return False
    subprocess.run(["docker", "rm", "-f", *ids], capture_output=True, text=True, check=False)
    return True


# ---------- Détection des capacités de l'hôte ----------

_caps_cache = None


def _run(cmd, timeout=40):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        return r.returncode == 0, (r.stdout + r.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)


def _probe(shell_cmd):
    ok, _ = _run(["docker", "run", "--rm", "--privileged", "alpine:3.20", "sh", "-c", shell_cmd], 60)
    return ok


def detect_capabilities():
    docker_ok, docker_v = _run(["docker", "version", "--format", "{{.Server.Version}}"])
    clab_ok, _ = _run(containerlab_command("version"))
    _, arch = _run(["docker", "info", "--format", "{{.Architecture}}"])
    caps = {"docker": docker_ok, "dockerVersion": docker_v if docker_ok else "",
            "containerlab": clab_ok, "arch": arch, "features": {}}
    if not docker_ok:
        return caps
    ip = "apk add -q iproute2 >/dev/null && "
    tests = {
        "bridge": ip + "ip link add br0 type bridge && ip link del br0",
        "vlan": ip + "ip link add br0 type bridge vlan_filtering 1 && ip link del br0",
        "stp": ip + "ip link add br0 type bridge stp_state 1 && ip link del br0",
        "mpls": "modprobe mpls_router 2>/dev/null; test -e /proc/sys/net/mpls/platform_labels",
    }
    for name, cmd in tests.items():
        caps["features"][name] = _probe(cmd)
    return caps


@app.get("/api/capabilities")
def capabilities():
    global _caps_cache
    if _caps_cache is None or request.args.get("refresh"):
        _caps_cache = detect_capabilities()
    return jsonify(_caps_cache)


# ---------- Routes existantes ----------

@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.post("/api/save")
def save():
    try:
        state = clean_state(request.get_json(force=True))
        LAB_DIR.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        return jsonify(ok=True, message="État sauvegardé.")
    except (ValueError, TypeError, OSError) as exc:
        return jsonify(ok=False, error=str(exc)), 400


@app.get("/api/load")
def load():
    if not STATE_FILE.exists():
        return jsonify({"nodes": [], "links": [], "shapes": []})
    try:
        return jsonify(clean_state(json.loads(STATE_FILE.read_text(encoding="utf-8"))))
    except (ValueError, TypeError, OSError, json.JSONDecodeError) as exc:
        return jsonify(ok=False, error=str(exc)), 500


@app.post("/api/deploy")
def deploy():
    try:
        payload = request.get_json(silent=True) or {}
        raw = payload.get("state")
        if raw is None:
            # Pas d'état dans la requête : on repart de l'état sauvegardé plutôt
            # que de générer une topologie vide.
            if not STATE_FILE.exists():
                raise ValueError("Aucun état fourni et aucun état sauvegardé.")
            raw = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        state = clean_state(raw)
        write_topology(state)
        result = run_clab("deploy", "-t", str(TOPO_FILE), "--reconfigure")
        # containerlab ne sait pas réconcilier une topologie dont le jeu de
        # nœuds a changé (« lab has already been deployed ») : dans ce cas on
        # détruit le laboratoire avant de le redéployer.
        if result.returncode != 0 and "already been deployed" in (result.stdout + result.stderr):
            run_clab("destroy", "-t", str(TOPO_FILE), "--cleanup")
            remove_lab_containers()
            result = run_clab("deploy", "-t", str(TOPO_FILE), "--reconfigure")
        return jsonify(ok=result.returncode == 0, stdout=result.stdout, stderr=result.stderr,
                    error=None if result.returncode == 0 else f"containerlab a retourné {result.returncode}.")
    except (ValueError, TypeError, OSError, subprocess.TimeoutExpired) as exc:
        return jsonify(ok=False, error=str(exc)), 500


@app.post("/api/destroy")
def destroy():
    try:
        result = run_clab("destroy", "-t", str(TOPO_FILE), "--cleanup")
        remove_lab_containers()
        return jsonify(ok=result.returncode == 0, stdout=result.stdout, stderr=result.stderr,
                    error=None if result.returncode == 0 else f"containerlab a retourné {result.returncode}.")
    except (OSError, subprocess.TimeoutExpired) as exc:
        return jsonify(ok=False, error=str(exc)), 500


@app.post("/api/exec")
def execute():
    try:
        payload = request.get_json(force=True)
        node, command = str(payload.get("node", "")), str(payload.get("command", ""))
        if not ID_RE.fullmatch(node) or not command.strip() or len(command) > 2000:
            raise ValueError("Nœud ou commande invalide.")
        result = subprocess.run(["docker", "exec", f"clab-webui-{node}", "sh", "-c", command],
                                capture_output=True, text=True, timeout=60, check=False)
        return jsonify(ok=result.returncode == 0, stdout=result.stdout, stderr=result.stderr,
                    error=None if result.returncode == 0 else f"docker exec a retourné {result.returncode}.")
    except (ValueError, TypeError, OSError, subprocess.TimeoutExpired) as exc:
        return jsonify(ok=False, error=str(exc)), 500


# ---------- Terminal web (ttyd) ----------
# ttyd sert un terminal dans le navigateur pour une commande donnée : ici un
# shell dans un nœud du laboratoire. Une session par nœud, relancée à la demande.
TTYD_PORT_MIN = int(os.environ.get("TTYD_PORT_MIN", "7681"))
TTYD_PORT_MAX = int(os.environ.get("TTYD_PORT_MAX", "7690"))
_ttyd = {}


def _ttyd_port():
    for port in range(TTYD_PORT_MIN, TTYD_PORT_MAX + 1):
        if any(s["port"] == port and s["proc"].poll() is None for s in _ttyd.values()):
            continue
        with socket.socket() as probe:
            try:
                probe.bind(("0.0.0.0", port))
            except OSError:
                continue
        return port
    return None


@app.post("/api/terminal")
def terminal():
    try:
        node = str((request.get_json(silent=True) or {}).get("node", "")).strip()
        if not ID_RE.fullmatch(node):
            raise ValueError("Nœud invalide.")
        session = _ttyd.get(node)
        if session and session["proc"].poll() is None:
            return jsonify(ok=True, url=session["url"])
        running = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}",
                                  f"clab-{LAB_NAME}-{node}"], capture_output=True, text=True, check=False)
        if running.stdout.strip() != "true":
            raise ValueError(f"Le nœud {node} n'est pas déployé.")
        port = _ttyd_port()
        if port is None:
            raise ValueError("Plus de terminal libre : fermez une session ouverte.")
        proc = subprocess.Popen(
            ["ttyd", "-W", "-p", str(port), "--once", "docker", "exec", "-it", f"clab-{LAB_NAME}-{node}",
             # CLI Cisco (vtysh) si FRR tourne dans le nœud, sinon shell.
             "sh", "-c", "pgrep zebra >/dev/null && exec vtysh || exec sh"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        url = f"http://{request.host.split(':')[0]}:{port}/"
        _ttyd[node] = {"port": port, "proc": proc, "url": url}
        return jsonify(ok=True, url=url)
    except (ValueError, TypeError, OSError) as exc:
        return jsonify(ok=False, error=str(exc)), 400


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False)