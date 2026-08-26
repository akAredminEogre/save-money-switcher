---
codd:
  node_id: design:operational-behavior-model
  type: design
  depends_on:
  - id: design:scoring-engine-design
    relation: depends_on
    semantic: technical
  - id: design:participation-connection-design
    relation: depends_on
    semantic: technical
  - id: design:question-media-intake-design
    relation: depends_on
    semantic: technical
  - id: design:realtime-sync-design
    relation: depends_on
    semantic: technical
  depended_by:
  - id: detailed_design:state-machines
    relation: depends_on
    semantic: technical
  - id: detailed_design:sequence-flows
    relation: depends_on
    semantic: technical
  - id: plan:implementation-plan
    relation: constrained_by
    semantic: governance
  - id: test:test-strategy
    relation: depends_on
    semantic: verification
  conventions:
  - targets:
    - module:control_panel
    - role:host
    reason: 締切（そこまで）・開示（解答オープン）・正解発表・精算・モード切替（次へ/戻る/個別ジャンプ）・取消は司会者（制御盤）のみが発動でき、各操作の到達導線（制御盤上の可視トリガー）を定義すること。副司会・解答者端末からの発動や
      API 直叩きは不可（論点7・N-3）。違反時リリース不可。
  - targets:
    - role:answerer
    - module:tablet
    reason: 解答者アクションは回答入力（+1/−1/+10/−10）と送信のみで、締切・開示・他者情報閲覧は禁止（第三要件・N-1）。到達導線は QR
      参加→氏名入力→入力画面に限定する。違反時リリース不可。
  - targets:
    - module:game_flow
    reason: 進行状態（受付中→締切→b 開示→c 正解発表→d 精算→e 一覧）と各問の到達モード（b/c/d）を actor/action/outcome
      として定義し、再採点誘発条件を実装が省略できない契約にする（E-3残）。違反時リリース不可。
  - targets:
    - module:scoring
    reason: 各アクションの outcome（減算・ピタリ賞横取り・残額更新・自動再採点）を確定値どおりに定義し、E2E テストへ先送りしないこと。違反時リリース不可。
  modules:
  - control_panel
  - tablet
  - tv_display
  - game_flow
  - scoring
  - participants
  operation_flow:
    actors:
    - id: host
      label: 司会者（制御盤）
      surface: /control-panel
    - id: answerer
      label: 解答者（タブレット）
      surface: /tablet
    - id: audience
      label: 観客（TV）
      surface: /tv
    - id: system
      label: クラウドサーバ（realtime_sync 権威 / scoring / participants）
    operations:
    - id: op_display_join_qr
      actor: host
      verb: display
      target: join_qr
      trigger: 司会者が制御盤を開くと参加用 QR が表示される
      route: /control-panel
      ui_pattern: qr_display
      preconditions:
      - PUBLIC_BASE_URL が設定済み
      measurement_source: resolvePublicBaseUrl() と（分岐A時）JOIN_ACCESS_TOKEN
      readback: QR 読取りでクラウド公開の /join へ到達する
      visible_to:
      - host
      forbidden_actors:
      - answerer
      - audience
      expected_outcomes:
      - 制御盤に /join 公開 URL を符号化した QR が表示される
      - QR 提示面に事前氏名台帳・端末番号割当の入力要素が存在しない
      dod_obligations:
      - id: dod_qr_encodes_public_join_url
        text: 制御盤に表示される QR がクラウド公開の /join URL を符号化し、読取りで /join へ到達する
      - id: dod_qr_no_seat_ledger
        text: QR 提示面に事前氏名台帳・端末番号割当の入力要素が存在しない
    - id: op_guard_family_access
      actor: system
      verb: guard
      target: join_access
      trigger: 解答者が /join へ到達し参加確定を試行
      route: /join
      measurement_source: 提示トークン（分岐A）またはセッション認証状態（分岐B）と src/config のアクセス制御設定
      preconditions:
      - 参加アクセス制御が URL 秘匿トークンまたは認証のいずれかで構成されている
      durable_state: なし（アクセス判定は設定と提示情報から導出）
      consumer_surfaces:
      - join_page
      expected_outcomes:
      - 分岐A では秘匿トークン一致のときのみ /join 参加が許可される
      - 分岐B では認証済のときのみ許可され、ログイン→リダイレクト→描画のフローを備える
      - どちらの制御も未構成なら参加を許可しない（無制御公開は成立しない）
      - 受入は src/config の上限解決点と role 判定を必ず経由する
      boundary_cases:
      - アクセス制御未構成 → 参加不可（無認証の無制限公開はリリース不可構成）
      - 分岐A トークン不一致 → 参加不可
      - 分岐B 未認証 → /join は保護ナビを露出せずログインへ誘導
      dod_obligations:
      - id: dod_access_no_open_public
        text: URL 秘匿トークンも認証も未構成の場合に /join の参加確定が許可されず、無制御公開が構成上も実行上も成立しない
      - id: dod_access_single_resolution
        text: 分岐 A/B いずれでも参加受入が src/config の上限解決点と role 判定の単一経路を経由する
      - id: dod_access_no_protected_nav
        text: 未認証・未参加の /join に制御盤操作等の保護ナビが露出しない
    - id: op_establish_connection
      actor: system
      verb: accept
      target: websocket_session
      trigger: 端末が公開 URL をブラウザで開き WebSocket 接続してロールを申告する
      route: /control-panel | /tv | /tablet | /join
      preconditions:
      - WebSocket 待受はクラウドサーバのみに存在する
      measurement_source: 接続時のロール申告と（answerer は）resume トークン
      durable_state: hub のロール別接続レジストリ（host/answerer/audience）
      readback: 接続直後にロール投影済み state_snapshot を unicast で返す
      expected_outcomes:
      - セッションにロール（host/answerer/audience）が確定する
      - 制御盤ブラウザは待受ソケットを持たず配信はクラウド権威から届く
      dod_obligations:
      - id: dod_conn_cloud_authority
        text: WebSocket の待受はクラウドサーバ側のみに存在し、制御盤ブラウザは待受ソケットを開かない
      - id: dod_conn_role_scoped_session
        text: 接続確立時にセッションのロールが確定し、以後の配信投影と権限判定がそのロールを単一判定点として参照する
    - id: op_join_game
      actor: answerer
      verb: join
      target: game_session
      trigger: 制御盤の QR を読取り /join で氏名を自己入力して参加確定
      route: /join
      ui_pattern: qr_scan_then_name_input
      preconditions:
      - 家族限定アクセス制御を通過している（分岐A トークン一致 または 分岐B 認証済）
      - answerer 接続数が MAX_TABLET_CONNECTIONS 未満
      - 氏名が非空かつ MAX_DISPLAY_NAME_LENGTH 以下
      measurement_source: 解答者の自己入力氏名
      durable_state: participants テーブル（id / name / joined_at / connection_id）＋ balances
        行の初期化（amount = 10000）
      readback: 制御盤の参加者一覧と TV(e) 全問通算一覧に反映
      visible_to:
      - host
      - audience
      forbidden_actors: []
      expected_outcomes:
      - 自己入力した氏名で participants に 1 人 1 レコードが作られ connection_id へ紐付く
      - 当該参加者の balances.amount が 10000 円（賞金先渡し）で初期化される
      - 参加が制御盤の参加者一覧と TV(e) に反映される
      - 端末番号の固定割当や事前氏名台帳を用いずに参加が成立する
      boundary_cases:
      - 空・空白のみの氏名 → UI とサーバの双方で拒否
      - MAX_DISPLAY_NAME_LENGTH 超過の氏名 → UI とサーバの双方で拒否
      - 同名の別人 → それぞれ別の participants レコード（氏名は一意キーでない）
      - 同一端末の resume なし再 /join → 新規参加として上限判定を再通過
      dod_obligations:
      - id: dod_join_self_name
        text: 参加者が自己入力した氏名が participants に永続し、制御盤の参加者一覧に表示される
      - id: dod_join_no_seat_fixed
        text: 端末番号の固定割当や事前氏名台帳の UI/API を用いずに参加が成立する
      - id: dod_join_one_device
        text: 参加確定 1 回につき connection_id へ紐づく participants レコードが 1 件だけ生成される
      - id: dod_join_reflected
        text: 参加確定が制御盤の参加者一覧と TV(e) の全問通算一覧へ反映される
      - id: dod_join_name_validation
        text: 空・空白のみ・上限長超過の氏名は /join の UI とサーバの双方で拒否され participants に入らない
      - id: dod_settle_initial_grant
        text: ゲーム開始時に各プレイヤーの balances.amount が 10000 円で初期化されている
    - id: op_enforce_connection_limit
      actor: system
      verb: reject
      target: tablet_connection
      trigger: answerer 接続数が MAX_TABLET_CONNECTIONS に達した状態での新規参加確定の試行
      route: /join
      measurement_source: 現在の answerer 接続数と src/config の MAX_TABLET_CONNECTIONS 解決値
      threshold: MAX_TABLET_CONNECTIONS（既定 8）
      preconditions:
      - connected_answerers >= MAX_TABLET_CONNECTIONS
      durable_state: 既存接続・participants・answers・balances は不変
      consumer_surfaces:
      - join_page
      expected_outcomes:
      - admitTablet が over_limit を返し参加が成立しない
      - realtime_sync が connection_rejected とともに WS close(4001) で断る
      - 既存の接続と保持データ（participants/answers/balances/進行状態）は影響を受けない
      - host/audience 接続はタブレット上限に数えない別チャネルとして扱う
      - /join に満席の平易文が表示され設定キー名・接続数会計は露出しない
      boundary_cases:
      - 既定 8: 8 台目は許可・9 台目は拒否
      - 設定 16: 16 台目は許可・17 台目は拒否
      - 設定 32: 32 台目は許可・33 台目は拒否
      - 切断でスロット解放後は同数まで再受入可
      dod_obligations:
      - id: dod_limit_default_eight
        text: 設定未指定時に 8 台まで接続でき 9 台目が拒否される
      - id: dod_limit_config_follows
        text: MAX_TABLET_CONNECTIONS を 16/32 へ設定変更するとコード改修なしに上限がその値へ追随する
      - id: dod_limit_no_hardcode
        text: 上限判定は src/config の解決値を参照し、判定コードに数値リテラル 8 のハードコードが存在しない
      - id: dod_limit_existing_unaffected
        text: 上限拒否の発生時に既存接続のセッション・回答・残額・進行状態が変化しない
      - id: dod_limit_join_full_copy
        text: /join の満席表示が job-to-be-done 平易文で、設定キー名・接続数会計・ロール識別子を露出しない
    - id: op_load_questions
      actor: host
      verb: load
      target: question_set
      trigger: 制御盤で事前問題ファイル（JSON）の読込を実行
      route: /control-panel
      ui_pattern: file_pick_then_load
      forbidden_actors:
      - answerer
      - audience
      preconditions:
      - game_state.phase が lobby またはライブ編集フェーズ（in_progress のライブ編集中）
      - 参照される全メディアが所定フォルダ（QUESTION_MEDIA_ROOT）配下に事前配置済み
      measurement_source: 事前問題ファイル（JSON 配列 QuestionIntakeRecord[]）
      durable_state: questions テーブル（text / image_path / video_path / correct_value）
      readback: ランタイム出題は questions テーブルから供給（ファイル再読込に依存しない）
      visible_to:
      - host
      expected_outcomes:
      - 各問が questions テーブルへ登録される
      - correct_value が 0〜100 の整数で保持される
      - image_path / video_path は任意（NULL 許容）で保持される
      - 検証エラーが 1 件でもあれば 1 問も登録されない（全 or 無）
      boundary_cases:
      - correct_value 0/100 は登録可
      - correct_value -1/101/50.5 は登録拒否
      - image_path/video_path 未指定 → NULL で登録可
      - 宣言された動画/画像パスに所定フォルダ配下の実体が無い → 当該入稿は拒否
      dod_obligations:
      - id: dod_load_persist
        text: 読み込んだ全問が questions に登録され、再取得で登録時と同一の text と correct_value を返す
      - id: dod_load_runtime_from_db
        text: 出題面の解決元は questions テーブルであり、問題ファイルの再読込に依存しない
      - id: dod_load_media_paths_optional
        text: image_path と video_path は未指定でも登録でき NULL として保持される
      - id: dod_load_correct_value_integer
        text: correct_value が 0〜100 の整数以外では登録が拒否される（入稿検証とサーバ検証と DB CHECK を含む）
      - id: dod_load_no_adhoc_entry
        text: 出題内容の初期入稿は事前ファイル読込のみで、当日その場で問題集をゼロから手入力する UI/API が存在しない
      - id: dod_load_media_prevalidated
        text: 宣言された image_path/video_path に所定フォルダ配下の実体が無い場合は問題番号を添えて入稿が拒否され questions
          に入らない
      - id: dod_load_all_or_nothing
        text: 検証エラーが 1 件でもある入稿では questions が 1 行も追加されない
      - id: dod_load_host_only
        text: 読込は role host のみ発動でき answerer からの読込コマンドは 401/403 で拒否される
    - id: op_submit_answer
      actor: answerer
      verb: submit
      target: answer
      trigger: タブレット入力画面で +1/-1/+10/-10 のステッパで 0〜100 の数値を作り「送信」を押下
      route: /tablet
      ui_pattern: stepper_plus_minus_then_submit
      forbidden_actors:
      - host
      - audience
      preconditions:
      - 参加確定済み（participants に自分のレコードが存在）
      - 当該問の rounds.stage が accepting（受付中）
      measurement_source: 解答者がステッパで作成した 0〜100 整数
      durable_state: answers（question_id + participant_id で一意・value は 0〜100 整数）
      readback: 送信後 submit_ack が当該解答者へ unicast され送信済み表示になる（再接続後の state_snapshot にも反映）
      from_state: accepting
      to_state: accepting
      visible_to:
      - answerer
      expected_outcomes:
      - 0〜100 整数の解答が answers に upsert される
      - 送信済み状態が当該解答者にのみ表示され他者・観客へは配信されない
      - 締切（answers_locked）後の submit_answer はサーバで拒否される
      boundary_cases:
      - 値 0 / 100 は送信可
      - 値 -1 / 101 / 50.5 は UI とサーバの双方で拒否
      - 締切後の送信 → サーバで拒否（既存の永続解答は保持）
      - ステッパはクランプにより 0 未満・100 超の値を作れない
      dod_obligations:
      - id: dod_submit_stepper_only
        text: 解答者の入力導線が +1/-1/+10/-10 と「送信」のみで構成され、締切・開示・モード切替・他者情報閲覧の操作要素が /tablet
          に存在しない
      - id: dod_submit_range_guard
        text: 送信値は 0〜100 整数のみ UI とサーバ双方で受理され -1/101/50.5 は answers に入らない
      - id: dod_submit_accepting_only
        text: 受付中のみ送信でき answers_locked 到達後の submit_answer はサーバで拒否される
      - id: dod_submit_upsert_once
        text: 同一 question_id + participant_id の解答が upsert され重複行を作らない
      - id: dod_submit_own_ack_only
        text: 送信後 submit_ack が当該解答者のみへ返り、他解答者・観客へ解答が配信されない
    - id: op_propagate_deadline
      actor: host
      verb: lock
      target: answerer_tablets
      trigger: 制御盤で「そこまで」を押下
      route: /control-panel
      forbidden_actors:
      - answerer
      - audience
      from_state: accepting
      to_state: answers_locked
      durable_state: game_state.stage = answers_locked
      consumer_surfaces:
      - answerer_tablets
      expected_outcomes:
      - answers_locked が接続中の全解答者タブレットへ配信され入力が同期ロックされる
      - 締切後のタブレットからの submit_answer はサーバで拒否される
      dod_obligations:
      - id: dod_deadline_host_only
        text: 締切コマンドは role host のみ発動でき answerer/audience からの締切コマンドは command_denied(403)
          で拒否される
      - id: dod_deadline_sync_lock
        text: 締切の配信で接続中の全解答者タブレットが締切表示へ同期し以後の送信が拒否される
    - id: op_propagate_disclosure
      actor: host
      verb: open
      target: tv_and_endpoints
      trigger: 制御盤で「解答オープン！」を押下
      route: /control-panel
      forbidden_actors:
      - answerer
      - audience
      from_state: answers_locked
      to_state: answers_opened
      durable_state: game_state.stage = answers_opened
      visible_to:
      - audience
      consumer_surfaces:
      - tv_mode_b
      expected_outcomes:
      - 開示前は他者の解答がどのロールの端末へも配信されない
      - 開示後 TV(b) へ全員の氏名と解答が一斉配信される
      dod_obligations:
      - id: dod_disclosure_hidden_before
        text: answers_opened 未配信の間は解答者・観客のいずれの端末へも他者の解答が配信されない
      - id: dod_disclosure_reveals_on_tv
        text: answers_opened の配信で TV(b) が全員の氏名と解答を表示する
    - id: op_reveal_answer
      actor: host
      verb: reveal
      target: tv_and_endpoints
      trigger: 制御盤で「正解発表」を押下
      route: /control-panel
      forbidden_actors:
      - answerer
      - audience
      from_state: answers_opened
      to_state: answer_revealed
      durable_state: game_state.stage = answer_revealed（rounds.stage）
      visible_to:
      - audience
      consumer_surfaces:
      - tv_mode_c
      measurement_source: 当該問 questions.correct_value
      expected_outcomes:
      - TV(c) に当該問の正解値が表示される
      - answer_revealed 到達で当該問が isDisclosed 真となり以後の正解ライブ編集が自動再採点対象になる
      boundary_cases:
      - answers_opened 未到達での reveal は不正遷移として拒否
      dod_obligations:
      - id: dod_reveal_host_only
        text: 正解発表は role host のみ発動でき answerer/audience からは command_denied(403) で拒否される
      - id: dod_reveal_marks_disclosed
        text: answer_revealed 到達で当該問が isDisclosed 真となり以後の correct_value 編集が再採点対象になる
      - id: dod_reveal_tv_c
        text: 正解発表の配信で TV(c) が当該問の正解値を表示する
    - id: op_compute_settlement
      actor: host
      verb: settle
      target: balances
      trigger: 制御盤で「精算」を押下し得点精算を実行
      route: /control-panel
      forbidden_actors:
      - answerer
      - audience
      from_state: answer_revealed
      to_state: settlement_computed
      measurement_source: answers.value と questions.correct_value
      durable_state: settlements（error / delta_yen / pitari_bonus_yen）＋ balances（円・整数）＋
        rounds.stage = settlement_computed
      consumer_surfaces:
      - tv_mode_d
      - tv_mode_e
      visible_to:
      - audience
      expected_outcomes:
      - 誤差 = 絶対値(answer - correct) が 0〜100 整数で settlements に記録される
      - 増減円 = 誤差 × -100（整数円）で delta_yen が記録され balances が更新される
      - 誤差 0 のピタリ賞 +1000 円が pitari_bonus_yen に記録され balances へ加算される
      - TV(d) に 6 列精算表（氏名/解答/誤差/増減円/ピタリ賞/残額）が円建てで表示される
      boundary_cases:
      - 誤差 0 は +1000（丁度）
      - 誤差 1 は -100 のみ（直上・不連続）
      dod_obligations:
      - id: dod_settle_delta
        text: 誤差 5 の精算後に当該プレイヤーの balances.amount が精算前より 500 円少ない
      - id: dod_settle_pitari_add
        text: 誤差 0 のプレイヤーの pitari_bonus_yen が +1000 で balances に反映される（拠出配分側は F-02
          未確定として fixme）
      - id: dod_settle_currency_yen
        text: settlements と balances と API 応答と d の 6 列表が円建てで表され point/pt/点 の語が存在しない
      - id: dod_settle_integer_only
        text: error / delta_yen / pitari_bonus_yen / amount がすべて整数で小数値を持たない
      - id: dod_settle_host_only
        text: 得点精算は role host のみ発動でき answerer からの精算コマンドは 401/403 で拒否される
    - id: op_propagate_mode_switch
      actor: host
      verb: switch
      target: tv_display
      trigger: 制御盤の「次へ」「戻る」または各モード個別ジャンプ
      route: /control-panel
      ui_pattern: next_back_jump
      forbidden_actors:
      - answerer
      - audience
      durable_state: game_state.tv_mode
      consumer_surfaces:
      - tv_mode_a
      - tv_mode_b
      - tv_mode_c
      - tv_mode_d
      - tv_mode_e
      expected_outcomes:
      - 3 系統いずれの操作でも tv_mode_changed が配信され接続中の TV が対応モードへ切り替わる
      dod_obligations:
      - id: dod_mode_switch_host_only
        text: モード切替は role host のみ発動でき answerer/audience からのモード切替は command_denied(403)
          で拒否される
      - id: dod_mode_switch_sync_tv
        text: 次へ・戻る・個別ジャンプの 3 系統いずれでも tv_mode_changed が配信され接続中の TV が対応モードへ切り替わる
    - id: op_switch_tv_mode
      actor: host
      verb: switch
      target: tv_mode
      trigger: 制御盤の「次へ」「戻る」または各モード個別ジャンプで a モードへ切替
      route: /control-panel
      ui_pattern: next_back_jump
      forbidden_actors:
      - answerer
      - audience
      measurement_source: questions.video_path / image_path / text（当該問）
      durable_state: game_state.tv_mode
      consumer_surfaces:
      - tv_mode_a
      expected_outcomes:
      - a モードは動画→画像→テキストの 3 段で出題面を解決する
      - メディアパスのライブ編集後は次の a モード描画に反映される
      boundary_cases:
      - 動画パス有 → 動画（画像有無に関わらず動画優先）
      - 動画無・画像有 → 画像
      - 双方無 → テキスト
      dod_obligations:
      - id: dod_tv_a_fallback
        text: a モードが video_path→image_path→text の優先順で出題面を解決する
      - id: dod_tv_a_reflects_live_edit
        text: メディアパスのライブ編集後に a モードを再描画すると解決される出題面が編集後の規定順に従う
      - id: dod_tv_a_no_path_leak
        text: a モードの表示に生のファイルパス文字列や fallback 等の内部語が露出しない
    - id: op_live_edit_correct
      actor: host
      verb: edit
      target: question_or_correct_value
      trigger: 制御盤のライブ編集 UI で問題文・正解値・画像/動画パスを更新
      route: /control-panel
      ui_pattern: inline_edit_then_save
      forbidden_actors:
      - answerer
      - audience
      preconditions:
      - 対象問が questions に存在する
      durable_state: questions テーブル更新（text / image_path / video_path / correct_value）
      readback: DB 再取得で編集後の値を返す
      visible_to:
      - host
      expected_outcomes:
      - 問題文・正解・メディアパスを進行中に編集でき questions に永続する
      - 画像/動画パスの編集は a モードの出題面解決に反映される
      - correct_value の編集かつ開示済み（c 以降）のときのみ自動再採点を誘発する
      boundary_cases:
      - text のみ編集 → 再採点は走らない
      - image_path/video_path のみ編集 → 再採点は走らない・a モード解決のみ変化
      - correct_value 編集かつ c 未到達 → 再採点は走らない
      - correct_value 編集かつ c 以降 → 再採点が走る
      dod_obligations:
      - id: dod_edit_persist
        text: 進行中に編集した問題文と正解値が questions に永続し再取得で読み戻せる
      - id: dod_edit_media_persist
        text: 進行中に編集した image_path/video_path が questions に永続し再取得で読み戻せる
      - id: dod_edit_media_face_follows
        text: 動画パスを付与/除去すると当該問の a モード出題面が規定順（video→image→text）で切り替わる
      - id: dod_edit_correct_range_guard
        text: 正解値の編集も 0〜100 整数のみ受理し範囲外はサーバと DB CHECK で拒否される
      - id: dod_edit_host_only
        text: ライブ編集は role host のみ発動でき answerer からの編集コマンドは 401/403 で拒否される
    - id: op_auto_rescore
      actor: system
      verb: rescore
      target: balances
      trigger: 開示済み（rounds.stage が answer_revealed 以降）の問題で司会者が correct_value をライブ編集
      preconditions:
      - 当該問の rounds.stage が answer_revealed 以降（isDisclosed 真）
      - ライブ編集の patch が correctValue を含む
      measurement_source: 編集後 questions.correct_value と既存 answers.value
      durable_state: settlements 再計算 ＋ balances 差分更新
      consumer_surfaces:
      - tv_mode_d
      - tv_mode_e
      from_state: answer_revealed
      to_state: answer_revealed
      expected_outcomes:
      - 正解訂正で当該問の全 settlements（誤差・delta_yen・pitari）が再計算される
      - balances が旧拠出との差分で更新される
      - rounds.stage が settlement_computed の問は TV d/e が同時更新される
      boundary_cases:
      - c 到達問の correct_value 訂正 → 再採点が走る
      - c 未到達（isDisclosed 偽）の correct_value 編集 → 再採点は走らない（境界外）
      - text/メディアのみ編集 → 再採点は走らない（correct_value 不変）
      dod_obligations:
      - id: dod_rescore_after_c
        text: rounds.stage が answer_revealed 以降で正解を直すと settlements と balances が再計算され各人の残額へ即時反映される
      - id: dod_rescore_no_before_c
        text: rounds.stage が answer_revealed 未満の正解編集では settlements と balances が変化しない
      - id: dod_rescore_only_on_correct_value
        text: text または image_path/video_path のみの編集では再採点が走らず balances が不変である
      - id: dod_rescore_d_sync
        text: rounds.stage が settlement_computed の問の正解訂正で balances 差分が再計算され TV の d
          と e が同時更新される
      - id: dod_rescore_matches_full_recompute
        text: 差分更新後の balances が answers と correct_value からの全再計算と一致する
    - id: op_undo
      actor: host
      verb: undo
      target: last_progression
      trigger: 制御盤で「取消」を押下
      route: /control-panel
      forbidden_actors:
      - answerer
      - audience
      durable_state: trigger_undone イベント（巻き戻し範囲は F-03 未確定・発明しない）
      consumer_surfaces:
      - control_panel
      - tv_display
      - answerer_tablets
      expected_outcomes:
      - trigger_undone が配信され直近の対象操作が取り消される
      - 発動権限は制御盤（host）のみで初版から存置される
      boundary_cases:
      - 巻き戻し範囲（直近のみ / 任意問題再開示 / d 到達問の残額差分巻き戻し）は F-03 未確定
      dod_obligations:
      - id: dod_undo_host_only
        text: 取消は role host のみ発動でき answerer/audience からは command_denied(403) で拒否される（巻き戻し挙動詳細は
          F-03/F028、E2E は test.fixme）
    - id: op_determine_winner
      actor: system
      verb: determine
      target: winner
      trigger: 10 問目の得点精算が完了
      preconditions:
      - 10 問すべての rounds.stage が settlement_computed
      measurement_source: 全問通算の balances.amount
      consumer_surfaces:
      - tv_mode_e
      from_state: settlement_computed
      to_state: game_finished
      durable_state: game_state.phase = finished
      expected_outcomes:
      - balances.amount 最多のプレイヤーが e モードで勝者として判別可能に表示される
      boundary_cases:
      - 残額同点は複数の共同首位を勝者として提示（同点優先順位は確定要件に無く発明しない・F-06）
      dod_obligations:
      - id: dod_winner_most_balance
        text: 10 問終了時に balances.amount 最多のプレイヤーが e モードで勝者として判別できる
    - id: op_broadcast_state_transition
      actor: system
      verb: broadcast
      target: connected_endpoints
      trigger: ドメインイベント（answers_locked/answers_opened/answer_revealed/settlement_computed/tv_mode_changed/balance_updated/participant_joined/trigger_undone）の確定
      measurement_source: game_state と balances の確定済み遷移
      durable_state: 各イベントに単調増加の seq を付与
      consumer_surfaces:
      - control_panel
      - tv_display
      - answerer_tablets
      readback: 遅参・再接続端末は state_snapshot で最新へ整合
      visible_to:
      - host
      - answerer
      - audience
      threshold: 状態遷移の全端末反映 p95 <= 2000ms（暫定ゲート・F-04）
      expected_outcomes:
      - 該当ロールの接続中全端末へロール投影済みイベントが配信される
      - 配信はロール投影を通し、可視範囲外の情報は当該ロールへ送られない
      dod_obligations:
      - id: dod_broadcast_all_role_endpoints
        text: 状態遷移イベントが当該ロールの接続中全端末へ配信される
      - id: dod_broadcast_role_projection
        text: 配信ペイロードはロール投影を経由し、解答者端末へ他者の解答・残額・得点が配信されない
      - id: dod_broadcast_latency_gate
        text: 状態遷移の全端末反映が p95 <= 2000ms を満たす
    - id: op_recover_on_reconnect
      actor: system
      verb: recover
      target: reconnecting_endpoint
      trigger: 回線断後の端末が再接続し（answerer は resume トークンを添えて）resume する
      route: /control-panel | /tv | /tablet
      measurement_source: サーバ権威の game_state（current_question_number/stage/tv_mode）と
        balances と answers
      durable_state: 端末側は状態を保持せずサーバ権威から再構成する
      readback: ロール投影済み state_snapshot を返し以後の live 配信へ合流させる
      expected_outcomes:
      - 再接続端末が現在問題番号・進行段階・TV モードへ復帰する
      - 解答者は自分の残額と送信済み状態へ復帰し他者情報は復帰対象外
      - 復帰値の権威はサーバの game_state と balances でありクライアント保存値に依存しない
      boundary_cases:
      - 制御盤が落ちても TV/タブレット間の配信はクラウド権威で継続する
      - 無効・失効トークンの再接続は新規参加として扱い上限判定を再度通す
      dod_obligations:
      - id: dod_reconnect_progression
        text: 再接続端末が現在問題番号・進行段階・TV モードへ復帰する
      - id: dod_reconnect_own_balance
        text: 再接続した解答者が自分の残額と送信済み状態へ復帰し、他者の解答・残額は復帰対象に含まれない
      - id: dod_reconnect_server_authority
        text: 復帰値がサーバの game_state と balances から供給され、クライアント保存値に依存しない
      - id: dod_reconnect_control_panel_resilient
        text: 制御盤の切断中も TV とタブレットの同期がクラウド権威経由で継続する
    - id: op_preserve_answer_across_reconnect
      actor: system
      verb: preserve
      target: answer
      trigger: 受付中に送信済みの解答を持つ端末が切断・再接続する
      measurement_source: answers テーブル（question_id + participant_id の一意キー）
      preconditions:
      - 当該問の game_state.stage が accepting のとき submit は upsert される
      durable_state: answers（question_id + participant_id で一意）
      readback: 再接続後の state_snapshot が送信済み状態を反映する
      from_state: accepting
      to_state: accepting
      expected_outcomes:
      - 受付中に永続した解答が切断・再接続を跨いで保持される
      - 再接続後の再送で同一問・同一参加者の解答が重複永続化されない
      boundary_cases:
      - ack 前切断で resume 再送 → upsert により重複なく保持
      - 締切後の resume 再送 → 拒否されるが既存の永続解答は保持
      dod_obligations:
      - id: dod_answer_preserved_across_reconnect
        text: 受付中に送信済みの解答が接続断・再接続後も answers に保持され送信済み表示へ復帰する
      - id: dod_answer_no_duplicate
        text: 再接続後の再送で同一 question_id + participant_id の解答行が重複せず一意に保たれる
