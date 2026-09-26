// アカウント設定 client — 案A（事前アカウント方式・2026-08-28 殿裁可）。
// 表示名・パスワードの変更フォームを横取りして自分のアカウントへ POST する。身元は HttpOnly Cookie の
// セッションがサーバ側で持つゆえ、client は identity を一切保持しない（localStorage は用いない）。
// 設定面は live 更新を要さぬゆえ EventSource は張らない（接続数を無駄に増やさない）。
(function () {
  "use strict";
  var app = document.getElementById("app");
  if (!app) return;

  var messageField = app.querySelector('[data-field="message"]');
  function say(text) {
    if (messageField) messageField.textContent = text;
  }

  function post(path, payload) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().then(function (data) {
        return { ok: r.ok, data: data };
      });
    });
  }

  var renameForm = app.querySelector('form[data-form="rename"]');
  if (renameForm) {
    renameForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = renameForm.querySelector('input[type="text"]');
      post("/me/display-name", { display_name: input ? input.value : "" })
        .then(function (res) {
          if (res.ok && res.data && res.data.displayName) {
            var field = app.querySelector('[data-field="display-name"]');
            if (field) field.textContent = res.data.displayName;
            if (input) input.value = res.data.displayName;
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
  }

  var passwordForm = app.querySelector('form[data-form="password"]');
  if (passwordForm) {
    passwordForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = passwordForm.querySelector('input[type="password"]');
      post("/me/password", { password: input ? input.value : "" })
        .then(function (res) {
          if (input) input.value = ""; // 平文を画面へ残さない
          say(
            res.ok
              ? "パスワードを変更しました。"
              : res.data && res.data.error
                ? res.data.error
                : "パスワードを変更できませんでした。",
          );
        })
        .catch(function () {
          if (input) input.value = "";
          say("パスワードを変更できませんでした。");
        });
    });
  }
})();
