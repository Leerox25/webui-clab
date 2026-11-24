#!/bin/sh
# Entrypoint unique des nœuds LAB/01 (switch, routeur, PC, serveur).
# Configuration fournie par containerlab via un bind :
#   configs/<noeud>.json -> /etc/lab01/node.json
CFG=/etc/lab01/node.json

log() { echo "[lab01] $*"; }

if [ ! -f "$CFG" ]; then
    log "aucune configuration montée ($CFG) : nœud inactif"
    exec tail -f /dev/null
fi

jqr() { jq -r "$1" "$CFG"; }

# Attend l'apparition d'une interface (containerlab les attache après le
# démarrage du conteneur). 30 s maximum.
wait_iface() {
    n=0
    while [ ! -e "/sys/class/net/$1" ]; do
        n=$((n + 1))
        if [ "$n" -ge 300 ]; then
            log "interface $1 absente après 30 s"
            return 1
        fi
        sleep 0.1
    done
    return 0
}

# ---------------------------------------------------------------- interfaces
# Les interfaces physiques attendues sont celles déclarées dans la config IP
# (le parent pour une sous-interface) et dans la config switch.
PHYS=$(jq -r '[(.ip.ifaces // [])[] | select(.gre | not) | (.vlan.parent // .dev)] + [(.switch.ports // {}) | keys[]] | unique | .[]' "$CFG" 2>/dev/null)
for dev in $PHYS; do
    case "$dev" in
        br*|lo|bond*|*.*) continue ;;
    esac
    wait_iface "$dev"
done

# ----------------------------------------- agrégation de liens (EtherChannel)
# Doit précéder le bridge : les ports membres sont esclaves du bond, et c'est
# le bond (et non les ports physiques) qui devient port du bridge.
if jq -e '.portchannels' "$CFG" >/dev/null 2>&1; then
    jq -r '(.portchannels // [])[] | [.name, .mode, ((.members // []) | join(","))] | join("|")' "$CFG" |
        while IFS='|' read -r name mode members; do
            [ -n "$name" ] || continue
            ip link add "$name" type bond mode "$mode" 2>/dev/null
            for m in $(echo "$members" | tr ',' ' '); do
                wait_iface "$m" || continue
                ip link set "$m" down
                ip link set "$m" master "$name"
            done
            ip link set "$name" up
            for m in $(echo "$members" | tr ',' ' '); do
                ip link set "$m" up
            done
            log "agrégation $name ($mode) : $members"
        done
fi

