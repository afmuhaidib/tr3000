# MAC-Clone WiFi Portal (Cudy TR3000 / AX3000)

A small local web page that lets you: type in the MAC address of a device
that's already authorized on some WiFi network (e.g. your phone, which
already passed a hotel/airport captive-portal login), scan for that network,
pick it, and have the router join it as a WiFi client while spoofing that
MAC address — so the router (and everything behind it) rides the
already-authorized session. Open networks connect with a single click, no
password step.

**This is not a traffic-intercepting captive portal.** It's a normal page
you open yourself at `http://<router-lan-ip>/mac-portal/`.

## Prerequisite: flash OpenWrt

Cudy's stock TR3000 firmware has **no MAC-cloning support**, so this only
works on OpenWrt. The TR3000 is officially supported as device profile
`cudy_tr3000-v1` (target `mediatek/filogic`) — flash it via
https://firmware-selector.openwrt.org before doing anything below.

After first boot, over ssh:

```sh
opkg update
opkg install iwinfo rpcd-mod-iwinfo
/etc/init.d/rpcd restart
```

The CGI scripts also need `awk` and `dd`, both part of busybox and present
on every stock OpenWrt image by default — no extra install needed unless
you've built a custom image with them stripped out.

If you might join a WPA3-only network, also swap the supplicant (the
default image ships `wpad-basic-mbedtls`, which can't do WPA3/SAE):

```sh
opkg remove wpad-basic-mbedtls
opkg install wpad-mbedtls
```

## Install

From your computer:

```sh
scp -r mac-portal root@<router-ip>:/root/
ssh root@<router-ip>
```

Then on the router:

```sh
sh /root/mac-portal-setup.sh          # one-time, safe to re-run
cp -r /root/mac-portal/www/mac-portal /www/
cp -r /root/mac-portal/www/cgi-bin/* /www/cgi-bin/
chmod 755 /www/cgi-bin/mac-portal-scan /www/cgi-bin/mac-portal-connect /www/cgi-bin/mac-portal-status
```

Open `http://<router-ip>/mac-portal/` from any device on the router's LAN.

## How it's wired together

`setup/mac-portal-setup.sh` provisions three things and nothing else:

- `network.wwan` — a DHCP client interface for the upstream connection
- `wireless.wisp_sta` — a WiFi client (`mode sta`) interface, pinned to
  netdev name `wispsta`, bound to `network.wwan`. Default radio is
  **radio1 (5GHz)** — see "Radio choice" below.
- adds `wwan` to the firewall's `wan` zone so NAT/internet sharing works

It writes `/etc/mac-portal.conf` (RADIO/IFNAME/etc.) which the three CGI
scripts read, so you can switch bands later by editing that file and
re-running the setup script.

The three endpoints:

| Endpoint | Method | Does |
|---|---|---|
| `/cgi-bin/mac-portal-scan` | GET | Runs `ubus call iwinfo scan` on the client radio, returns the JSON straight through |
| `/cgi-bin/mac-portal-connect` | POST | Validates `mac`/`ssid`/`enc`/`key`, writes them into `wireless.wisp_sta`, brings the radio up |
| `/cgi-bin/mac-portal-status` | GET | Returns `ubus call network.interface.wwan status`, polled by the page after connecting |

## Things to know

- **Radio choice.** Bringing the client radio up briefly bounces every
  WiFi interface sharing that same radio chip. The TR3000 is dual-band
  (2.4GHz + 5GHz), not tri-band, so keep your own local AP SSID(s) on
  **radio0 (2.4GHz)** and leave radio1 dedicated to this WISP client —
  that way connecting never disturbs devices already on your own AP. If
  the network you want is only visible on 2.4GHz, edit `RADIO=radio0` in
  `/etc/mac-portal.conf` and re-run the setup script (this will then
  briefly disturb your own 2.4GHz AP).
- **MAC collision.** If the original already-authorized device (e.g. your
  phone) stays connected to the same network at the same time as the
  router, you now have two devices with the same MAC on one network —
  expect IP conflicts, dropped sessions, or the network's abuse detection
  kicking one of you off. Turn the phone's WiFi off once the router is
  connected.
- **WPA3/SAE** needs the `wpad-mbedtls` swap above, otherwise it fails to
  associate silently.
- **No portal authentication.** Anyone already on your LAN can open the
  page and repoint the WISP client. Fine for personal use; add uhttpd
  basic-auth on `/mac-portal/` and `/cgi-bin/mac-portal-*` if you want to
  lock it down further.
- Some captive portals bind an authorized session to MAC *and* IP/time
  together, not just MAC — cloning the MAC alone isn't a 100% guarantee
  it'll be treated as the same session.

## Verifying it actually works

```sh
# 1. config sanity + idempotency
uci show wireless.wisp_sta
uci show network.wwan
uci show firewall | grep wwan
sh /root/mac-portal-setup.sh   # re-run, should produce no uci diff

# 2. client netdev exists before any connect
ip link show wispsta
iw dev wispsta info

# 3. scan endpoint
curl http://localhost/cgi-bin/mac-portal-scan | jq .

# 4. after connecting through the page to an open network with a known MAC:
ip link show wispsta        # hwaddr should equal the MAC you typed in
iw dev wispsta link         # SSID/BSSID should match what you picked

# 5. status endpoint
curl http://localhost/cgi-bin/mac-portal-status | jq .

# 6. while testing 3-5, keep a laptop/phone connected to your own AP on
#    radio0 and confirm it never drops.
```
