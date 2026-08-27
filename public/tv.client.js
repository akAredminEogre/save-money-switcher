// TV（観客）client — cmd_2159 Phase1 progressive enhancement。
// ?mode= 指定つきの URL は静的モード表示（E2E 等の URL 駆動）ゆえ live 購読しない。
// 素の /tv のみ EventSource で game_state.tvMode 追従の live 表示を受け取り #app へ swap する。
(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  if (params.has("mode")) return; // 静的モード表示は購読せず初期 chrome を保つ
  var app = document.getElementById("app");
  if (!app) return;
  var es = new EventSource("/events?role=audience");
  es.onmessage = function (ev) {
    try {
      var msg = JSON.parse(ev.data);
      if (msg && msg.html != null) app.innerHTML = msg.html;
    } catch (_) {}
  };
})();
