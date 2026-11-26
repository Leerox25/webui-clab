"""Tests des options avancées : rendu texte, sans Docker.  Lancer : python -m unittest discover tests"""
import json
import os
import shutil
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import app  # noqa: E402


def lab(nodes, links=()):
    st = {"nodes": nodes, "links": [{"source": a, "target": b} for a, b in links], "shapes": []}
    return app.build_lab(st)[1]


def router(**kw):
    return {"id": "r1", "type": "router", "x": 0, "y": 0, **kw}


class Unchanged(unittest.TestCase):
    def test_no_extras_means_no_new_keys(self):
        cfg = lab([router(ip={"ifaces": [{"dev": "eth1", "ipv4": "10.0.0.1/24"}], "routes": [{"dst": "0.0.0.0/0", "via": "10.0.0.2"}]},
                          ospf={"areas": [{"id": "0", "networks": ["10.0.0.0/24"]}]})])["r1"]
        self.assertNotIn("frrExtra", cfg)
        self.assertNotIn("tune", cfg)
        self.assertEqual(cfg["ip"]["routes"], [{"dst": "0.0.0.0/0", "via": "10.0.0.2"}])
        self.assertEqual(cfg["ospf"]["areas"][0]["networks"], ["10.0.0.0/24"])


class Ospf(unittest.TestCase):
    def test_extended(self):
        ospf = {"areas": [{"id": "0", "networks": ["10.0.0.0/24"]}, {"id": "1", "networks": ["10.1.0.0/24"], "type": "totally-stub"}],
                "autoCostRef": 10000, "defaultOriginate": "always", "redistribute": ["connected", "static"],
                "ifOptions": {"eth1": {"network": "point-to-point", "hello": 5, "dead": 20, "priority": 100, "authKey": "s3cret", "bfd": True}}}
        cfg = lab([router(ospf=ospf)])["r1"]
        text = "\n".join(cfg["frrExtra"])
        for want in ("router ospf", " auto-cost reference-bandwidth 10000", " area 0.0.0.1 stub no-summary",
                     " default-information originate always", " redistribute connected", "interface eth1",
                     " ip ospf network point-to-point", " ip ospf hello-interval 5", " ip ospf dead-interval 20",
                     " ip ospf priority 100", " ip ospf authentication message-digest",
                     " ip ospf message-digest-key 1 md5 s3cret", " ip ospf bfd"):
            self.assertIn(want, text)
        self.assertEqual(cfg["frrDaemons"], ["bfdd"])
        self.assertEqual(text.count("\nexit"), 2)  # chaque bloc se ferme par « exit »

    def test_rejects(self):
        base = {"areas": [{"id": "0", "networks": ["10.0.0.0/24"], "type": "stub"}]}
        with self.assertRaises(ValueError):
            lab([router(ospf=base)])  # backbone ne peut pas être stub
        bad = {"areas": [{"id": "1", "networks": ["10.0.0.0/24"]}], "ifOptions": {"eth1": {"hello": 10, "dead": 10}}}
        with self.assertRaises(ValueError):
            lab([router(ospf=bad)])
        with self.assertRaises(ValueError):
            lab([router(ospf={"areas": [{"id": "1", "networks": ["10.0.0.0/24"]}], "ifOptions": {"eth1": {"authKey": "a b;rm"}}})])


class Igp(unittest.TestCase):
    def test_rip_eigrp_isis(self):
        cfg = lab([router(rip={"networks": ["10.0.0.0/24"], "passive": ["eth2"], "redistribute": ["connected"], "defaultOriginate": True},
                          eigrp={"asn": 100, "routerId": "1.1.1.1", "networks": ["10.9.0.0/24"], "variance": 2, "redistribute": ["static"]},
                          isis={"tag": "LAB", "net": "49.0001.0000.0000.0001.00", "level": "level-2-only",
                                "interfaces": [{"dev": "eth1", "metric": 10, "network": "point-to-point"}], "redistribute": ["connected"]})])["r1"]
        t = "\n".join(cfg["frrExtra"])
        for want in ("router rip", " version 2", " network 10.0.0.0/24", " passive-interface eth2", " default-information originate",
                     "router eigrp 100", " eigrp router-id 1.1.1.1", " variance 2",
                     "router isis LAB", " net 49.0001.0000.0000.0001.00", " is-type level-2-only", " redistribute ipv4 connected level-2",
                     "interface eth1", " ip router isis LAB", " isis network point-to-point", " isis metric 10",
                     "interface lo", " isis passive"):
            self.assertIn(want, t)
        self.assertEqual(sorted(cfg["frrDaemons"]), ["eigrpd", "isisd", "ripd"])

    def test_rejects(self):
        for bad in ({"rip": {"networks": []}}, {"rip": {"networks": ["10.0.0.0/24; rm -rf"]}}, {"eigrp": {"asn": 0, "networks": ["10.0.0.0/24"]}},
                    {"isis": {"net": "bad", "interfaces": [{"dev": "eth1"}]}}):
            with self.assertRaises(ValueError):
                lab([router(**bad)])

    def test_jq_roundtrip(self):
        if not shutil.which("jq"):
            self.skipTest("jq absent")
        cfg = lab([router(rip={"networks": ["10.0.0.0/24"]})])["r1"]
        out = subprocess.run(["jq", "-r", "(.frrExtra // [])[]"], input=json.dumps(cfg), capture_output=True, text=True).stdout
        self.assertEqual(out.splitlines(), cfg["frrExtra"])