# -------------------------------------------------------------------- switch
if jq -e '.switch' "$CFG" >/dev/null 2>&1; then
    log "configuration du bridge (VLAN filtering + STP)"
    STP=$(jqr '.switch.stp')
    PRIO=$(jqr '.switch.priority')
    ip link add br0 type bridge vlan_filtering 1 \
        stp_state "$([ "$STP" = true ] && echo 1 || echo 0)" priority "$PRIO"
    ip link set br0 up

    for port in $(jqr '.switch.ports | keys[]'); do
        wait_iface "$port" || continue
        ip link set "$port" master br0
        ip link set "$port" up
        bridge vlan del dev "$port" vid 1 2>/dev/null
        if [ "$(jqr ".switch.ports[\"$port\"].mode")" = access ]; then
            bridge vlan add dev "$port" vid "$(jqr ".switch.ports[\"$port\"].vlan")" pvid untagged
        else
            # VLAN natif : non taggé (PVID) sur le trunk, en plus des VLANs taggés.
            native=$(jqr ".switch.ports[\"$port\"].native // empty")
            if [ -n "$native" ]; then
                bridge vlan add dev "$port" vid "$native" pvid untagged
            fi
            for v in $(jqr ".switch.ports[\"$port\"].vlans[]"); do
                [ "$v" = "$native" ] && continue
                bridge vlan add dev "$port" vid "$v"
            done
        fi
    done
fi

# ------------------------------------------------------------------------ IP
if jq -e '.ip' "$CFG" >/dev/null 2>&1; then
    # Le noyau d'un conteneur ne route pas par défaut : sans cela un nœud
    # répond pour lui-même mais ne relaie rien entre ses interfaces.
    echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null
    echo 1 > /proc/sys/net/ipv6/conf/all/forwarding 2>/dev/null

    # containerlab installe une route par défaut sur l'interface de management
    # (eth0, métrique 0). Elle doit être retirée AVANT d'ajouter nos propres
    # routes : sinon `ip route add default` échoue en « File exists ».
    if ip route show default dev eth0 >/dev/null 2>&1; then
        ip route del default dev eth0 2>/dev/null
        log "route par défaut de management (eth0) retirée"
    fi

    # 1) interfaces logiques 802.1Q (router-on-a-stick, SVI sur bridge…)
    #    Séparateur « | » et non une tabulation : IFS traite la tabulation comme
    #    un espacement et effondrerait les champs vides (colonnes décalées).
    jq -r '(.ip.ifaces // [])[] | select(.vlan) | [.dev, .vlan.parent, (.vlan.id | tostring)] | join("|")' "$CFG" |
        while IFS='|' read -r dev parent vid; do
            [ -n "$dev" ] || continue
            wait_iface "$parent" || continue
            ip link set "$parent" up
            ip link add link "$parent" name "$dev" type vlan id "$vid" 2>/dev/null
            ip link set "$dev" up
            # Une SVI posée sur un bridge exige que la VLAN soit aussi déclarée
            # sur le port local du bridge (mot-clé « self »), sinon la
            # passerelle interne ne reçoit aucun trafic de ce VLAN.
            case "$parent" in
                br*) bridge vlan add dev "$parent" vid "$vid" self 2>/dev/null ;;
            esac
            log "sous-interface $dev (VLAN $vid sur $parent)"
        done

    # 2) adresse MAC, MTU, adresses statiques, client DHCP (hors tunnels GRE,
    #    qui sont créés plus bas : leur extrémité locale doit déjà exister).
    jq -r '(.ip.ifaces // [])[] | select(.gre | not) | [.dev, (.mac // ""), ((.mtu // "") | tostring), (.ipv4 // ""), (.ipv6 // ""), ((.dhcp // false) | tostring)] | join("|")' "$CFG" |
        while IFS='|' read -r dev mac mtu v4 v6 dhcp; do
            [ -n "$dev" ] || continue
            wait_iface "$dev" || continue
            [ -n "$mac" ] && ip link set dev "$dev" address "$mac"
            [ -n "$mtu" ] && ip link set dev "$dev" mtu "$mtu"
            ip link set "$dev" up
            [ -n "$v4" ] && ip addr add "$v4" dev "$dev"
            [ -n "$v6" ] && ip addr add "$v6" dev "$dev"
            if [ "$dhcp" = "true" ]; then
                if [ -f /usr/share/udhcpc/default.script ]; then
                    udhcpc -i "$dev" -s /usr/share/udhcpc/default.script >/dev/null 2>&1 &
                else
                    udhcpc -i "$dev" >/dev/null 2>&1 &
                fi
                log "client DHCP démarré sur $dev"
            fi
        done

    # 2bis) tunnels GRE : créés après l'adressage, car le noyau refuse un tunnel
    #       dont l'adresse locale n'existe pas encore (échec « File exists »).
    jq -r '(.ip.ifaces // [])[] | select(.gre) | [.dev, .gre.local, .gre.remote, ((.gre.ttl // "") | tostring), ((.gre.key // "") | tostring)] | join("|")' "$CFG" |
        while IFS='|' read -r dev local remote ttl key; do
            [ -n "$dev" ] || continue
            opts=""
            [ -n "$ttl" ] && opts="$opts ttl $ttl"
            [ -n "$key" ] && opts="$opts key $key"
            ip link add "$dev" type gre local "$local" remote "$remote" $opts 2>/dev/null
            ip link set "$dev" up
            log "tunnel GRE $dev ($local -> $remote)"
        done

    # 2ter) adresses portées par les tunnels GRE
    jq -r '(.ip.ifaces // [])[] | select(.gre) | [.dev, ((.mtu // "") | tostring), (.ipv4 // ""), (.ipv6 // "")] | join("|")' "$CFG" |
        while IFS='|' read -r dev mtu v4 v6; do
            [ -n "$dev" ] || continue
            wait_iface "$dev" || continue
            [ -n "$mtu" ] && ip link set dev "$dev" mtu "$mtu"
            ip link set "$dev" up
            [ -n "$v4" ] && ip addr add "$v4" dev "$dev"
            [ -n "$v6" ] && ip addr add "$v6" dev "$dev"
        done

    # 3) adresses de loopback (router-id OSPF, etc.)
    jq -r '(.ip.loopback // [])[]' "$CFG" | while read -r addr; do
        [ -n "$addr" ] || continue
        ip addr add "$addr" dev lo
        log "loopback $addr"
    done

    # 4) routes statiques (IPv4/IPv6 selon la destination)
    jq -r '(.ip.routes // [])[] | [.dst, (.via // ""), (.dev // "")] | join("|")' "$CFG" |
        while IFS='|' read -r dst via dev; do
            [ -n "$dst" ] || continue
            fam=""
            case "$dst" in *:*) fam="-6" ;; esac
            if [ -n "$via" ] && [ -n "$dev" ]; then
                ip $fam route add "$dst" via "$via" dev "$dev"
            elif [ -n "$via" ]; then
                ip $fam route add "$dst" via "$via"
            else
                ip $fam route add "$dst" dev "$dev"
            fi
            log "route $dst${via:+ via $via}${dev:+ dev $dev}"
        done

    # 5) serveur DHCP (dnsmasq)
    if jq -e '.ip.dhcpServer' "$CFG" >/dev/null 2>&1; then
        DS_DEV=$(jqr '.ip.dhcpServer.dev')
        DS_RANGE=$(jqr '.ip.dhcpServer.range')
        DS_ROUTER=$(jqr '.ip.dhcpServer.router // ""')
        DS_DNS=$(jqr '.ip.dhcpServer.dns // ""')
        mkdir -p /var/lib/misc
        {
            echo "port=0"
            echo "interface=$DS_DEV"
            echo "bind-interfaces"
            echo "dhcp-range=$DS_RANGE,12h"
            [ -n "$DS_ROUTER" ] && echo "dhcp-option=3,$DS_ROUTER"
            [ -n "$DS_DNS" ] && echo "dhcp-option=6,$DS_DNS"
            echo "log-dhcp"
        } > /etc/dnsmasq.conf
        wait_iface "$DS_DEV" && dnsmasq -C /etc/dnsmasq.conf
        log "serveur DHCP actif sur $DS_DEV ($DS_RANGE)"
    fi
