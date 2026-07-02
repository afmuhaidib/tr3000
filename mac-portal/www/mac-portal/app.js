(function () {
  "use strict";

  var MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

  var state = {
    mac: null,
    ssid: null,
    enc: null
  };

  var steps = {
    mac: document.getElementById("step-mac"),
    scan: document.getElementById("step-scan"),
    password: document.getElementById("step-password"),
    connecting: document.getElementById("step-connecting")
  };

  function showStep(name) {
    Object.keys(steps).forEach(function (k) {
      steps[k].hidden = k !== name;
    });
  }

  function isMulticast(mac) {
    var firstOctet = mac.split(":")[0];
    var secondChar = firstOctet.charAt(1).toLowerCase();
    return "13579bdf".indexOf(secondChar) !== -1;
  }

  // --- step 1: MAC entry -----------------------------------------------
  var macForm = document.getElementById("mac-form");
  var macInput = document.getElementById("mac-input");
  var macError = document.getElementById("mac-error");

  macForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var mac = macInput.value.trim().toLowerCase();
    if (!MAC_RE.test(mac)) {
      macError.textContent = "Enter a MAC address like aa:bb:cc:dd:ee:ff";
      macError.hidden = false;
      return;
    }
    if (isMulticast(mac)) {
      macError.textContent = "That MAC address can't belong to a real device (multicast bit set).";
      macError.hidden = false;
      return;
    }
    macError.hidden = true;
    state.mac = mac;
    showStep("scan");
    runScan();
  });

  // --- step 2: scan + pick network ---------------------------------------
  var networkList = document.getElementById("network-list");
  var scanStatus = document.getElementById("scan-status");
  var rescanBtn = document.getElementById("rescan-btn");

  rescanBtn.addEventListener("click", runScan);

  function pickEnc(encInfo) {
    if (!encInfo || !encInfo.enabled) return "none";
    var auth = encInfo.authentication || [];
    var hasSae = auth.indexOf("sae") !== -1;
    var hasPsk = auth.indexOf("psk") !== -1;
    if (hasSae && hasPsk) return "sae-mixed";
    if (hasSae) return "sae";
    return "psk2";
  }

  function runScan() {
    networkList.innerHTML = "";
    scanStatus.textContent = "Scanning…";
    fetch("/cgi-bin/mac-portal-scan")
      .then(function (r) {
        if (!r.ok) throw new Error("scan failed (" + r.status + ")");
        return r.json();
      })
      .then(function (data) {
        var results = (data && data.results) || [];
        results.sort(function (a, b) { return (b.signal || -999) - (a.signal || -999); });
        if (results.length === 0) {
          scanStatus.textContent = "No networks found.";
          return;
        }
        scanStatus.textContent = "";
        results.forEach(function (net) {
          if (!net.ssid) return;
          var enc = pickEnc(net.encryption);
          var li = document.createElement("li");
          li.className = "network";

          var name = document.createElement("span");
          name.className = "ssid";
          name.textContent = net.ssid;

          var badge = document.createElement("span");
          badge.className = "badge " + (enc === "none" ? "open" : "secured");
          badge.textContent = enc === "none" ? "Open" : "Secured";

          li.appendChild(name);
          li.appendChild(badge);
          li.addEventListener("click", function () {
            state.ssid = net.ssid;
            state.enc = enc;
            if (enc === "none") {
              showStep("connecting");
              doConnect("");
            } else {
              document.getElementById("password-ssid").textContent = net.ssid;
              showStep("password");
            }
          });
          networkList.appendChild(li);
        });
      })
      .catch(function (err) {
        scanStatus.textContent = "Scan failed: " + err.message;
      });
  }

  // --- step 3: password (secured networks only) --------------------------
  var passwordForm = document.getElementById("password-form");
  var passwordInput = document.getElementById("password-input");
  var passwordError = document.getElementById("password-error");
  document.getElementById("password-back-btn").addEventListener("click", function () {
    showStep("scan");
  });

  passwordForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var pw = passwordInput.value;
    if (pw.length < 8 || pw.length > 63) {
      passwordError.textContent = "Password must be 8-63 characters.";
      passwordError.hidden = false;
      return;
    }
    passwordError.hidden = true;
    showStep("connecting");
    doConnect(pw);
  });

  // --- step 4: connect + poll status --------------------------------------
  var connectResult = document.getElementById("connect-result");
  var connectingText = document.getElementById("connecting-text");
  var spinner = document.getElementById("spinner");
  var startOverBtn = document.getElementById("start-over-btn");

  startOverBtn.addEventListener("click", function () {
    state = { mac: null, ssid: null, enc: null };
    macInput.value = "";
    passwordInput.value = "";
    connectResult.textContent = "";
    startOverBtn.hidden = true;
    spinner.hidden = false;
    showStep("mac");
  });

  function doConnect(password) {
    connectingText.textContent = "Connecting to “" + state.ssid + "”…";
    connectResult.textContent = "";
    spinner.hidden = false;
    startOverBtn.hidden = true;

    var body = new URLSearchParams();
    body.set("mac", state.mac);
    body.set("ssid", state.ssid);
    body.set("enc", state.enc);
    if (state.enc !== "none") body.set("key", password);

    fetch("/cgi-bin/mac-portal-connect", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) {
          finish(false, "Rejected: " + (res.body && res.body.message ? res.body.message : "unknown error"));
          return;
        }
        pollStatus(0);
      })
      .catch(function (err) {
        finish(false, "Request failed: " + err.message);
      });
  }

  function pollStatus(attempt) {
    var MAX_ATTEMPTS = 10; // ~20s at 2s intervals
    fetch("/cgi-bin/mac-portal-status")
      .then(function (r) { return r.json(); })
      .then(function (st) {
        if (st && st.up) {
          var ip = st["ipv4-address"] && st["ipv4-address"][0] && st["ipv4-address"][0].address;
          finish(true, "Connected" + (ip ? " — " + ip : "") + ".");
          return;
        }
        if (attempt >= MAX_ATTEMPTS) {
          finish(false, "Timed out waiting for a connection. Check the password and try again.");
          return;
        }
        setTimeout(function () { pollStatus(attempt + 1); }, 2000);
      })
      .catch(function () {
        if (attempt >= MAX_ATTEMPTS) {
          finish(false, "Timed out waiting for a connection.");
        } else {
          setTimeout(function () { pollStatus(attempt + 1); }, 2000);
        }
      });
  }

  function finish(success, message) {
    spinner.hidden = true;
    connectingText.textContent = success ? "Success" : "Couldn't connect";
    connectResult.textContent = message;
    connectResult.className = success ? "success" : "error";
    startOverBtn.hidden = false;
  }
})();