class Kernel(unittest.TestCase):
    def test_l2_tune(self):
        sw = {"id": "sw1", "type": "switch", "x": 0, "y": 0,
              "l2": {"ageing": 300, "hello": 2, "forwardDelay": 15, "maxAge": 20, "mcastSnooping": True,
                     "ports": {"eth1": {"cost": 10, "priority": 16, "rootGuard": True, "bpduGuard": True}}}}
        cfg = lab([sw])["sw1"]
        self.assertIn("ip link set dev br0 type bridge ageing_time 30000 forward_delay 1500 hello_time 200 max_age 2000 mcast_snooping 1", cfg["tune"])
        self.assertIn("ip link set dev eth1 type bridge_slave cost 10 priority 16 root_block on guard on", cfg["tune"])

    def test_l2_timer_relations(self):
        with self.assertRaises(ValueError):
            lab([{"id": "sw1", "type": "switch", "x": 0, "y": 0, "l2": {"hello": 2, "forwardDelay": 4, "maxAge": 40}}])

    def test_netem_and_metric(self):
        cfg = lab([router(ip={"ifaces": [{"dev": "eth1", "ipv4": "10.0.0.1/24", "link": {"delay": 20, "jitter": 5, "loss": 1.5, "rate": 10000}}],
                              "routes": [{"dst": "0.0.0.0/0", "via": "10.0.0.2"}, {"dst": "0.0.0.0/0", "via": "10.0.0.3", "metric": 200}]})])["r1"]
        self.assertIn("tc qdisc replace dev eth1 root netem delay 20ms 5ms loss 1.5% rate 10000kbit", cfg["tune"])
        self.assertIn("ip route add 0.0.0.0/0 via 10.0.0.3 metric 200", cfg["tune"])
        self.assertEqual(cfg["ip"]["routes"], [{"dst": "0.0.0.0/0", "via": "10.0.0.2"}])  # la route flottante n'est pas posée deux fois

    def test_jitter_needs_delay(self):
        with self.assertRaises(ValueError):
            lab([router(ip={"ifaces": [{"dev": "eth1", "ipv4": "10.0.0.1/24", "link": {"jitter": 5}}]})])


class RoutedPorts(unittest.TestCase):
    def test_l3_switch_routed_port_leaves_bridge(self):
        nodes = [{"id": "sw1", "type": "switch", "l3": True, "x": 0, "y": 0, "ip": {"ifaces": [{"dev": "eth1", "ipv4": "10.0.0.1/24"}]}},
                 {"id": "r1", "type": "router", "x": 0, "y": 0}, {"id": "pc1", "type": "pc", "x": 0, "y": 0}]
        cfg = lab(nodes, [("sw1", "r1"), ("sw1", "pc1")])["sw1"]
        self.assertEqual(sorted(cfg["switch"]["ports"]), ["eth2"])
        self.assertEqual(cfg["ip"]["ifaces"][0]["dev"], "eth1")

    def test_l2_switch_unchanged(self):
        nodes = [{"id": "sw1", "type": "switch", "x": 0, "y": 0}, {"id": "r1", "type": "router", "x": 0, "y": 0}]
        self.assertEqual(sorted(lab(nodes, [("sw1", "r1")])["sw1"]["switch"]["ports"]), ["eth1"])


class Ipsec(unittest.TestCase):
    def test_single_initiator_when_both_start(self):
        def gw(i, me, peer, action):
            return {"id": i, "type": "router", "ip": {"ifaces": [{"dev": "eth1", "ipv4": me + "/24"}]},
                    "ipsec": {"connections": [{"name": "t", "localAddrs": me, "remoteAddrs": peer,
                              "localId": i, "remoteId": "x", "psk": "k", "localTs": me + "/32",
                              "remoteTs": peer + "/32", "startAction": action}]}}
        action = lambda cfgs, n: cfgs[n]["ipsec"]["connections"][0]["startAction"]
        cfgs = lab([gw("r1", "10.0.0.1", "10.0.0.2", "start"), gw("r2", "10.0.0.2", "10.0.0.1", "start")], [("r1", "r2")])
        self.assertEqual((action(cfgs, "r1"), action(cfgs, "r2")), ("start", "trap"))
        cfgs = lab([gw("r1", "10.0.0.1", "10.0.0.2", "trap"), gw("r2", "10.0.0.2", "10.0.0.1", "start")], [("r1", "r2")])
        self.assertEqual((action(cfgs, "r1"), action(cfgs, "r2")), ("trap", "start"))


if __name__ == "__main__":
    unittest.main()
