// エピソード詳細（管理者）client — 案A P2。
// 詳細面には進行制御盤が埋め込まれる。制御盤の司会者トリガー button[data-command] を
// POST /host/command へ送り、EventSource で受け取った制御盤の HTML は **#control-panel だけ**へ
// swap する（詳細面の各フォームを消さないため #app 全体は差し替えない）。
(function () {
  "use strict";
  var panel = document.getElementById("control-panel");
  if (!panel) return;

  panel.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("button[data-command]");
    if (!btn) return;
    var command = btn.getAttribute("data-command");
    var mode = btn.getAttribute("data-mode");
    var payload = { command: command };
    if (mode) payload.mode = mode;
    fetch("/host/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    }).catch(function () {});
  });

  // 申告するのは「今開いている面」だけ。購読可否と投影ロールはサーバがセッションから決める。
  var es = new EventSource("/events?surface=control_panel");
  es.onmessage = function (ev) {
    try {
      var msg = JSON.parse(ev.data);
      if (msg && msg.html != null) panel.innerHTML = msg.html;
    } catch (_) {}
  };
})();
