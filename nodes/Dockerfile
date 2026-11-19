# Image unique des nœuds LAB/01 : switch, routeur, PC et serveur.
# - iproute2/bridge-utils : bridge, VLAN 802.1Q, EtherChannel (bonding)
# - frr                   : routage (OSPF…)
# - keepalived            : VRRP
# - dnsmasq               : serveur DHCP
FROM alpine:3.20
RUN apk add --no-cache \
        iproute2 \
        bridge-utils \
        iputils \
        jq \
        tcpdump \
        frr \
        keepalived \
        strongswan \
        dnsmasq
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