---

# 運用挙動モデル設計（Operational Behavior Model：actor/action/state/outcome＋操作到達導線）

## 1. Overview

本書は `save-money-switcher`（クラウド WEB アプリ版『賞金先渡しクイズ SAVE MONEY』を家族で遊ぶ操作盤）の **運用挙動モデル（Operational Behavior Model, OBM）** であり、四つの兄弟設計 —— `design:scoring-engine-design`（採点）・`design:participation-connection-design`（参加・接続上限）・`design:question-media-intake-design`（入稿・メディア・ライブ編集）・`design:realtime-sync-design`（WebSocket 同期）—— を技術的真実源として統合し、**アクター（actor）／操作（action）／状態（state）／結果（outcome）＋各操作の到達導線（reachability）** を実装計画・E2E 生成に先立って設計時に確定する権威的出典である。ここに記す確定値・不変条件・到達導線に反する成果物は **リリース不可（release-blocking）** として扱う。

本書は E2E シナリオ集ではない。E2E テストは本書の設計時 operation model から後段で生成される **証跡** に過ぎず、`### Operational Behavior Model` の単一 YAML（`operation_flow:`）を CoDD がメタデータへ lift して、実装フェーズと E2E 生成フェーズが同一の真実源を共有する。

### 1.1 位置づけと責務

