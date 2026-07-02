# READ VERY IMPORTANT — How to install, test, and use this

This covers copying the files to the router, running setup, and opening the
portal, from **both macOS and Windows**.

## 0. Before anything else

Your TR3000 must be running **OpenWrt**, not stock Cudy firmware — stock
firmware cannot spoof a MAC address at all. Flash it via
https://firmware-selector.openwrt.org (device profile `cudy_tr3000-v1`,
target `mediatek/filogic`) if you haven't already. Full details, including
required `opkg` packages, are in `README.md` in this folder.

Once OpenWrt is running, find the router's LAN IP (default is usually
`192.168.1.1` on OpenWrt, but check the sticker/manual — Cudy sometimes
ships `192.168.10.1`). All commands below use `<router-ip>` as a
placeholder — replace it with the real address.

---

## 1. Copy the files onto the router

### macOS

Open **Terminal** (Applications → Utilities → Terminal), `cd` into the
folder that contains this `mac-portal` directory, then:

```sh
scp -r mac-portal root@<router-ip>:/root/
ssh root@<router-ip>
```

If this is the first time connecting you'll get a fingerprint prompt —
type `yes`. If OpenWrt has no root password set yet, `ssh` will ask you to
set one before it lets you log in.

### Windows

**Easiest option — Windows 10/11 already has SSH/SCP built in.** Open
**PowerShell** (Start menu → type "PowerShell"), `cd` into the folder that
contains `mac-portal`, then run the exact same commands as macOS:

```powershell
scp -r mac-portal root@<router-ip>:/root/
ssh root@<router-ip>
```

If PowerShell says `scp`/`ssh` is not recognized, your Windows install is
missing the optional OpenSSH client — install it via **Settings → Apps →
Optional Features → Add a feature → OpenSSH Client**, then retry.

*(Alternative if you don't want to touch Settings: install
[PuTTY](https://www.putty.org/), which bundles `pscp.exe`. Then:
`pscp -r mac-portal root@<router-ip>:/root/` and use PuTTY itself,
or `putty.exe`, to SSH in.)*

---

## 2. Run the one-time setup (on the router, over SSH — same for both OSes)

You should now be logged into the router (your prompt will look like
`root@OpenWrt:~#`). Run:

```sh
sh /root/mac-portal-setup.sh
cp -r /root/mac-portal/www/mac-portal /www/
cp -r /root/mac-portal/www/cgi-bin/* /www/cgi-bin/
chmod 755 /www/cgi-bin/mac-portal-scan /www/cgi-bin/mac-portal-connect /www/cgi-bin/mac-portal-status
```

This is safe to re-run any time — it won't disturb a WiFi connection
that's already active.

---

## 3. Open the portal

From **any device on the router's own WiFi/LAN** (your Mac, your Windows
PC, or your phone), open a browser and go to:

```
http://<router-ip>/mac-portal/
```

Walk through the wizard: enter the MAC address of the already-authorized
device (e.g. your phone), scan, pick a network, enter a password if it
asks for one.

---

## 4. Verify it actually worked

Back in the same SSH session from step 2 (or open a new one the same way
as step 1), run:

```sh
ip link show wispsta        # "link/ether" should equal the MAC you typed in
iw dev wispsta link         # should show the SSID/network you picked
ubus call network.interface.wwan status | grep -E 'up|address'
```

If `ip link show wispsta` shows a MAC that does **not** match what you
typed, or `iw dev wispsta link` shows "Not connected", something went
wrong — check `logread | tail -50` on the router for the error, and see
the "Things to know" section in `README.md` (band mismatch, WPA3
requiring an extra package, etc. are the most common causes).

---

## 5. Common problems

| Symptom | Likely cause |
|---|---|
| `scp`/`ssh` not found (Windows) | Install OpenSSH Client, see step 1 |
| Can't reach `http://<router-ip>/mac-portal/` | You're not connected to the router's own WiFi/LAN, or the IP is wrong |
| Scan step shows nothing | `iwinfo`/`rpcd-mod-iwinfo` not installed — see `README.md` prerequisites, then `/etc/init.d/rpcd restart` |
| Secured network never connects | Wrong password, or it's WPA3-only and needs the `wpad-mbedtls` swap in `README.md` |
| Everything looks fine but no internet | The MAC you cloned may still be connected from the original device at the same time — turn its WiFi off |
