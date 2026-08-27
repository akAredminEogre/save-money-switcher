// 解答者タブレット client — cmd_2159 Phase1 progressive enhancement。
// −10/−1/+1/+10 ステッパはクライアント局所値（0〜100 クランプ）を作り、送信で POST /tablet/answer。
// EventSource で受け取ったサーフェス HTML を #app へ swap し、局所ステッパ値を復元する。
(function () {
  "use strict";
  var STORAGE_KEY = "smsw.participantId";
  var app = document.getElementById("app");
  if (!app) return;
  var params = new URLSearchParams(location.search);
  // 身元はクエリ→この端末の localStorage の順で解決する。クエリ由来なら端末側へも残し、
  // 以後クエリ無しでリロードしても同じ参加者のまま（匿名化して残額 0 に落ちない）。
  var pid = params.get("participantId");
  if (pid) {
    try {
      localStorage.setItem(STORAGE_KEY, pid);
    } catch (_) {}
  } else {
    try {
      pid = localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      pid = null;
    }
  }
  var localValue = 0;

  function restore() {
    var out = app.querySelector('[data-field="answer-value"]');
    if (out) out.textContent = String(localValue);
  }

  app.addEventListener("click", function (e) {
    var closest = e.target.closest ? e.target.closest.bind(e.target) : null;
    if (!closest) return;
    var step = closest('button[data-op="step"]');
    if (step) {
      if (step.disabled) return;
      var delta = parseInt(step.getAttribute("data-delta"), 10) || 0;
      localValue = Math.max(0, Math.min(100, localValue + delta));
      restore();
      return;
    }
    var submit = closest('button[data-op="submit"]');
    if (submit) {
      if (submit.disabled || !pid) return;
      fetch("/tablet/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: pid, value: localValue }),
      }).catch(function () {});
    }
  });

  var url = "/events?role=answerer" + (pid ? "&participantId=" + encodeURIComponent(pid) : "");
  var es = new EventSource(url);
  es.onmessage = function (ev) {
    try {
      var msg = JSON.parse(ev.data);
      if (msg && msg.html != null) {
        app.innerHTML = msg.html;
        restore();
      }
    } catch (_) {}
  };
  restore();
})();