本書が権威をもって統合・確定するのは次の 5 点である。

1. **操作到達導線（§2.1）** — どのアクターがどのサーフェスの可視トリガーから各操作に到達できるか。司会者操作は制御盤（`/control-panel`）の可視トリガーからのみ、解答者操作は QR 参加→氏名入力→入力画面からのみ、観客は受動のみ。
2. **進行状態ライフサイクルと TV 5 モード（§2.2）** — 受付中→締切→b 開示→c 正解発表→d 精算→e 一覧の遷移と、各操作の actor/action/outcome。
3. **権限境界（§2.4）** — 締切・開示・正解発表・精算・モード切替・取消の発火は `role: host` のみ。副司会・解答者端末・API 直叩きは不可。
4. **採点 outcome の確定値（§2.5）** — 減算・ピタリ賞・残額更新・自動再採点を確定値どおりに定義し、E2E へ先送りしない。
5. **再採点誘発条件の契約（§2.6）** — 正解ライブ編集 × 開示済み（c 以降）を、実装が省略できない機械可検の契約にする。

物理 DB スキーマ・スコア計算式の内部実装・WS トランスポート機構・QR/氏名検証の内部実装は各兄弟設計が所有し、本書はそれらの **運用挙動（誰が・何を・どの状態から・どの結果へ・どの導線で）** の統合ビューと release-blocking な `dod_obligations` を所有する。

### 1.2 リリースブロッキング規約と本書での具体化

| # | 対象 | 不変条件（要旨） | 本書での具体化箇所 |
|---|---|---|---|
| OBM-1 | `module:control_panel` / `role:host` | 締切（そこまで）・開示（解答オープン）・正解発表・精算・モード切替（次へ/戻る/個別ジャンプ）・取消は司会者（制御盤）のみが発動でき、各操作の到達導線（制御盤上の可視トリガー）を定義。副司会・解答者端末・API 直叩き不可（論点7・N-3） | §2.1・§2.4・OBM の host 操作（`forbidden_actors: [answerer, audience]`） |
| OBM-2 | `role:answerer` / `module:tablet` | 解答者アクションは回答入力（+1/−1/+10/−10）と送信のみ。締切・開示・他者情報閲覧は禁止。到達導線は QR 参加→氏名入力→入力画面に限定（第三要件・N-1） | §2.1・§2.3・OBM `op_submit_answer` |
| OBM-3 | `module:game_flow` | 進行状態（受付中→締切→b→c→d→e）と各問の到達モード（b/c/d）を actor/action/outcome として定義し、再採点誘発条件を実装が省略できない契約にする（E-3残） | §2.2・§2.6・OBM `op_reveal_answer`／`op_auto_rescore` |
| OBM-4 | `module:scoring` | 各アクションの outcome（減算・ピタリ賞横取り・残額更新・自動再採点）を確定値どおりに定義し、E2E テストへ先送りしない（A〜D・E-3残） | §2.5・§2.6・OBM `op_compute_settlement`／`op_auto_rescore` |

上位から継承する不変条件も本書で統合担保する: **ホスト PC をサーバにしない**（WS 待受はクラウド権威のみ・§2.8）、**0〜100 整数の多層防衛**（UI＋サーバ＋DB `CHECK`・§2.5）、**円建て固定**（`point`/`pt`/`点` 禁止・§2.3/§2.5）、**家族限定アクセス制御**（無制御公開不可・§2.4/§2.8）、**接続上限の外出し**（既定 8・設定 16/32 追随・§2.8）、**プライバシー**（自己入力氏名のみ・恒久台帳なし・他者情報を解答者へ投影しない・§2.7）。

