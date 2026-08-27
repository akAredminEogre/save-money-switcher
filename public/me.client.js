// メンバー設定 client — cmd_2159 機能追加（メンバー参加動線＋メンバー名設定）。
// 自分の表示名の変更フォームを横取りして POST /participant/name し、結果を面へ反映する。
// 設定面は live 更新を要さぬゆえ EventSource は張らない（接続数を無駄に増やさない）。
(function () {
  "use strict";
  var STORAGE_KEY = "smsw.participantId";
  var app = document.getElementById("app");
  if (!app) return;

  function storedId() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  var params = new URLSearchParams(location.search);
  var pid = params.get("participantId");
  if (!pid) {
    // クエリ未指定でもこの端末の参加を復元する。サーバ描画と一致させるため URL を整えて描き直す。
    var saved = storedId();
    if (saved) {
      location.replace("/me?participantId=" + encodeURIComponent(saved));
      return;
    }
    return; // 未参加: サーバが返した参加導線つきの平易文をそのまま見せる。
  }
  try {
    localStorage.setItem(STORAGE_KEY, pid);
  } catch (_) {}

  var form = app.querySelector('form[data-form="rename"]');
  if (!form) return;
  var nameField = app.querySelector('[data-field="display-name"]');
  var messageField = app.querySelector('[data-field="message"]');

  function say(text) {
    if (messageField) messageField.textContent = text;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var input = form.querySelector('input[type="text"]');
    var name = input ? input.value : "";
    fetch("/participant/name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: pid, name: name }),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, data: data };
        });
      })
      .then(function (res) {
        if (res.ok && res.data && res.data.name) {
          if (nameField) nameField.textContent = res.data.name;
          if (input) input.value = res.data.name;
          say("お名前を変更しました。");
          return;
        }
        // 失敗はサーバが返した平易な理由をそのまま出す（内部語・スタックを出さない）。
        say(res.data && res.data.error ? res.data.error : "お名前を変更できませんでした。");
      })
      .catch(function () {
        say("お名前を変更できませんでした。");
      });
  });
})();
