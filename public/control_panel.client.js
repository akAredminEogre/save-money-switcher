// 制御盤（司会者）client — cmd_2159 Phase1 progressive enhancement。
// 司会者トリガー button[data-command] のクリックを POST /host/command へ送り、EventSource で
// 受け取ったサーフェス HTML を #app へ innerHTML swap する（依存なし・標準 EventSource/fetch）。
(function () {
  "use strict";
  var app = document.getElementById("app");
  if (!app) return;

  // クリックは #app へ委譲する。#app は swap 後も同一要素ゆえリスナは生存する。
  app.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("button[data-command]");
    if (!btn) return;
    var command = btn.getAttribute("data-command");
    var mode = btn.getAttribute("data-mode");
    var payload = { command: command };
    if (mode) payload.mode = mode;
    fetch("/host/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(function () {});
  });

  var es = new EventSource("/events?role=host");
  es.onmessage = function (ev) {
    try {
      var msg = JSON.parse(ev.data);
      if (msg && msg.html != null) app.innerHTML = msg.html;
    } catch (_) {}
  };
})();
