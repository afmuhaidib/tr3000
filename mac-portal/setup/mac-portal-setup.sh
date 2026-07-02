#!/bin/sh
# mac-portal-setup.sh
#
# One-time, idempotent provisioning for the MAC-clone WiFi portal on OpenWrt.
# Run once over ssh on the router: sh /root/mac-portal-setup.sh
#
# Creates/updates only three things:
#   - network interface "wwan"        (dhcp client, feeds the WISP uplink)
#   - wireless wifi-iface "wisp_sta"   (the client radio the portal drives)
#   - the firewall "wan" zone's network list (adds "wwan" so NAT applies)
# Everything else on the router (existing local AP SSIDs, LAN, etc) is left
# untouched. Safe to re-run at any time.

set -e

RADIO="${RADIO:-radio1}"          # default: 5GHz radio dedicated to the WISP client
IFNAME="${IFNAME:-wispsta}"       # pinned netdev name so the CGIs never have to look it up
STA_SECTION=wisp_sta
WWAN_IFACE=wwan
CONF=/etc/mac-portal.conf

echo "Provisioning MAC-clone portal (radio=$RADIO ifname=$IFNAME)..."

# --- network.wwan --------------------------------------------------------
if ! uci -q get network.$WWAN_IFACE >/dev/null; then
    uci set network.$WWAN_IFACE=interface
fi
uci set network.$WWAN_IFACE.proto='dhcp'

# --- wireless.wisp_sta -----------------------------------------------------
if ! uci -q get wireless.$STA_SECTION >/dev/null; then
    uci set wireless.$STA_SECTION=wifi-iface
fi
uci set wireless.$STA_SECTION.device="$RADIO"
uci set wireless.$STA_SECTION.ifname="$IFNAME"
uci set wireless.$STA_SECTION.network="$WWAN_IFACE"
uci set wireless.$STA_SECTION.mode='sta'
uci set wireless.$STA_SECTION.disabled='0'

# Only seed a placeholder ssid/encryption if nothing is configured yet, so
# re-running this script never clobbers a session the portal already made live.
CUR_SSID="$(uci -q get wireless.$STA_SECTION.ssid || true)"
if [ -z "$CUR_SSID" ]; then
    uci set wireless.$STA_SECTION.ssid='unconfigured-mac-portal'
    uci set wireless.$STA_SECTION.encryption='none'
fi

# --- firewall: add wwan to the "wan" zone's network list -------------------
ZONE=""
for s in $(uci show firewall 2>/dev/null | sed -n "s/^\(firewall\.@zone\[[0-9]*\]\)=zone$/\1/p"); do
    if [ "$(uci -q get $s.name)" = "wan" ]; then
        ZONE="$s"
        break
    fi
done

if [ -n "$ZONE" ]; then
    if ! uci -q get "$ZONE.network" | grep -qw "$WWAN_IFACE"; then
        uci add_list "$ZONE.network=$WWAN_IFACE"
    fi
else
    echo "WARNING: no firewall zone named 'wan' found." >&2
    echo "  Add '$WWAN_IFACE' to your WAN zone's network list manually." >&2
fi

uci commit wireless
uci commit network
uci commit firewall

# --- config file read by the CGI scripts ------------------------------------
cat > "$CONF" <<EOF
RADIO=$RADIO
IFNAME=$IFNAME
STA_SECTION=$STA_SECTION
WWAN_IFACE=$WWAN_IFACE
EOF

/etc/init.d/network reload

echo "Done."
echo "Wrote $CONF"
echo "Copy the www/ files onto the router (see README.md) then open:"
echo "  http://<router-lan-ip>/mac-portal/"