### 1.3 実装・ツールチェーン前提（scaffold 固定・釈義不可）

- **実装言語 = TypeScript のみ。** 本書のファイルパス（`src/game_state/*.ts` 等）・ドメイン型・モジュール構成・依存管理・ツールチェーン参照はすべて TypeScript 慣行のみを用い、他言語の拡張子・マニフェスト・ツールは例示・フォールバックとしても登場させない。
- **テストランナー = Vitest（固定・release-blocking のグラウンドトゥルース）。** 本書の全テスト例は Vitest 自身の宣言 API（`import { describe, it, expect } from "vitest";`）で記述する。「ランタイム依存を最小化する」方針は **出荷コードのランタイム依存**（`ws`／`qrcode` 等）にのみ及び、テストランナーには及ばない。依存数の哲学を根拠に別フレームワークや Node 組み込み `node:test` を用いてはならない。verify が実際に走らせるのは Vitest である。ブラウザ検証は Playwright を **ライブラリ import**（`import { chromium } from "playwright";`）で駆動し、宣言・検証は Vitest で行う。
- **モジュール解決 = NodeNext/Node16。** すべての相対 import は **出力される `.js` ファイル名を明示した拡張子** を伴う（`import { isDisclosed } from "./progression.js";`。`"./progression"`・`"./progression.ts"` は不可）。default/namespace import・re-export（`export { stageToTvMode } from "./tv_mode.js";`）・type-only import（`import type { Stage } from "./progression.js";`）も同一規約。拡張子欠落は TS2835 でコンパイル不能。
- **レイアウト契約（output-path fence 強制）。** ソースは **必ず `src/` 配下**（進行段階・TV モード判定は `src/game_state/`）、テストは **必ず `tests/` 配下**（`test/`・`spec/`・`specs/` を発明しない。サブディレクトリ `tests/game_state/` 等は可）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness scaffold 所有につき、本書はこれらを成果物として出力・宣言しない。

### 1.4 アクター・ロール・サーフェス対応（可視ラベル）

内部ロール識別子 → 可視ラベルの対応を全サーフェス共通で固定し、可視コピーには **可視ラベル** のみを用いる（内部識別子・内部イベント名・設定キー名・実装根拠・環境前提を露出させない）。

| 内部識別子 | 可視ラベル | 主サーフェス | 役割 |
|---|---|---|---|
| `role: host` | **司会者** | `/control-panel` | 進行制御・入稿・ライブ編集・QR 提示（当該境界の管理者） |
| `role: answerer` | **解答者** | `/join`→`/tablet` | 参加・数値入力・送信（入力専用） |
| （TV 視聴者） | **観客** | `/tv` | 受動表示（a〜e）のみ |
| `system` | （非可視） | クラウド権威 | WS 権威・採点・配信・整合復帰 |

金額は全経路で **円**。`point`／`pt`／`点` は型・スキーマ・派生・可視コピーのいずれにも持たせない。

---

## 2. Architecture

### 2.1 操作到達導線（Reachability・OBM-1／OBM-2）

**到達導線 = 各操作へ至る可視トリガーの経路**を、アクターごとに閉じた集合として固定する。導線外からの発動（副司会ロールの発明・解答者端末からの司会操作・API 直叩き）は成立させない。

**司会者（`/control-panel` の可視トリガーのみ・OBM-1）**

| 可視トリガー（制御盤） | 操作 | 状態遷移／効果 |
|---|---|---|
| 「問題ファイルを読み込む」 | `op_load_questions` | JSON 入稿→`questions` 登録（全 or 無） |
| 参加用 QR（面に表示） | `op_display_join_qr` | `/join` 公開 URL を符号化した QR 提示 |
| 「そこまで」 | `op_propagate_deadline`（lock） | `accepting → answers_locked` |
| 「解答オープン！」 | `op_propagate_disclosure`（open） | `answers_locked → answers_opened`（TV b） |
| 「正解発表」 | `op_reveal_answer`（reveal） | `answers_opened → answer_revealed`（TV c・isDisclosed 真） |
| 「精算」 | `op_compute_settlement`（settle） | `answer_revealed → settlement_computed`（TV d/e） |
| 「次へ」「戻る」「個別ジャンプ」 | `op_propagate_mode_switch`／`op_switch_tv_mode` | `game_state.tv_mode` を a〜e へ |
| 各問のインライン編集（問題文/正解/画像/動画） | `op_live_edit_correct` | `questions` 更新・開示済みなら再採点 |
| 「取消」 | `op_undo` | `trigger_undone`（巻き戻し範囲は F-03） |

**OBM-1 遵守の言明**: 上記トリガーはすべて `/control-panel`（`role: host` セッション）にのみ存在し、各 host 操作は `forbidden_actors: [answerer, audience]` を持つ。サーバは非 host からの当該コマンドを接続断せず `command_denied`（**403**／未認証 **401**）で拒否する。副司会という別ロールは発明せず、解答者端末・観客端末に当該操作要素を置かず、API 直叩きも `role: host` 判定の単一経路で弾く。

**解答者（QR 参加→氏名入力→入力画面のみ・OBM-2）**

```
QR 読取り → /join（家族限定アクセス通過）→ 氏名を自己入力 → 「参加する」
        → /tablet 入力画面：[ −10 ][ −1 ][ +1 ][ +10 ] で 0〜100 を作り [ 送信 ]
```

**OBM-2 遵守の言明**: 解答者の到達可能な操作は `op_submit_answer`（＋その前段の `op_join_game`）のみ。`/tablet` は入力専用最小 UI とし、締切・開示・モード切替・他者情報閲覧の操作要素・ナビを一切置かない。数値は `+1/−1/+10/−10` のステッパで 0〜100 に **クランプ** して作り、「送信」で確定する。これを `dod_submit_stepper_only` で機械可検化する。

**観客（受動のみ）**: `/tv` はいかなる入力・操作要素も持たず、配信された TV モード（a〜e）を表示するだけ。到達可能なコマンドは無い。

### 2.2 進行状態ライフサイクルと TV 5 モード（OBM-3）

ゲームフェーズ `game_state.phase`: `lobby`（受付前）→ `in_progress` → `finished`。各問のラウンド段階 `rounds.stage` と TV 5 モードを actor/action/outcome として固定する。

| rounds.stage | 到達させる host 操作 | 対応 TV モード | outcome（確定） |
|---|---|---|---|
| `accepting`（受付中） | 「次へ」で当該問へ（`op_switch_tv_mode`＝a） | **a**（出題面） | 出題面を **動画→画像→テキスト** の 3 段で解決。解答者は入力受付。 |
| `answers_locked`（締切） | 「そこまで」（`op_propagate_deadline`） | a（締切表示） | 全解答者タブレットが同期ロック・以後 `submit_answer` 拒否。 |
| `answers_opened`（**b** 開示） | 「解答オープン！」（`op_propagate_disclosure`） | **b** | 開示前は他者解答を全ロールへ非配信。開示で TV b に全員の氏名＋解答を一斉表示。 |
| `answer_revealed`（**c** 正解発表） | 「正解発表」（`op_reveal_answer`） | **c** | TV c に正解値。**isDisclosed 真**となり以後の正解編集が再採点対象（§2.6）。 |
| `settlement_computed`（**d** 精算） | 「精算」（`op_compute_settlement`） | **d** | TV d に 6 列精算表（氏名/解答/誤差/増減円/ピタリ賞/残額）。残額更新・**isSettled 真**。 |
| （全問通算） | 「次へ／個別ジャンプ」で e | **e** | 全問通算残額の全員一覧。10 問精算完了で **残額最多**を勝者判別。 |

各問の到達モードは **b/c/d**（開示・正解・精算）が本質で、a は出題提示、e は通算である。段階遷移（`stage`）と TV モード（`tv_mode`）は host 操作で駆動され、`system` が確定遷移を全端末へロール投影配信する（§2.8）。

判定関数と 5 モード対応を `src/game_state/` に単一化する（再採点範囲判定・§2.6 と共有）。

```typescript
// src/game_state/progression.ts
export type Stage =
  | "accepting"
  | "answers_locked"
  | "answers_opened"       // b
  | "answer_revealed"      // c
  | "settlement_computed"; // d

const DISCLOSED: readonly Stage[] = ["answer_revealed", "settlement_computed"];

export function isDisclosed(stage: Stage): boolean {
  return DISCLOSED.includes(stage);
}
export function isSettled(stage: Stage): boolean {
  return stage === "settlement_computed";
}
```

```typescript
// src/game_state/tv_mode.ts
import type { Stage } from "./progression.js";

export type TvMode = "a" | "b" | "c" | "d" | "e";

// 段階の既定 TV モード（e は通算閲覧としてモード切替で別途到達）
export function stageToTvMode(stage: Stage): Exclude<TvMode, "e"> {
  switch (stage) {
    case "accepting":
    case "answers_locked":
      return "a";
    case "answers_opened":
      return "b";
    case "answer_revealed":
      return "c";
    case "settlement_computed":
      return "d";
  }
}
```

### 2.3 アクター向けサーフェス／コピー義務

各サーフェスの目的・許可/禁止アクション・可視コピー意図・禁止コピーを固定する。可視コピーは監査対象アクターの job-to-be-done 言語に限り、実装根拠・内部処理名・環境前提・テスト/デモ/サンプル表記を露出させない。

| サーフェス | ルート | 主対象 | 目的 | 許可アクション／ナビ | 禁止アクション／ナビ | 必須の可視コピー意図 | 禁止コピー |
|---|---|---|---|---|---|---|---|
| 制御盤 | `/control-panel` | 司会者 | 進行制御・入稿・編集・QR 提示・接続把握 | §2.1 の全トリガー・参加者一覧・「◯/◯台」把握 | 解答者入力面の露出 | 「問題を読み込む」「そこまで」「解答オープン！」「正解発表」「精算」「次へ/戻る」等の司会者向け操作語 | 内部 role 識別子・内部イベント名（`answers_locked` 等）・設定キー名・`point`/`pt`/`点`・テスト/デモ表記 |
| 参加受付 | `/join` | 解答者 | QR 経由の参加・氏名自己入力 | 氏名入力・「参加する」 | 事前氏名台帳/端末番号割当・保護された制御盤ナビ・他者情報閲覧 | 「お名前を入力してください」「参加する」。満席時「ただいま満席のため参加できません」 | 保護ナビの露出・設定キー名・接続数会計・role 識別子・`point`/`pt`/`点` |
| タブレット | `/tablet` | 解答者 | 入力専用最小 UI | `−10/−1/+1/+10` と「送信」・自分の残額（円）・受付中/締切/送信済み表示 | 締切/開示/モード切替、他者の解答/残額/得点、出題内容の埋め込み、全体一覧 | 問題番号・数値入力・「送信済み」・「あなたの残額 ◯◯円」・「受付中」「締切」 | 他者情報・司会者操作語・内部イベント名・`point`/`pt`/`点` |
| TV | `/tv` | 観客 | 配信モード（a〜e）の受動表示 | 表示のみ | いかなる入力・操作要素、生パス文字列、fallback 等の内部語 | a 出題面／b 氏名＋解答／c 正解値／d 6 列表（円）／e 全問通算＋勝者判別 | 内部語（`fallback`/`video_path`）・生ファイルパス・接続/復帰デバッグ・`point`/`pt`/`点` |

**エントリ／事前認証面の言明**: `/join` および分岐 B（認証）未認証時の到達点は、アクセス状態に整合しない保護ナビ（制御盤操作等）を露出しない。分岐 B 導入時は「ログイン → 正しいリダイレクト → `/join` 氏名入力描画」のフローを備える。上限拒否・アクセス拒否コピーは job-to-be-done 言語に限り、内部会計・設定キー・アクセス制御方式を露出しない。

### 2.4 権限境界（OBM-1 の中核）