fi

# ------------------------------------------------------------------ routage
# FRR : OSPF et/ou VRRP. Le vrrpd de FRR ne crée pas les interfaces macvlan
# nécessaires : elles doivent exister avant le démarrage des démons, en mode
# bridge, avec la MAC virtuelle 00:00:5e:00:01:<VRID>.
if jq -e '(.type == "router" or .type == "switch") or .ospf or .vrrp or .bgp or .mpls or .frrExtra' "$CFG" >/dev/null 2>&1; then
    mkdir -p /var/run/frr /var/log/frr
    chown frr:frr /var/run/frr 2>/dev/null
    chmod 775 /var/run/frr 2>/dev/null

    if jq -e '.vrrp' "$CFG" >/dev/null 2>&1; then
        jq -r '(.vrrp // [])[] | [.dev, (.vrid | tostring), ((.ipv4 // []) | join(","))] | join("|")' "$CFG" |
            while IFS='|' read -r dev vrid vips; do
                [ -n "$dev" ] || continue
                wait_iface "$dev" || continue
                idx=$(cat "/sys/class/net/$dev/ifindex" 2>/dev/null)
                mdev="vrrp4-${idx}-${vrid}"
                mac=$(printf '00:00:5e:00:01:%02x' "$vrid")
                ip link add "$mdev" link "$dev" type macvlan mode bridge 2>/dev/null
                ip link set dev "$mdev" address "$mac"
                for vip in $(echo "$vips" | tr ',' ' '); do
                    ip addr add "$vip" dev "$mdev"
                done
                ip link set "$mdev" up
                log "VRRP : $mdev (VRID $vrid, $mac) porte $vips"
            done
    fi

    if jq -e '.mpls' "$CFG" >/dev/null 2>&1; then
        # Sans cela le noyau refuse toute étiquette (la valeur par défaut est 0).
        echo 1048575 > /proc/sys/net/mpls/platform_labels 2>/dev/null
        log "MPLS : platform_labels=$(cat /proc/sys/net/mpls/platform_labels 2>/dev/null)"
    fi

    RID=$(jqr '.ospf.routerId // ""')
    ASN=$(jqr '.bgp.asn // ""')
    RIDB=$(jqr '.bgp.routerId // ""')
    # Une seule section « interface » par interface, pour y regrouper le coût
    # OSPF, l'activation MPLS et les instances VRRP.
    IFACES=$(jq -r '[((.ospf.costs // {}) | keys[]), ((.vrrp // [])[] | .dev), ((.mpls.ldp.interfaces // [])[])] | unique | .[]' "$CFG" 2>/dev/null)
    {
        echo "frr version 10.0"
        echo "frr defaults traditional"
        echo "hostname $(jqr '.id')"
        echo "log stdout"
        echo "service integrated-vtysh-config"
        echo "!"
        for dev in $IFACES; do
            echo "interface $dev"
            cost=$(jq -r --arg d "$dev" '(.ospf.costs // {})[$d] // empty' "$CFG" 2>/dev/null)
            [ -n "$cost" ] && echo " ip ospf cost $cost"
            if jq -e --arg d "$dev" '(.mpls.ldp.interfaces // []) | index($d)' "$CFG" >/dev/null 2>&1; then
                echo " mpls enable"
            fi
            jq -r --arg d "$dev" '(.vrrp // [])[] | select(.dev == $d) | "\(.vrid)|\(.priority)|\((.preempt // true) | tostring)|\((.ipv4 // []) | map(split("/")[0]) | join(" "))"' "$CFG" |
                while IFS='|' read -r vrid prio preempt vips; do
                    echo " vrrp $vrid priority $prio"
                    [ "$preempt" = "true" ] && echo " vrrp $vrid preempt"
                    for vip in $vips; do
                        echo " vrrp $vrid ip $vip"
                    done
                done
            echo "!"
        done
        if jq -e '.mpls' "$CFG" >/dev/null 2>&1; then
            LDPRID=$(jqr '.mpls.ldp.routerId')
            LDPTA=$(jqr '.mpls.ldp.transportAddress // ""')
            [ -n "$LDPTA" ] || LDPTA=$LDPRID  # FRR exige un transport-address ; défaut annoncé par l'UI
            # Deux contraintes de forme, vérifiées en test réel :
            #  - le sous-nœud « interface » se referme par « exit » (sinon
            #    « exit-address-family » est interprété dans le mauvais contexte) ;
            #  - ce bloc doit précéder « router ospf » / « router bgp », sans quoi
            #    le parseur rejette « address-family ipv4 » (les deux nœuds
            #    exposent un address-family et l'ordre les fait entrer en conflit).
            echo "mpls ldp"
            echo " router-id $LDPRID"
            echo " !"
            echo " address-family ipv4"
            [ -n "$LDPTA" ] && echo "  discovery transport-address $LDPTA"
            echo "  !"
            jq -r '(.mpls.ldp.interfaces // [])[] | "  interface \(.)\n  exit\n  !"' "$CFG"
            echo " exit-address-family"
            echo " !"
            echo "exit"
            echo "!"
        fi
        if jq -e '.ospf' "$CFG" >/dev/null 2>&1; then
            echo "router ospf"
            [ -n "$RID" ] && echo " ospf router-id $RID"
            jq -r '(.ospf.areas // [])[] | .id as $a | (.networks // [])[] | " network \(.) area \($a)"' "$CFG"
            jq -r '(.ospf.areas // [])[] | (.passive // [])[] | " passive-interface \(.)"' "$CFG"
            echo "!"
        fi
        if jq -e '.bgp' "$CFG" >/dev/null 2>&1; then
            echo "router bgp $ASN"
            [ -n "$RIDB" ] && echo " bgp router-id $RIDB"
            # FRR 8+ exige des politiques pour l'eBGP : on les rend optionnelles
            # afin qu'un AS puisse annoncer sans route-map.
            echo " no bgp ebgp-requires-policy"
            jq -r '(.bgp.neighbors // [])[] | [.ip, (.remoteAs | tostring), (.description // "")] | join("|")' "$CFG" |
                while IFS='|' read -r ip ras desc; do
                    echo " neighbor $ip remote-as $ras"
                    [ -n "$desc" ] && echo " neighbor $ip description $desc"
                done
            jq -r '(.bgp.neighbors // [])[] | select(.updateSource) | " neighbor \(.ip) update-source \(.updateSource)"' "$CFG"
            jq -r '(.bgp.neighbors // [])[] | select(.multihop) | " neighbor \(.ip) ebgp-multihop \(.multihop)"' "$CFG"
            jq -r '(.bgp.neighbors // [])[] | select(.keepalive) | " neighbor \(.ip) timers \(.keepalive) \(.hold)"' "$CFG"
            echo " address-family ipv4 unicast"
            jq -r '(.bgp.networks // [])[] | "  network \(.)"' "$CFG"
            jq -r '(.bgp.redistribute // [])[] | "  redistribute \(.)"' "$CFG"
            jq -r '(.bgp.neighbors // [])[] | "  neighbor \(.ip) activate"' "$CFG"
            jq -r '(.bgp.neighbors // [])[] | select(.routeReflectorClient) | "  neighbor \(.ip) route-reflector-client"' "$CFG"
            jq -r '(.bgp.neighbors // [])[] | select(.nextHopSelf) | "  neighbor \(.ip) next-hop-self"' "$CFG"
            jq -r '(.bgp.neighbors // [])[] | select(.sendCommunity) | "  neighbor \(.ip) send-community"' "$CFG"
            jq -r '(.bgp.neighbors // [])[] | select(.routeMapIn) | "  neighbor \(.ip) route-map \(.routeMapIn) in"' "$CFG"
            jq -r '(.bgp.neighbors // [])[] | select(.routeMapOut) | "  neighbor \(.ip) route-map \(.routeMapOut) out"' "$CFG"
            echo " exit-address-family"
            echo "!"
            jq -r '(.bgp.prefixLists // [])[] | .name as $n | (.entries // [])[] | [$n, (.seq | tostring), .action, .prefix, ((.ge // "") | tostring), ((.le // "") | tostring)] | join("|")' "$CFG" |
                while IFS='|' read -r nom seq action prefix ge le; do
                    ligne="ip prefix-list $nom seq $seq $action $prefix"
                    [ -n "$ge" ] && ligne="$ligne ge $ge"
                    [ -n "$le" ] && ligne="$ligne le $le"
                    echo "$ligne"
                done
            if jq -e '.bgp.prefixLists' "$CFG" >/dev/null 2>&1; then echo "!"; fi
            jq -r '(.bgp.communityLists // [])[] | .name as $n | (.entries // [])[] | [$n, (.seq | tostring), .action, .community] | join("|")' "$CFG" |
                while IFS='|' read -r nom seq action comm; do
                    echo "bgp community-list standard $nom seq $seq $action $comm"
                done
            if jq -e '.bgp.communityLists' "$CFG" >/dev/null 2>&1; then echo "!"; fi
            jq -r '(.bgp.routeMaps // [])[] | .name as $n | (.entries // [])[] | [$n, (.seq | tostring), .action, (.matchPrefixList // ""), (.matchCommunity // ""), ((.setLocalPreference // "") | tostring), ((.setMed // "") | tostring), (.setCommunity // ""), ((.setAsPathPrepend // "") | tostring)] | join("|")' "$CFG" |
                while IFS='|' read -r nom seq action mpl mcl slp smed scomm prepend; do
                    echo "route-map $nom $action $seq"
                    [ -n "$mpl" ] && echo " match ip address prefix-list $mpl"
                    [ -n "$mcl" ] && echo " match community $mcl"
                    [ -n "$slp" ] && echo " set local-preference $slp"
                    [ -n "$smed" ] && echo " set metric $smed"
                    [ -n "$scomm" ] && echo " set community $scomm"
                    if [ -n "$prepend" ]; then
                        aspath=""
                        i=0
                        while [ "$i" -lt "$prepend" ]; do
                            aspath="$aspath $ASN"
                            i=$((i + 1))
                        done
                        echo " set as-path prepend$aspath"
                    fi
                    echo "!"
                done
        fi
        # Options avancées (OSPF étendu, RIP, EIGRP, IS-IS…) : lignes rendues par app.py.
        jq -r '(.frrExtra // [])[]' "$CFG"
        echo "line vty"
        echo "!"
    } > /etc/frr/frr.conf
    chown frr:frr /etc/frr/frr.conf
    chmod 640 /etc/frr/frr.conf

    # zebra et staticd sont toujours lancés par frrinit.sh ; les autres démons
    # doivent être explicitement activés dans /etc/frr/daemons.
    # Démons toujours actifs (sans config ils restent inactifs) : tout est configurable
    # depuis vtysh. vrrpd et ldpd restent liés à l'UI (macvlan, platform_labels).
    sed -i -E 's/^(ospfd|bgpd|ripd|isisd|eigrpd|bfdd)=no/\1=yes/' /etc/frr/daemons
    if jq -e '.vrrp' "$CFG" >/dev/null 2>&1; then
        sed -i 's/^vrrpd=no/vrrpd=yes/' /etc/frr/daemons
    fi
    if jq -e '.mpls' "$CFG" >/dev/null 2>&1; then
        sed -i 's/^ldpd=no/ldpd=yes/' /etc/frr/daemons
    fi

    for d in $(jq -r '(.frrDaemons // [])[]' "$CFG" 2>/dev/null); do
        sed -i "s/^${d}=no/${d}=yes/" /etc/frr/daemons
    done

    /usr/lib/frr/frrinit.sh start
    log "FRR démarré (router-id ${RID:-automatique})"
