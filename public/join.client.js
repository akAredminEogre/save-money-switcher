// 参加受付 client — cmd_2159 Phase1 progressive enhancement。
// 氏名フォーム送信を横取りして POST /join し、返却された participantId を付けて /tablet へ遷移する。
// participantId はこの端末の localStorage にも残す（リロード・別タブで匿名化しないため）。
(function () {
  "use strict";
  var STORAGE_KEY = "smsw.participantId";
  var app = document.getElementById("app");
  if (!app) return;
  var form = app.querySelector("form");
  if (!form) return;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var input = form.querySelector('input[type="text"]');
    var name = input ? input.value : "";
    if (!name || !name.trim()) return;
    fetch("/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name }),
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (data && data.participantId) {
          try {
            localStorage.setItem(STORAGE_KEY, data.participantId);
          } catch (_) {}
          location.href = "/tablet?participantId=" + encodeURIComponent(data.participantId);
        }
      })
      .catch(function () {});
  });
})();