- **host-only 進行トリガー**: `lock/open/reveal/settle/switch_mode/undo`（およびメディア入稿 `load`・ライブ編集 `live_edit`）は `role: host` セッションのみ。サーバは接続時に確定したロール属性を **単一判定点** として検査し、非 host コマンドを `command_denied`（403／未認証 401）で拒否する。UI にも該当操作要素を非 host サーフェスへ置かない。
- **answerer 制限（OBM-2）**: 解答者は `submit_answer`（＋ `join`）のみ。締切・開示・正解発表・精算・モード切替・取消のいずれも発火できず、他者の解答・残額・得点・出題内容・全体一覧を受信しない。
- **audience 制限**: 観客はいかなるコマンドも発火できない（受動表示のみ）。
- **家族限定アクセス制御**: 参加ベクタ（公開 `/join`）は分岐 A（URL 秘匿トークン `JOIN_ACCESS_TOKEN`）／分岐 B（認証 `JOIN_ACCESS_MODE=authenticated`）のいずれかで抑制し、**未構成なら参加を許可しない**（`checkJoinAccess` が `granted: false`）。無認証の無制限公開は構成上も実行時も成立させずリリース不可。いずれの分岐でも受入は `src/config` の上限解決点と `role` 判定の単一経路を経由する。

### 2.5 採点 outcome の確定値（OBM-4・E2E へ先送りしない）

各アクションの結果を、要件裁可（案 A・SAVE MONEY 準拠・個人戦）の確定値どおりに **設計時に**固定する。

| 規則 | 確定値 | 計算 | 境界 |
|---|---|---|---|
| 賞金先渡し | 10,000 円 | 参加確定で `balances.amount = 10000` | 全員一律 |
| 誤差 | 0〜100 整数 | `error = |answer − correct|` | 0=丁度／100=最大 |
| 誤差減算 | 誤差 1 につき −100 円 | `delta_yen = error × −100` | 誤差 1 → −100 のみ |
| ピタリ賞（加算側） | 誤差 0 で +1,000 円 | `pitari_bonus_yen = (error===0) ? +1000 : 0` | 誤差 0 → +1000 |
| ゲーム長 | 10 問 | `QUESTION_COUNT = 10` | 10 問全て `settlement_computed` で終了 |
| 勝敗 | 残額最多勝ち | `max(balances.amount)` | 同点は共同首位（F-06） |

- **1 問あたり残額増減** = `delta_yen + pitari_bonus_yen`。誤差 0 のみ純増（+1000）、誤差 1 以上は純減。誤差 0 と誤差 1 の間に **不連続**（+1000 と −100）があることを境界として明示する。
- **ピタリ賞「横取り」の確定/保留分離**: 誤差 0 プレイヤーへの **加算側 +1,000 円は確定・実装必須**。「他プレイヤーから 1,000 円獲得」の **拠出（減算）側と配分**（総額 1,000 か各人からか、複数同時ピタリの扱い）は **F-02 未確定**につき発明せず、現段階は拠出減算を 0 とし加算側のみ反映する（確定後に `settlements` へ負の拠出行を追加する拡張余地を残す・§3.2）。
- **整数円のみ**: `error / delta_yen / pitari_bonus_yen / amount` はすべて整数円で、小数値を持たない（実行時アサート＋DB `integer`/`CHECK`）。
- **0〜100 の多層防衛**: 入稿検証（`isAnswerScore`）・UI（`/tablet`）・サーバ（`src/scoring/validate_answer.ts`）・DB `CHECK(0<=x<=100)` の各層で 0=可／100=可／−1・101・50.5=不可を固定する。
- **円建て固定**: `settlements`・`balances`・API 応答・TV d の 6 列表・TV e の通算・タブレット自残額表示はすべて **円**。`point`/`pt`/`点` を一切持たせない。

**OBM-4 遵守の言明**: 上記 outcome を本 OBM の `op_compute_settlement`／`op_auto_rescore` の `expected_outcomes` と `dod_obligations`（`dod_settle_delta`／`dod_settle_pitari_add`／`dod_settle_currency_yen`／`dod_settle_integer_only` 等）に確定値で刻み、E2E 生成へ先送りしない。

### 2.6 再採点誘発条件の契約（OBM-3／OBM-4・E-3残）

自動再採点は、実装が省略できない **2 条件の論理積** として契約化する。

> **再採点が走る ⇔（ライブ編集の patch に `correct_value` が含まれる）∧（当該問 `isDisclosed(rounds.stage)` が真＝c 以降）**

- **走る**: c 到達問（`answer_revealed` 以降）の正解訂正 → 当該問の全 `settlements`（誤差・`delta_yen`・`pitari_bonus_yen`）を再計算し、`balances` を **旧拠出との差分**で更新。`isSettled`（d 到達）問は **TV d（当該問精算表）と e（全員通算）を同時更新**。
- **走らない（境界外）**: c 未到達（`isDisclosed` 偽）の正解編集／`text`・画像・動画パスのみの編集（`correct_value` 不変）→ `settlements`・`balances` は不変。
- **監査不変式**: 差分更新後の `balances` は `answers` ＋ 編集後 `correct_value` からの全再計算（`aggregateBalance`）と **一致**する。差分更新は最適化であり、正しさの基準は全再計算。

**OBM-3 遵守の言明**: 再採点誘発条件を `op_reveal_answer`（isDisclosed を真にする public trigger）と `op_auto_rescore`（走る/走らないの境界・全再計算一致）の `dod_obligations`（`dod_rescore_after_c`／`dod_rescore_no_before_c`／`dod_rescore_only_on_correct_value`／`dod_rescore_d_sync`／`dod_rescore_matches_full_recompute`）に固定し、実装が省略できない機械可検の契約とする。

### 2.7 派生状態・読みモデル連鎖・クロスアクター可視性

**単一方向の派生連鎖（producer → durable → derived → consumer）を統合する。**

1. **参加連鎖**: 自己入力氏名（producer）→ `participants`＋`balances=10000`（durable）→ 制御盤参加者一覧／TV e（consumer）。
2. **解答連鎖**: `+1/−1/+10/−10` 入力（producer）→ `answers`（`question_id+participant_id` 一意 upsert・durable）→ 送信済み表示（自分）／開示後 TV b（consumer）。
3. **出題面解決連鎖**: `questions.video_path/image_path/text`（durable）→ `resolveQuestionFace`（derived・純関数）→ TV a（consumer）。順序厳守 `video→image→text`。
4. **正解訂正 → 再採点連鎖**: `questions.correct_value`（durable）→ `settlements`（derived）→ `balances.amount`（集計 read-model）→ TV d/e（consumer）。`isDisclosed` 真のみ起動（§2.6）。
5. **勝敗連鎖**: 全問 `balances.amount`（read-model）→ 残額最多判定 → TV e 勝者判別。

**クロスアクター可視性（プライバシー・トランスポート層強制）**:

| ロール | 受信する状態 | 受信しない状態 |
|---|---|---|
| host | 全進行状態・参加者一覧・全員の解答/残額・接続数と上限 | — |
| audience | 現 `tv_mode` に応じた表示（b 以降のみ氏名＋解答、d/e で円建て残額表） | 開示前（b 未実行）の他者解答 |
| answerer | 現在問題番号・受付中/締切状態・自分の `submit_ack`・**自分の残額（円）のみ** | **他者の解答・残額・得点、出題内容、全体一覧**（一切投影しない） |

配信は必ずロール投影（`projectForRole`）を経由し、可視範囲外フィールドをペイロードから除去する。解答者端末へ他者情報を渡さないことを構造的に保証する。

### 2.8 接続・同期・再接続整合

- **クラウド WS 権威（ホスト PC をサーバにしない）**: WebSocket 待受はクラウドサーバ（`src/realtime_sync/server.ts`）にのみ存在し、制御盤・TV・タブレットのブラウザはクライアント接続に過ぎない。`localhost` 待受・ホスト PC の AP 化・LAN 完結はリリース不可。制御盤が落ちても TV/タブレット間の同期はクラウド権威で継続する。
- **状態配信**: host コマンド適用または system 主導イベントで確定した遷移を、`hub` が単調増加 `seq` 付きドメインイベントとして生成し、ロール投影して該当ロール全端末へ push。反映ゲート **p95 ≤ 2,000ms**（F-04 暫定）。
- **接続上限（外出し）**: `MAX_TABLET_CONNECTIONS` を `src/config/connection_limit.ts` の単一解決点（`resolveMaxTabletConnections()`）から取得。既定 **8** は同ファイルの単一定数のみで宣言し、判定コードに数値リテラル 8 を撒かない。上限は answerer 接続のみに課し、host/audience は別チャネル。上限超過は `connection_rejected`＋WS `close(4001)` で断り、既存接続・`participants`・`answers`・`balances` は不変。設定 16/32 へコード改修なしに追随。
- **再接続整合**: `heartbeat`（ping 15 秒／pong 猶予 30 秒）で切断確定、answerer スロット解放。再接続は `resume`（answerer は不透明 resume トークン）で、`recovery.buildSnapshot` がサーバ権威 `game_state`／`balances`／`answers` からロール投影済み `state_snapshot` を unicast。解答者は現在問題番号・進行段階・TV モード・自分の残額・送信済み状態へ復帰し、他者情報は復帰対象外。受付中の解答は一意 upsert で切断・再接続を跨いで保持され重複行を作らない。無効・失効トークンは新規参加として上限判定を再通過。

### 2.9 非機能・SLA・整合ゲート

- **健全性ベースライン**: 全 HTTP 応答は **`< 500`**（5xx を業務ステータスとして見逃さない）。上限拒否・アクセス拒否・締切後送信・非 host コマンドは 5xx ではなく業務ステータス（平易文／`connection_rejected`／`command_denied`）で表す。
- **同期反映**: 状態遷移の全端末反映 **p95 ≤ 2,000ms**（F-04 暫定ゲート）。入稿（10 問）**p95 ≤ 1,000ms**。
- **接続数**: 既定 8、設定で 16／32 まで。
- **起動シーケンス（検証環境）**: `npm ci` → `npm run build` → `npm run start`（クラウド WEB アプリ＋WebSocket ゆえサーバ常駐必須）。`/healthz`（または ベース URL）が `< 500` を返すまで **最大 60 秒**ポーリングしてから試験開始。`E2E_BASE_URL`（WS 昇格可能オリジン）・`PUBLIC_BASE_URL`・`MAX_TABLET_CONNECTIONS`・アクセス制御設定を検証環境値で注入。

### 2.10 実装配置・モジュール指定子・テスト戦略

- **格納先**: 進行段階・TV モード判定 `src/game_state/`（`progression.ts`・`tv_mode.ts`）。採点 `src/scoring/`、参加 `src/participants/`、入稿・メディア `src/questions/`・`src/media/`、同期 `src/realtime_sync/`、設定 `src/config/` は各兄弟設計の割当に従う。
- **モジュール指定子**: 全相対 import は `.js` 拡張子明示。type-only import・re-export も同一。
- **テスト**: ユニットは `tests/game_state/*.test.ts` 等。E2E は API/WS 統合 `tests/e2e/*.spec.ts`、ブラウザ `tests/e2e/*.browser.spec.ts`（Playwright を import 駆動・宣言/検証は Vitest）、共有ヘルパは `tests/e2e/helpers/`（`.js` 参照）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness 所有につき著さない。Vitest 以外（`node:test` 等）をランナーに用いない。

```typescript
// tests/game_state/tv_mode.test.ts
import { describe, it, expect } from "vitest";
import { stageToTvMode } from "../../src/game_state/tv_mode.js";
import { isDisclosed, isSettled } from "../../src/game_state/progression.js";

describe("進行段階と TV モード対応（OBM-3）", () => {
  it("受付中/締切は a、開示は b、正解発表は c、精算は d", () => {
    expect(stageToTvMode("accepting")).toBe("a");
    expect(stageToTvMode("answers_locked")).toBe("a");
    expect(stageToTvMode("answers_opened")).toBe("b");
    expect(stageToTvMode("answer_revealed")).toBe("c");
    expect(stageToTvMode("settlement_computed")).toBe("d");
  });
  it("再採点範囲：c 到達で isDisclosed 真、d 到達のみ isSettled 真", () => {
    expect(isDisclosed("answers_opened")).toBe(false);
    expect(isDisclosed("answer_revealed")).toBe(true);
    expect(isSettled("answer_revealed")).toBe(false);
    expect(isSettled("settlement_computed")).toBe(true);
  });
});
```