fi

# ------------------------------------------------------------------- IPsec
# strongSwan : tunnels site-à-site IKEv2. charon est lancé en tâche de fond,
# la configuration est chargée via swanctl puis les connexions sont amorcées.
if jq -e '.ipsec' "$CFG" >/dev/null 2>&1; then
    log "configuration IPsec (strongSwan / IKEv2)"
    mkdir -p /etc/swanctl/conf.d
    # keyingtries = 0 : réessaie sans fin tant que le pair n'est pas prêt (défaut : un essai).
    {
        echo "connections {"
        jq -r '(.ipsec.connections // [])[] |
            "  \(.name) {\n" +
            "    local_addrs = \(.localAddrs)\n" +
            "    remote_addrs = \(.remoteAddrs)\n" +
            "    version = 2\n" +
            "    keyingtries = 0\n" +
            "    proposals = \(.proposals)\n" +
            "    local {\n      auth = psk\n      id = \(.localId)\n    }\n" +
            "    remote {\n      auth = psk\n      id = \(.remoteId)\n    }\n" +
            "    children {\n      \(.name) {\n" +
            "        local_ts = \(.localTs | join(","))\n" +
            "        remote_ts = \(.remoteTs | join(","))\n" +
            "        esp_proposals = \(.espProposals)\n" +
            "        start_action = \(if .startAction == "start" then "trap" else .startAction end)\n" +
            "      }\n    }\n  }"' "$CFG"
        echo "}"
        echo "secrets {"
        # Le préfixe « ike- » est obligatoire : c'est lui qui déclare un PSK IKE.
        jq -r '(.ipsec.connections // [])[] |
            "  ike-\(.name)-local {\n    id = \(.localId)\n    secret = \"\(.psk)\"\n  }\n" +
            "  ike-\(.name)-remote {\n    id = \(.remoteId)\n    secret = \"\(.psk)\"\n  }"' "$CFG"
        echo "}"
    } > /etc/swanctl/conf.d/lab01.conf

    # bypass-lan exempte de chiffrement les sous-réseaux locaux : or les routeurs d'un
    # même sous-réseau (GRE sur IPsec) doivent être chiffrés entre eux.
    echo 'bypass-lan { load = no }' > /etc/strongswan.d/charon/bypass-lan.conf
    /usr/lib/strongswan/charon >/dev/null 2>&1 &
    sleep 4
    swanctl --load-all 2>&1 | grep -iE 'loaded|error' | tail -3
    # « start » = trap (rétablit le tunnel au premier paquet) + amorçage ici. Au boot,
    # le pair n'a parfois pas encore chargé sa config et refuse : strongSwan prend ce
    # refus pour définitif, d'où la boucle tant qu'aucune IKE SA n'existe (5 min max).
    # app.py ne laisse qu'une extrémité en « start » (sinon deux tunnels concurrents).
    for nom in $(jq -r '(.ipsec.connections // [])[] | select(.startAction == "start") | .name' "$CFG"); do
        ( n=0
          while [ "$n" -lt 60 ] && ! swanctl --list-sas --ike "$nom" 2>/dev/null | grep -q "^$nom:"; do
              swanctl --initiate --child "$nom" --timeout 15 >/dev/null 2>&1
              n=$((n + 1)); sleep 5
          done ) &
    done
    log "IPsec chargé ($(jq -r '(.ipsec.connections // []) | length' "$CFG") connexion(s))"
fi

# --------------------------------------------------- réglages noyau avancés
# STP par port, timers du bridge, netem (qualité de lien), routes à métrique :
# commandes rendues par app.py. Un échec est journalisé sans arrêter le nœud.
if jq -e '.tune' "$CFG" >/dev/null 2>&1; then
    jq -r '(.tune // [])[]' "$CFG" | while IFS= read -r cmd; do
        [ -n "$cmd" ] || continue
        if sh -c "$cmd" >/dev/null 2>&1; then log "ok : $cmd"; else log "ÉCHEC : $cmd"; fi
    done
fi

log "nœud prêt"
exec tail -f /dev/null