**MECE 運用義務の網羅（実装前に列挙）**: 本 OBM は各操作を次の 7 軸で網羅する — happy path（`op_join_game`／`op_submit_answer`／`op_compute_settlement`）、persistence/readback（`dod_load_persist`／`dod_edit_persist`／`dod_answer_preserved_across_reconnect`）、permission boundary（`dod_*_host_only`／`op_submit_answer` の解答者限定）、terminal-state guard（`dod_deadline_sync_lock` の締切後送信拒否／c 未到達の再採点非誘発）、cross-actor reflection（`dod_join_reflected`／`dod_disclosure_reveals_on_tv`／`dod_broadcast_role_projection`）、derived-state/read-model chain（`dod_tv_a_fallback`／`dod_rescore_matches_full_recompute`／`dod_winner_most_balance`）、threshold/boundary（`dod_limit_default_eight`／`dod_submit_range_guard`／`dod_broadcast_latency_gate`）。

### Operational Behavior Model

以下の単一 YAML ブロックが、本システム全体の運用挙動の権威的出典であり、実装計画と E2E 生成が共有する。兄弟設計の `operation_flow` と ID を一致させ（`op_join_game`／`op_enforce_connection_limit`／`op_compute_settlement`／`op_auto_rescore` 等の安定 ID と `dod_*` を再用）、本統合固有の `op_submit_answer`（解答者導線・OBM-2）・`op_reveal_answer`（c 到達・OBM-3）・`op_undo`（取消・OBM-1）を追加する。未確定は `boundary_cases` または §3 のフラグへ回し、発明しない。

```yaml
operation_flow:
  actors:
    - id: host
      label: 司会者（制御盤）
      surface: /control-panel
    - id: answerer
      label: 解答者（タブレット）
      surface: /tablet
    - id: audience
      label: 観客（TV）
      surface: /tv
    - id: system
      label: クラウドサーバ（realtime_sync 権威 / scoring / participants）
  operations:
    - id: op_display_join_qr
      actor: host
      verb: display
      target: join_qr
      trigger: 司会者が制御盤を開くと参加用 QR が表示される
      route: /control-panel
      ui_pattern: qr_display
      preconditions:
        - PUBLIC_BASE_URL が設定済み
      measurement_source: resolvePublicBaseUrl() と（分岐A時）JOIN_ACCESS_TOKEN
      readback: QR 読取りでクラウド公開の /join へ到達する
      visible_to: [host]
      forbidden_actors: [answerer, audience]
      expected_outcomes:
        - 制御盤に /join 公開 URL を符号化した QR が表示される
        - QR 提示面に事前氏名台帳・端末番号割当の入力要素が存在しない
      dod_obligations:
        - id: dod_qr_encodes_public_join_url
          text: 制御盤に表示される QR がクラウド公開の /join URL を符号化し、読取りで /join へ到達する
        - id: dod_qr_no_seat_ledger
          text: QR 提示面に事前氏名台帳・端末番号割当の入力要素が存在しない
    - id: op_guard_family_access
      actor: system
      verb: guard
      target: join_access
      trigger: 解答者が /join へ到達し参加確定を試行
      route: /join
      measurement_source: 提示トークン（分岐A）またはセッション認証状態（分岐B）と src/config のアクセス制御設定
      preconditions:
        - 参加アクセス制御が URL 秘匿トークンまたは認証のいずれかで構成されている
      durable_state: なし（アクセス判定は設定と提示情報から導出）
      consumer_surfaces: [join_page]
      expected_outcomes:
        - 分岐A では秘匿トークン一致のときのみ /join 参加が許可される
        - 分岐B では認証済のときのみ許可され、ログイン→リダイレクト→描画のフローを備える
        - どちらの制御も未構成なら参加を許可しない（無制御公開は成立しない）
        - 受入は src/config の上限解決点と role 判定を必ず経由する
      boundary_cases:
        - アクセス制御未構成 → 参加不可（無認証の無制限公開はリリース不可構成）
        - 分岐A トークン不一致 → 参加不可
        - 分岐B 未認証 → /join は保護ナビを露出せずログインへ誘導
      dod_obligations:
        - id: dod_access_no_open_public
          text: URL 秘匿トークンも認証も未構成の場合に /join の参加確定が許可されず、無制御公開が構成上も実行上も成立しない
        - id: dod_access_single_resolution
          text: 分岐 A/B いずれでも参加受入が src/config の上限解決点と role 判定の単一経路を経由する
        - id: dod_access_no_protected_nav
          text: 未認証・未参加の /join に制御盤操作等の保護ナビが露出しない
    - id: op_establish_connection
      actor: system
      verb: accept
      target: websocket_session
      trigger: 端末が公開 URL をブラウザで開き WebSocket 接続してロールを申告する
      route: /control-panel | /tv | /tablet | /join
      preconditions:
        - WebSocket 待受はクラウドサーバのみに存在する
      measurement_source: 接続時のロール申告と（answerer は）resume トークン
      durable_state: hub のロール別接続レジストリ（host/answerer/audience）
      readback: 接続直後にロール投影済み state_snapshot を unicast で返す
      expected_outcomes:
        - セッションにロール（host/answerer/audience）が確定する
        - 制御盤ブラウザは待受ソケットを持たず配信はクラウド権威から届く
      dod_obligations:
        - id: dod_conn_cloud_authority
          text: WebSocket の待受はクラウドサーバ側のみに存在し、制御盤ブラウザは待受ソケットを開かない
        - id: dod_conn_role_scoped_session
          text: 接続確立時にセッションのロールが確定し、以後の配信投影と権限判定がそのロールを単一判定点として参照する
    - id: op_join_game
      actor: answerer
      verb: join
      target: game_session
      trigger: 制御盤の QR を読取り /join で氏名を自己入力して参加確定
      route: /join
      ui_pattern: qr_scan_then_name_input
      preconditions:
        - 家族限定アクセス制御を通過している（分岐A トークン一致 または 分岐B 認証済）
        - answerer 接続数が MAX_TABLET_CONNECTIONS 未満
        - 氏名が非空かつ MAX_DISPLAY_NAME_LENGTH 以下
      measurement_source: 解答者の自己入力氏名
      durable_state: participants テーブル（id / name / joined_at / connection_id）＋ balances 行の初期化（amount = 10000）
      readback: 制御盤の参加者一覧と TV(e) 全問通算一覧に反映
      visible_to: [host, audience]
      forbidden_actors: []
      expected_outcomes:
        - 自己入力した氏名で participants に 1 人 1 レコードが作られ connection_id へ紐付く
        - 当該参加者の balances.amount が 10000 円（賞金先渡し）で初期化される
        - 参加が制御盤の参加者一覧と TV(e) に反映される
        - 端末番号の固定割当や事前氏名台帳を用いずに参加が成立する
      boundary_cases:
        - 空・空白のみの氏名 → UI とサーバの双方で拒否
        - MAX_DISPLAY_NAME_LENGTH 超過の氏名 → UI とサーバの双方で拒否
        - 同名の別人 → それぞれ別の participants レコード（氏名は一意キーでない）
        - 同一端末の resume なし再 /join → 新規参加として上限判定を再通過
      dod_obligations:
        - id: dod_join_self_name
          text: 参加者が自己入力した氏名が participants に永続し、制御盤の参加者一覧に表示される
        - id: dod_join_no_seat_fixed
          text: 端末番号の固定割当や事前氏名台帳の UI/API を用いずに参加が成立する
        - id: dod_join_one_device
          text: 参加確定 1 回につき connection_id へ紐づく participants レコードが 1 件だけ生成される
        - id: dod_join_reflected
          text: 参加確定が制御盤の参加者一覧と TV(e) の全問通算一覧へ反映される
        - id: dod_join_name_validation
          text: 空・空白のみ・上限長超過の氏名は /join の UI とサーバの双方で拒否され participants に入らない
        - id: dod_settle_initial_grant
          text: ゲーム開始時に各プレイヤーの balances.amount が 10000 円で初期化されている
    - id: op_enforce_connection_limit
      actor: system
      verb: reject
      target: tablet_connection
      trigger: answerer 接続数が MAX_TABLET_CONNECTIONS に達した状態での新規参加確定の試行
      route: /join
      measurement_source: 現在の answerer 接続数と src/config の MAX_TABLET_CONNECTIONS 解決値
      threshold: MAX_TABLET_CONNECTIONS（既定 8）
      preconditions:
        - connected_answerers >= MAX_TABLET_CONNECTIONS
      durable_state: 既存接続・participants・answers・balances は不変
      consumer_surfaces: [join_page]
      expected_outcomes:
        - admitTablet が over_limit を返し参加が成立しない
        - realtime_sync が connection_rejected とともに WS close(4001) で断る
        - 既存の接続と保持データ（participants/answers/balances/進行状態）は影響を受けない
        - host/audience 接続はタブレット上限に数えない別チャネルとして扱う
        - /join に満席の平易文が表示され設定キー名・接続数会計は露出しない
      boundary_cases:
        - 既定 8: 8 台目は許可・9 台目は拒否
        - 設定 16: 16 台目は許可・17 台目は拒否
        - 設定 32: 32 台目は許可・33 台目は拒否
        - 切断でスロット解放後は同数まで再受入可
      dod_obligations:
        - id: dod_limit_default_eight
          text: 設定未指定時に 8 台まで接続でき 9 台目が拒否される
        - id: dod_limit_config_follows
          text: MAX_TABLET_CONNECTIONS を 16/32 へ設定変更するとコード改修なしに上限がその値へ追随する
        - id: dod_limit_no_hardcode
          text: 上限判定は src/config の解決値を参照し、判定コードに数値リテラル 8 のハードコードが存在しない
        - id: dod_limit_existing_unaffected
          text: 上限拒否の発生時に既存接続のセッション・回答・残額・進行状態が変化しない
        - id: dod_limit_join_full_copy
          text: /join の満席表示が job-to-be-done 平易文で、設定キー名・接続数会計・ロール識別子を露出しない
    - id: op_load_questions
      actor: host
      verb: load
      target: question_set
      trigger: 制御盤で事前問題ファイル（JSON）の読込を実行
      route: /control-panel
      ui_pattern: file_pick_then_load
      forbidden_actors: [answerer, audience]
      preconditions:
        - game_state.phase が lobby またはライブ編集フェーズ（in_progress のライブ編集中）
        - 参照される全メディアが所定フォルダ（QUESTION_MEDIA_ROOT）配下に事前配置済み
      measurement_source: 事前問題ファイル（JSON 配列 QuestionIntakeRecord[]）
      durable_state: questions テーブル（text / image_path / video_path / correct_value）
      readback: ランタイム出題は questions テーブルから供給（ファイル再読込に依存しない）
      visible_to: [host]
      expected_outcomes:
        - 各問が questions テーブルへ登録される
        - correct_value が 0〜100 の整数で保持される
        - image_path / video_path は任意（NULL 許容）で保持される
        - 検証エラーが 1 件でもあれば 1 問も登録されない（全 or 無）
      boundary_cases:
        - correct_value 0/100 は登録可
        - correct_value -1/101/50.5 は登録拒否
        - image_path/video_path 未指定 → NULL で登録可
        - 宣言された動画/画像パスに所定フォルダ配下の実体が無い → 当該入稿は拒否
      dod_obligations:
        - id: dod_load_persist
          text: 読み込んだ全問が questions に登録され、再取得で登録時と同一の text と correct_value を返す
        - id: dod_load_runtime_from_db
          text: 出題面の解決元は questions テーブルであり、問題ファイルの再読込に依存しない
        - id: dod_load_media_paths_optional
          text: image_path と video_path は未指定でも登録でき NULL として保持される
        - id: dod_load_correct_value_integer
          text: correct_value が 0〜100 の整数以外では登録が拒否される（入稿検証とサーバ検証と DB CHECK を含む）
        - id: dod_load_no_adhoc_entry
          text: 出題内容の初期入稿は事前ファイル読込のみで、当日その場で問題集をゼロから手入力する UI/API が存在しない
        - id: dod_load_media_prevalidated
          text: 宣言された image_path/video_path に所定フォルダ配下の実体が無い場合は問題番号を添えて入稿が拒否され questions に入らない
        - id: dod_load_all_or_nothing
          text: 検証エラーが 1 件でもある入稿では questions が 1 行も追加されない
        - id: dod_load_host_only
          text: 読込は role host のみ発動でき answerer からの読込コマンドは 401/403 で拒否される
    - id: op_submit_answer
      actor: answerer
      verb: submit
      target: answer
      trigger: タブレット入力画面で +1/-1/+10/-10 のステッパで 0〜100 の数値を作り「送信」を押下
      route: /tablet
      ui_pattern: stepper_plus_minus_then_submit
      forbidden_actors: [host, audience]
      preconditions:
        - 参加確定済み（participants に自分のレコードが存在）
        - 当該問の rounds.stage が accepting（受付中）
      measurement_source: 解答者がステッパで作成した 0〜100 整数
      durable_state: answers（question_id + participant_id で一意・value は 0〜100 整数）
      readback: 送信後 submit_ack が当該解答者へ unicast され送信済み表示になる（再接続後の state_snapshot にも反映）
      from_state: accepting
      to_state: accepting
      visible_to: [answerer]
      expected_outcomes:
        - 0〜100 整数の解答が answers に upsert される
        - 送信済み状態が当該解答者にのみ表示され他者・観客へは配信されない
        - 締切（answers_locked）後の submit_answer はサーバで拒否される
      boundary_cases:
        - 値 0 / 100 は送信可
        - 値 -1 / 101 / 50.5 は UI とサーバの双方で拒否
        - 締切後の送信 → サーバで拒否（既存の永続解答は保持）
        - ステッパはクランプにより 0 未満・100 超の値を作れない
      dod_obligations:
        - id: dod_submit_stepper_only
          text: 解答者の入力導線が +1/-1/+10/-10 と「送信」のみで構成され、締切・開示・モード切替・他者情報閲覧の操作要素が /tablet に存在しない
        - id: dod_submit_range_guard
          text: 送信値は 0〜100 整数のみ UI とサーバ双方で受理され -1/101/50.5 は answers に入らない
        - id: dod_submit_accepting_only
          text: 受付中のみ送信でき answers_locked 到達後の submit_answer はサーバで拒否される
        - id: dod_submit_upsert_once
          text: 同一 question_id + participant_id の解答が upsert され重複行を作らない
        - id: dod_submit_own_ack_only
          text: 送信後 submit_ack が当該解答者のみへ返り、他解答者・観客へ解答が配信されない
    - id: op_propagate_deadline
      actor: host
      verb: lock
      target: answerer_tablets
      trigger: 制御盤で「そこまで」を押下
      route: /control-panel
      forbidden_actors: [answerer, audience]
      from_state: accepting
      to_state: answers_locked
      durable_state: game_state.stage = answers_locked
      consumer_surfaces: [answerer_tablets]
      expected_outcomes:
        - answers_locked が接続中の全解答者タブレットへ配信され入力が同期ロックされる
        - 締切後のタブレットからの submit_answer はサーバで拒否される
      dod_obligations:
        - id: dod_deadline_host_only
          text: 締切コマンドは role host のみ発動でき answerer/audience からの締切コマンドは command_denied(403) で拒否される
        - id: dod_deadline_sync_lock
          text: 締切の配信で接続中の全解答者タブレットが締切表示へ同期し以後の送信が拒否される
    - id: op_propagate_disclosure
      actor: host
      verb: open
      target: tv_and_endpoints
      trigger: 制御盤で「解答オープン！」を押下
      route: /control-panel
      forbidden_actors: [answerer, audience]
      from_state: answers_locked
      to_state: answers_opened
      durable_state: game_state.stage = answers_opened
      visible_to: [audience]
      consumer_surfaces: [tv_mode_b]
      expected_outcomes:
        - 開示前は他者の解答がどのロールの端末へも配信されない
        - 開示後 TV(b) へ全員の氏名と解答が一斉配信される
      dod_obligations:
        - id: dod_disclosure_hidden_before
          text: answers_opened 未配信の間は解答者・観客のいずれの端末へも他者の解答が配信されない
        - id: dod_disclosure_reveals_on_tv
          text: answers_opened の配信で TV(b) が全員の氏名と解答を表示する
    - id: op_reveal_answer
      actor: host
      verb: reveal
      target: tv_and_endpoints
      trigger: 制御盤で「正解発表」を押下
      route: /control-panel
      forbidden_actors: [answerer, audience]
      from_state: answers_opened
      to_state: answer_revealed
      durable_state: game_state.stage = answer_revealed（rounds.stage）
      visible_to: [audience]
      consumer_surfaces: [tv_mode_c]
      measurement_source: 当該問 questions.correct_value
      expected_outcomes:
        - TV(c) に当該問の正解値が表示される
        - answer_revealed 到達で当該問が isDisclosed 真となり以後の正解ライブ編集が自動再採点対象になる
      boundary_cases:
        - answers_opened 未到達での reveal は不正遷移として拒否
      dod_obligations:
        - id: dod_reveal_host_only
          text: 正解発表は role host のみ発動でき answerer/audience からは command_denied(403) で拒否される
        - id: dod_reveal_marks_disclosed
          text: answer_revealed 到達で当該問が isDisclosed 真となり以後の correct_value 編集が再採点対象になる
        - id: dod_reveal_tv_c
          text: 正解発表の配信で TV(c) が当該問の正解値を表示する
    - id: op_compute_settlement
      actor: host
      verb: settle
      target: balances
      trigger: 制御盤で「精算」を押下し得点精算を実行
      route: /control-panel
      forbidden_actors: [answerer, audience]
      from_state: answer_revealed
      to_state: settlement_computed
      measurement_source: answers.value と questions.correct_value
      durable_state: settlements（error / delta_yen / pitari_bonus_yen）＋ balances（円・整数）＋ rounds.stage = settlement_computed
      consumer_surfaces: [tv_mode_d, tv_mode_e]
      visible_to: [audience]
      expected_outcomes:
        - 誤差 = 絶対値(answer - correct) が 0〜100 整数で settlements に記録される
        - 増減円 = 誤差 × -100（整数円）で delta_yen が記録され balances が更新される
        - 誤差 0 のピタリ賞 +1000 円が pitari_bonus_yen に記録され balances へ加算される
        - TV(d) に 6 列精算表（氏名/解答/誤差/増減円/ピタリ賞/残額）が円建てで表示される
      boundary_cases:
        - 誤差 0 は +1000（丁度）
        - 誤差 1 は -100 のみ（直上・不連続）
      dod_obligations:
        - id: dod_settle_delta
          text: 誤差 5 の精算後に当該プレイヤーの balances.amount が精算前より 500 円少ない
        - id: dod_settle_pitari_add
          text: 誤差 0 のプレイヤーの pitari_bonus_yen が +1000 で balances に反映される（拠出配分側は F-02 未確定として fixme）
        - id: dod_settle_currency_yen
          text: settlements と balances と API 応答と d の 6 列表が円建てで表され point/pt/点 の語が存在しない
        - id: dod_settle_integer_only
          text: error / delta_yen / pitari_bonus_yen / amount がすべて整数で小数値を持たない
        - id: dod_settle_host_only
          text: 得点精算は role host のみ発動でき answerer からの精算コマンドは 401/403 で拒否される
    - id: op_propagate_mode_switch
      actor: host
      verb: switch
      target: tv_display
      trigger: 制御盤の「次へ」「戻る」または各モード個別ジャンプ
      route: /control-panel
      ui_pattern: next_back_jump
      forbidden_actors: [answerer, audience]
      durable_state: game_state.tv_mode
      consumer_surfaces: [tv_mode_a, tv_mode_b, tv_mode_c, tv_mode_d, tv_mode_e]
      expected_outcomes:
        - 3 系統いずれの操作でも tv_mode_changed が配信され接続中の TV が対応モードへ切り替わる
      dod_obligations:
        - id: dod_mode_switch_host_only
          text: モード切替は role host のみ発動でき answerer/audience からのモード切替は command_denied(403) で拒否される
        - id: dod_mode_switch_sync_tv
          text: 次へ・戻る・個別ジャンプの 3 系統いずれでも tv_mode_changed が配信され接続中の TV が対応モードへ切り替わる
    - id: op_switch_tv_mode
      actor: host
      verb: switch
      target: tv_mode
      trigger: 制御盤の「次へ」「戻る」または各モード個別ジャンプで a モードへ切替
      route: /control-panel
      ui_pattern: next_back_jump
      forbidden_actors: [answerer, audience]
      measurement_source: questions.video_path / image_path / text（当該問）
      durable_state: game_state.tv_mode
      consumer_surfaces: [tv_mode_a]
      expected_outcomes:
        - a モードは動画→画像→テキストの 3 段で出題面を解決する
        - メディアパスのライブ編集後は次の a モード描画に反映される
      boundary_cases:
        - 動画パス有 → 動画（画像有無に関わらず動画優先）
        - 動画無・画像有 → 画像
        - 双方無 → テキスト
      dod_obligations:
        - id: dod_tv_a_fallback
          text: a モードが video_path→image_path→text の優先順で出題面を解決する
        - id: dod_tv_a_reflects_live_edit
          text: メディアパスのライブ編集後に a モードを再描画すると解決される出題面が編集後の規定順に従う
        - id: dod_tv_a_no_path_leak
          text: a モードの表示に生のファイルパス文字列や fallback 等の内部語が露出しない
    - id: op_live_edit_correct
      actor: host
      verb: edit
      target: question_or_correct_value
      trigger: 制御盤のライブ編集 UI で問題文・正解値・画像/動画パスを更新
      route: /control-panel
      ui_pattern: inline_edit_then_save
      forbidden_actors: [answerer, audience]
      preconditions:
        - 対象問が questions に存在する
      durable_state: questions テーブル更新（text / image_path / video_path / correct_value）
      readback: DB 再取得で編集後の値を返す
      visible_to: [host]
      expected_outcomes:
        - 問題文・正解・メディアパスを進行中に編集でき questions に永続する
        - 画像/動画パスの編集は a モードの出題面解決に反映される
        - correct_value の編集かつ開示済み（c 以降）のときのみ自動再採点を誘発する
      boundary_cases:
        - text のみ編集 → 再採点は走らない
        - image_path/video_path のみ編集 → 再採点は走らない・a モード解決のみ変化
        - correct_value 編集かつ c 未到達 → 再採点は走らない
        - correct_value 編集かつ c 以降 → 再採点が走る
      dod_obligations:
        - id: dod_edit_persist
          text: 進行中に編集した問題文と正解値が questions に永続し再取得で読み戻せる
        - id: dod_edit_media_persist
          text: 進行中に編集した image_path/video_path が questions に永続し再取得で読み戻せる
        - id: dod_edit_media_face_follows
          text: 動画パスを付与/除去すると当該問の a モード出題面が規定順（video→image→text）で切り替わる
        - id: dod_edit_correct_range_guard
          text: 正解値の編集も 0〜100 整数のみ受理し範囲外はサーバと DB CHECK で拒否される
        - id: dod_edit_host_only
          text: ライブ編集は role host のみ発動でき answerer からの編集コマンドは 401/403 で拒否される
    - id: op_auto_rescore
      actor: system
      verb: rescore
      target: balances
      trigger: 開示済み（rounds.stage が answer_revealed 以降）の問題で司会者が correct_value をライブ編集
      preconditions:
        - 当該問の rounds.stage が answer_revealed 以降（isDisclosed 真）
        - ライブ編集の patch が correctValue を含む
      measurement_source: 編集後 questions.correct_value と既存 answers.value
      durable_state: settlements 再計算 ＋ balances 差分更新
      consumer_surfaces: [tv_mode_d, tv_mode_e]
      from_state: answer_revealed
      to_state: answer_revealed
      expected_outcomes:
        - 正解訂正で当該問の全 settlements（誤差・delta_yen・pitari）が再計算される
        - balances が旧拠出との差分で更新される
        - rounds.stage が settlement_computed の問は TV d/e が同時更新される
      boundary_cases:
        - c 到達問の correct_value 訂正 → 再採点が走る
        - c 未到達（isDisclosed 偽）の correct_value 編集 → 再採点は走らない（境界外）
        - text/メディアのみ編集 → 再採点は走らない（correct_value 不変）
      dod_obligations:
        - id: dod_rescore_after_c
          text: rounds.stage が answer_revealed 以降で正解を直すと settlements と balances が再計算され各人の残額へ即時反映される
        - id: dod_rescore_no_before_c
          text: rounds.stage が answer_revealed 未満の正解編集では settlements と balances が変化しない
        - id: dod_rescore_only_on_correct_value
          text: text または image_path/video_path のみの編集では再採点が走らず balances が不変である
        - id: dod_rescore_d_sync
          text: rounds.stage が settlement_computed の問の正解訂正で balances 差分が再計算され TV の d と e が同時更新される
        - id: dod_rescore_matches_full_recompute
          text: 差分更新後の balances が answers と correct_value からの全再計算と一致する
    - id: op_undo
      actor: host
      verb: undo
      target: last_progression
      trigger: 制御盤で「取消」を押下
      route: /control-panel
      forbidden_actors: [answerer, audience]
      durable_state: trigger_undone イベント（巻き戻し範囲は F-03 未確定・発明しない）
      consumer_surfaces: [control_panel, tv_display, answerer_tablets]
      expected_outcomes:
        - trigger_undone が配信され直近の対象操作が取り消される
        - 発動権限は制御盤（host）のみで初版から存置される
      boundary_cases:
        - 巻き戻し範囲（直近のみ / 任意問題再開示 / d 到達問の残額差分巻き戻し）は F-03 未確定
      dod_obligations:
        - id: dod_undo_host_only
          text: 取消は role host のみ発動でき answerer/audience からは command_denied(403) で拒否される（巻き戻し挙動詳細は F-03/F028、E2E は test.fixme）
    - id: op_determine_winner
      actor: system
      verb: determine
      target: winner
      trigger: 10 問目の得点精算が完了
      preconditions:
        - 10 問すべての rounds.stage が settlement_computed
      measurement_source: 全問通算の balances.amount
      consumer_surfaces: [tv_mode_e]
      from_state: settlement_computed
      to_state: game_finished
      durable_state: game_state.phase = finished
      expected_outcomes:
        - balances.amount 最多のプレイヤーが e モードで勝者として判別可能に表示される
      boundary_cases:
        - 残額同点は複数の共同首位を勝者として提示（同点優先順位は確定要件に無く発明しない・F-06）
      dod_obligations:
        - id: dod_winner_most_balance
          text: 10 問終了時に balances.amount 最多のプレイヤーが e モードで勝者として判別できる
    - id: op_broadcast_state_transition
      actor: system
      verb: broadcast
      target: connected_endpoints
      trigger: ドメインイベント（answers_locked/answers_opened/answer_revealed/settlement_computed/tv_mode_changed/balance_updated/participant_joined/trigger_undone）の確定
      measurement_source: game_state と balances の確定済み遷移
      durable_state: 各イベントに単調増加の seq を付与
      consumer_surfaces: [control_panel, tv_display, answerer_tablets]
      readback: 遅参・再接続端末は state_snapshot で最新へ整合
      visible_to: [host, answerer, audience]
      threshold: 状態遷移の全端末反映 p95 <= 2000ms（暫定ゲート・F-04）
      expected_outcomes:
        - 該当ロールの接続中全端末へロール投影済みイベントが配信される
        - 配信はロール投影を通し、可視範囲外の情報は当該ロールへ送られない
      dod_obligations:
        - id: dod_broadcast_all_role_endpoints
          text: 状態遷移イベントが当該ロールの接続中全端末へ配信される
        - id: dod_broadcast_role_projection
          text: 配信ペイロードはロール投影を経由し、解答者端末へ他者の解答・残額・得点が配信されない
        - id: dod_broadcast_latency_gate
          text: 状態遷移の全端末反映が p95 <= 2000ms を満たす
    - id: op_recover_on_reconnect
      actor: system
      verb: recover
      target: reconnecting_endpoint
      trigger: 回線断後の端末が再接続し（answerer は resume トークンを添えて）resume する
      route: /control-panel | /tv | /tablet
      measurement_source: サーバ権威の game_state（current_question_number/stage/tv_mode）と balances と answers
      durable_state: 端末側は状態を保持せずサーバ権威から再構成する
      readback: ロール投影済み state_snapshot を返し以後の live 配信へ合流させる
      expected_outcomes:
        - 再接続端末が現在問題番号・進行段階・TV モードへ復帰する
        - 解答者は自分の残額と送信済み状態へ復帰し他者情報は復帰対象外
        - 復帰値の権威はサーバの game_state と balances でありクライアント保存値に依存しない
      boundary_cases:
        - 制御盤が落ちても TV/タブレット間の配信はクラウド権威で継続する
        - 無効・失効トークンの再接続は新規参加として扱い上限判定を再度通す
      dod_obligations:
        - id: dod_reconnect_progression
          text: 再接続端末が現在問題番号・進行段階・TV モードへ復帰する
        - id: dod_reconnect_own_balance
          text: 再接続した解答者が自分の残額と送信済み状態へ復帰し、他者の解答・残額は復帰対象に含まれない
        - id: dod_reconnect_server_authority
          text: 復帰値がサーバの game_state と balances から供給され、クライアント保存値に依存しない
        - id: dod_reconnect_control_panel_resilient
          text: 制御盤の切断中も TV とタブレットの同期がクラウド権威経由で継続する
    - id: op_preserve_answer_across_reconnect
      actor: system
      verb: preserve
      target: answer
      trigger: 受付中に送信済みの解答を持つ端末が切断・再接続する
      measurement_source: answers テーブル（question_id + participant_id の一意キー）
      preconditions:
        - 当該問の game_state.stage が accepting のとき submit は upsert される
      durable_state: answers（question_id + participant_id で一意）
      readback: 再接続後の state_snapshot が送信済み状態を反映する
      from_state: accepting
      to_state: accepting
      expected_outcomes:
        - 受付中に永続した解答が切断・再接続を跨いで保持される
        - 再接続後の再送で同一問・同一参加者の解答が重複永続化されない
      boundary_cases:
        - ack 前切断で resume 再送 → upsert により重複なく保持
        - 締切後の resume 再送 → 拒否されるが既存の永続解答は保持
      dod_obligations:
        - id: dod_answer_preserved_across_reconnect
          text: 受付中に送信済みの解答が接続断・再接続後も answers に保持され送信済み表示へ復帰する
        - id: dod_answer_no_duplicate
          text: 再接続後の再送で同一 question_id + participant_id の解答行が重複せず一意に保たれる
```

---

## 3. Open Questions

壁打ち（要件定義）フェーズはクローズ済で殿判断待ちの論点は残っていない。以下は運用挙動モデルに関して実装組み立てフェーズで MAS が決める選定、推測実装せず殿判断を仰ぐ点、検証ゲートで暫定運用中のフラグである。いずれも「推奨なし」「要検討」「TBD」の空白は残さず、確定した制約・既定機構・暫定ゲート値を明記する。

### 3.1 実装組み立てフェーズの選定（MAS 決定・殿判断不要）

| 項目 | 決定/既定 | 制約・選定軸 |
|---|---|---|
| ステッパ UI のクランプ | `+1/−1/+10/−10` は 0〜100 でクランプ（0 未満・100 超を作れない）、送信時にサーバ再検証 | UI・サーバの二重防衛（`dod_submit_range_guard`）。0/100 は可、-1/101/50.5 は不可。 |
| TV モードと段階の駆動 | 段階遷移（lock/open/reveal/settle）が既定 TV モード（a/b/c/d）を駆動、`switch_mode`（次へ/戻る/個別ジャンプ）で e を含め自由navigation | `stageToTvMode` を単一化し、e は通算閲覧としてモード切替から到達（`dod_mode_switch_sync_tv`）。 |
| host 操作の単一判定点 | 接続確立時に確定した `role` 属性を全 host コマンドの単一判定点として参照 | 副司会ロールを発明せず、非 host は 403／未認証 401（`dod_*_host_only`）。 |
| 再採点の実行方式 | 実行時は差分更新、正しさの基準は全再計算 | 差分更新後 `balances` が全再計算と一致する監査不変式（`dod_rescore_matches_full_recompute`）。 |
| ピタリ賞加算の反映範囲 | 加算側 +1,000 を即実装、拠出減算は F-02 確定後に `settlements` へ負の拠出行で追加 | 加算側・円建て・現金感の各確定値は変更しない（§2.5）。 |

### 3.2 F028 エスカレーション（推測実装しない）

- **取消操作の巻き戻し範囲（論点 7・F-03）**: `trigger_undone` が `settlement_computed` を 1 段戻して `settlements`／`balances` を巻き戻すのか、任意問題を再開示（`answer_revealed` へ戻し再採点）するのか、d 到達問の残額差分をどこまで巻き戻すのかが曖昧な範囲は推測実装せず、選択肢を添えて F028 で殿判断を仰ぐ。**発動権限＝制御盤（host）のみ・初版から存置**は確定ゆえ実装・検証し（`dod_undo_host_only`）、状態遷移の詳細は E2E で `test.fixme()`。
- **ピタリ賞の拠出配分（B・F-02）**: `settlements.pitari_bonus_yen` の **加算側 +1,000 は確定・実装必須**。**拠出元と配分**（総額 1,000 か各人からか、複数同時ピタリ時の扱い）が未確定な間は `balances` の拠出減算を 0 とし、確定後に拠出行を追加する拡張余地を残す。挙動詳細は E2E で `test.fixme()`。選択肢を添えて F028 で殿判断を仰ぐ。
- **同名参加者の識別表示（論点9改の周辺）**: 「同名の別人」を許容する（氏名は一意キーでない・identity は `participants.id`）方針は確定だが、TV(e)・制御盤一覧で同名を区別する付記（連番・参加順）が要件に無いため発明しない。必要と判明した場合は選択肢を添えて F028。

### 3.3 検証ゲートで暫定運用中のフラグ（設計義務の欠落・発明せず flag）

- **F-01（残額の下限・脱落）**: 確定要件は「誤差 × −100 円」「賞金先渡し 10,000 円」のみで、`balances.amount` の 0 下限や全額喪失での脱落は確定要件に無い。`amount` に下限を課さず負残高も表現可能とする。下限／脱落を導入する実装が現れた場合にフラグする。
- **F-04（同期レイテンシ SLA）**: 設計に固定 SLA が無いため、状態遷移の全端末反映は **p95 ≤ 2,000ms**、入稿は **p95 ≤ 1,000ms** を暫定テストゲートとして扱い、SLA 確定時に更新する（`dod_broadcast_latency_gate`）。
- **F-05（家族限定アクセス制御）**: 分岐 A（`JOIN_ACCESS_TOKEN`）が設定されていればトークン一致判定を検証、分岐 B（認証）が実装されていれば `/join` 到達前のログイン→リダイレクト→氏名入力描画フローを検証、いずれも未実装なら該当ブラウザテストを `test.fixme()`。ただし `checkJoinAccess` の **未構成時 `granted: false`**（無制御公開を成立させない）は値に依らず検証必須。無制御公開のまま出荷はリリース不可。
- **F-06（残額同点時の勝者優先順位）**: 「残額最多勝ち」は確定だが、同点時の優先順位（先着・問別勝率等）は確定要件に無い。`determineWinners` は同点を **複数の共同首位** として返し、優先順位を発明しない。導入する実装が現れた場合にフラグし、必要なら F028 で選択肢を提示する。
- **F-06'（動画コーデック/配信方式）**: 動画の実体は問題ファイル記載＋所定フォルダ事前配置で確定だが、TV a モードで確実に再生できるコンテナ/コーデックの具体制約は本設計に固定値が無い。実装時は `<video>` が本番ブラウザで再生可能な形式を選定軸とし、再生不可形式の混入は入稿検証の拡張対象としてフラグする（現時点ではパス存在検証までを義務とする）。
