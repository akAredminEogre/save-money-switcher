# Findings

<!-- codd:finding
{"details": {"evidence": "E-1『事前に用意した問題ファイルを読み込む』; E-2『ファイルから読み込み DB 登録・DB 保持』; N-2『問題データは動画パス・画像パス（任意）・テキストを保持できる構造とする』", "gap": "Only that a structure must hold video/image/text is stated; no concrete file format, field names, or authoring schema is given", "scope_note": "DB persistence tech is explicitly deferred to greenfield, but the human-authored intake file format is a requirements-level concern (how the family authors questions) and is not addressed"}, "id": "question_intake_file_format_unspecified", "kind": "data-format / input-spec", "name": "Concrete format and schema of the pre-loaded question file is undefined", "question": "What file format (CSV / JSON / YAML / spreadsheet) and field schema does the intake file use? Per question, which fields exist and how are they encoded — text, correct value (0–100 integer), video path, optional image path, any id/order/metadata — and where do authored files vs. placed media folders live relative to each other?", "rationale": "The intake file is a core input. Without a defined schema, ingestion/DB-registration cannot be built and question authors have no format to follow.", "related_requirement_ids": ["req:save-money-switcher-requirements"], "severity": "high", "source": "greenfield"}
-->
## question_intake_file_format_unspecified - Concrete format and schema of the pre-loaded question file is undefined

- approval: [ ] `question_intake_file_format_unspecified`
- id: `question_intake_file_format_unspecified`
- kind: `data-format / input-spec`
- severity: `high`
- name: Concrete format and schema of the pre-loaded question file is undefined
- question: What file format (CSV / JSON / YAML / spreadsheet) and field schema does the intake file use? Per question, which fields exist and how are they encoded — text, correct value (0–100 integer), video path, optional image path, any id/order/metadata — and where do authored files vs. placed media folders live relative to each other?
- rationale: The intake file is a core input. Without a defined schema, ingestion/DB-registration cannot be built and question authors have no format to follow.
- related_requirement_ids: `req:save-money-switcher-requirements`

```yaml
evidence: E-1『事前に用意した問題ファイルを読み込む』; E-2『ファイルから読み込み DB 登録・DB 保持』; N-2『問題データは動画パス・画像パス（任意）・テキストを保持できる構造とする』
gap: Only that a structure must hold video/image/text is stated; no concrete file
  format, field names, or authoring schema is given
scope_note: DB persistence tech is explicitly deferred to greenfield, but the human-authored
  intake file format is a requirements-level concern (how the family authors questions)
  and is not addressed
```

<!-- codd:finding
{"details": {"evidence": "B『ピタリ賞 — 誤差0の場合、他プレイヤーから1,000円を獲得』; N-4『ピタリ賞成立時は他プレイヤーからの +1,000 円も反映』", "gap": "Distribution across N−1 others, simultaneous multiple winners, and insufficient-funds cases are not specified", "reference_game": "参考: 完全正解で他の解答者から10万円を横取り（合計横取り）"}, "id": "pitari_prize_distribution_undefined", "kind": "scoring-rule ambiguity", "name": "Pitari (exact-answer) prize distribution and edge cases are undefined", "question": "When a player answers exactly (error 0) and 'gains 1,000 yen from other players': is that 1,000 total shared among all others, or 1,000 from EACH other player? If several players hit exactly in the same question, how is the pool split? What happens if an 'other player' lacks the funds to pay their share?", "rationale": "Directly determines scoring correctness and the d/e mode tables; ambiguity yields divergent implementations and in-play disputes.", "related_requirement_ids": ["req:save-money-switcher-requirements"], "severity": "high", "source": "greenfield"}
-->
## pitari_prize_distribution_undefined - Pitari (exact-answer) prize distribution and edge cases are undefined

- approval: [ ] `pitari_prize_distribution_undefined`
- id: `pitari_prize_distribution_undefined`
- kind: `scoring-rule ambiguity`
- severity: `high`
- name: Pitari (exact-answer) prize distribution and edge cases are undefined
- question: When a player answers exactly (error 0) and 'gains 1,000 yen from other players': is that 1,000 total shared among all others, or 1,000 from EACH other player? If several players hit exactly in the same question, how is the pool split? What happens if an 'other player' lacks the funds to pay their share?
- rationale: Directly determines scoring correctness and the d/e mode tables; ambiguity yields divergent implementations and in-play disputes.
- related_requirement_ids: `req:save-money-switcher-requirements`

```yaml
evidence: B『ピタリ賞 — 誤差0の場合、他プレイヤーから1,000円を獲得』; N-4『ピタリ賞成立時は他プレイヤーからの +1,000 円も反映』
reference_game: '参考: 完全正解で他の解答者から10万円を横取り（合計横取り）'
gap: Distribution across N−1 others, simultaneous multiple winners, and insufficient-funds
  cases are not specified
```

<!-- codd:finding
{"details": {"evidence": "進行状態機『受付中→締切（全解答者の入力ロック）』; 誤差 = |回答 − 正解|（回答値が必須）; N-1『送信済み表示』が送信アクションを含意", "gap": "No rule for missing/blank answers at lock time; resubmission-before-lock semantics also unstated"}, "id": "missing_answer_at_lock_scoring_undefined", "kind": "scoring-rule gap", "name": "Scoring for a player who submits no answer before lock is undefined", "question": "If a player has not submitted (or is not connected) when the host locks ('そこまで'), how are they scored — max error (−10,000), no deduction, excluded from the question, or other? How does a blank/no-answer render in the b (open) and d (settlement) tables? Relatedly, may a player resubmit/change their answer any number of times before lock, with the latest value winning?", "rationale": "A routine real-play situation; undefined handling blocks deterministic scoring and the all-players tables (N-4).", "related_requirement_ids": ["req:save-money-switcher-requirements"], "severity": "high", "source": "greenfield"}
-->
## missing_answer_at_lock_scoring_undefined - Scoring for a player who submits no answer before lock is undefined

- approval: [ ] `missing_answer_at_lock_scoring_undefined`
- id: `missing_answer_at_lock_scoring_undefined`
- kind: `scoring-rule gap`
- severity: `high`
- name: Scoring for a player who submits no answer before lock is undefined
- question: If a player has not submitted (or is not connected) when the host locks ('そこまで'), how are they scored — max error (−10,000), no deduction, excluded from the question, or other? How does a blank/no-answer render in the b (open) and d (settlement) tables? Relatedly, may a player resubmit/change their answer any number of times before lock, with the latest value winning?
- rationale: A routine real-play situation; undefined handling blocks deterministic scoring and the all-players tables (N-4).
- related_requirement_ids: `req:save-money-switcher-requirements`

```yaml
evidence: 進行状態機『受付中→締切（全解答者の入力ロック）』; 誤差 = |回答 − 正解|（回答値が必須）; N-1『送信済み表示』が送信アクションを含意
gap: No rule for missing/blank answers at lock time; resubmission-before-lock semantics
  also unstated
```

<!-- codd:finding
{"details": {"evidence": "B『先渡し10,000円／誤差1につき−100円／ピタリ賞は他者から1,000円』（最大誤差100 → −10,000）", "gap": "No floor/elimination/negative-balance rule for the family version", "reference_game": "参考『全額喪失で脱落』"}, "id": "remaining_balance_floor_and_elimination_undefined", "kind": "scoring-rule gap", "name": "Behavior when remaining balance reaches 0 or goes negative is undefined", "question": "Can a balance go negative? Max error 100 deducts −10,000 (wiping the 10,000 exactly), and pitari transfers can push a payer below their balance. Is there elimination on reaching 0 (as in the reference show), a floor at 0, or an unbounded negative balance? Does a wiped-out player still answer remaining questions and still owe pitari transfers?", "rationale": "Affects final ranking, the pitari transfer pool, and whether elimination UI/logic is needed.", "related_requirement_ids": ["req:save-money-switcher-requirements"], "severity": "high", "source": "greenfield"}
-->
## remaining_balance_floor_and_elimination_undefined - Behavior when remaining balance reaches 0 or goes negative is undefined

- approval: [ ] `remaining_balance_floor_and_elimination_undefined`
- id: `remaining_balance_floor_and_elimination_undefined`
- kind: `scoring-rule gap`
- severity: `high`
- name: Behavior when remaining balance reaches 0 or goes negative is undefined
- question: Can a balance go negative? Max error 100 deducts −10,000 (wiping the 10,000 exactly), and pitari transfers can push a payer below their balance. Is there elimination on reaching 0 (as in the reference show), a floor at 0, or an unbounded negative balance? Does a wiped-out player still answer remaining questions and still owe pitari transfers?
- rationale: Affects final ranking, the pitari transfer pool, and whether elimination UI/logic is needed.
- related_requirement_ids: `req:save-money-switcher-requirements`

```yaml
evidence: B『先渡し10,000円／誤差1につき−100円／ピタリ賞は他者から1,000円』（最大誤差100 → −10,000）
reference_game: 参考『全額喪失で脱落』
gap: No floor/elimination/negative-balance rule for the family version
```

<!-- codd:finding
{"details": {"evidence": "『全問終了時の残額最多が勝ち』", "gap": "Ties not addressed"}, "id": "winner_tie_breaking_undefined", "kind": "scoring-rule gap", "name": "Tie-breaking for the winner is unspecified", "question": "When two or more players finish with the same highest remaining balance, how is the winner decided — co-winners, a tie-break rule, or is no rule needed?", "rationale": "Equal balances are plausible in family play; the e-mode ranking display needs a defined ordering.", "related_requirement_ids": ["req:save-money-switcher-requirements"], "severity": "medium", "source": "greenfield"}
-->
## winner_tie_breaking_undefined - Tie-breaking for the winner is unspecified

- approval: [ ] `winner_tie_breaking_undefined`
- id: `winner_tie_breaking_undefined`
- kind: `scoring-rule gap`
- severity: `medium`
- name: Tie-breaking for the winner is unspecified
- question: When two or more players finish with the same highest remaining balance, how is the winner decided — co-winners, a tie-break rule, or is no rule needed?
- rationale: Equal balances are plausible in family play; the e-mode ranking display needs a defined ordering.
- related_requirement_ids: `req:save-money-switcher-requirements`

```yaml
evidence: 『全問終了時の残額最多が勝ち』
gap: Ties not addressed
```

<!-- codd:finding
{"details": {"evidence": "E-2『問題は DB に保持』; C『1ゲーム10問』; 進行状態機（受付→締切→開示）は1問単位のみ記述", "gap": "No rule linking the DB question pool to a 10-question game (selection/ordering), and no game start/reset/new-game flow"}, "id": "game_lifecycle_and_question_selection_undefined", "kind": "workflow gap", "name": "Game lifecycle and selection/ordering of the 10 questions from the DB is undefined", "question": "How is a game started and reset? How are the 10 questions for a game chosen and ordered from the DB (fixed curated set, host-picked at start, random draw)? Can multiple games/rounds run in a session, and are prior results persisted or cleared between games?", "rationale": "Bridging 'DB of questions' to 'a 10-question game' is essential to run any session; unspecified selection/reset blocks the core control-panel flow.", "related_requirement_ids": ["req:save-money-switcher-requirements"], "severity": "high", "source": "greenfield"}
-->
## game_lifecycle_and_question_selection_undefined - Game lifecycle and selection/ordering of the 10 questions from the DB is undefined

- approval: [ ] `game_lifecycle_and_question_selection_undefined`
- id: `game_lifecycle_and_question_selection_undefined`
- kind: `workflow gap`
- severity: `high`
- name: Game lifecycle and selection/ordering of the 10 questions from the DB is undefined
- question: How is a game started and reset? How are the 10 questions for a game chosen and ordered from the DB (fixed curated set, host-picked at start, random draw)? Can multiple games/rounds run in a session, and are prior results persisted or cleared between games?
- rationale: Bridging 'DB of questions' to 'a 10-question game' is essential to run any session; unspecified selection/reset blocks the core control-panel flow.
- related_requirement_ids: `req:save-money-switcher-requirements`

```yaml
evidence: E-2『問題は DB に保持』; C『1ゲーム10問』; 進行状態機（受付→締切→開示）は1問単位のみ記述
gap: No rule linking the DB question pool to a 10-question game (selection/ordering),
  and no game start/reset/new-game flow
```

<!-- codd:finding
{"details": {"evidence": "『回線断は運用リスクとして扱い対策を別途明記する』; 『本番当日のインターネット接続を前提』; 『QR→氏名自己入力・1人=1台』", "gap": "Countermeasures / reconnection / session-resume behavior are deferred ('別途明記') but not yet specified"}, "id": "disconnect_reconnect_behavior_undefined", "kind": "resilience / operational gap", "name": "Tablet/host disconnect and reconnect behavior during a game is undefined", "question": "When a tablet (or the host/TV) briefly loses connectivity mid-game, what happens to the player's identity, submitted answer, and remaining balance? Can the client reconnect and resume the exact same player state? What is the concrete 回線断 countermeasure the requirements promise to document 'separately'?", "rationale": "Cloud + day-of internet is an explicitly stated risk; without defined reconnection/state handling a transient drop can corrupt scoring or lose a player.", "related_requirement_ids": ["req:save-money-switcher-requirements"], "severity": "high", "source": "greenfield"}
-->
## disconnect_reconnect_behavior_undefined - Tablet/host disconnect and reconnect behavior during a game is undefined

- approval: [ ] `disconnect_reconnect_behavior_undefined`
- id: `disconnect_reconnect_behavior_undefined`
- kind: `resilience / operational gap`
- severity: `high`
- name: Tablet/host disconnect and reconnect behavior during a game is undefined
- question: When a tablet (or the host/TV) briefly loses connectivity mid-game, what happens to the player's identity, submitted answer, and remaining balance? Can the client reconnect and resume the exact same player state? What is the concrete 回線断 countermeasure the requirements promise to document 'separately'?
- rationale: Cloud + day-of internet is an explicitly stated risk; without defined reconnection/state handling a transient drop can corrupt scoring or lose a player.
- related_requirement_ids: `req:save-money-switcher-requirements`

```yaml
evidence: 『回線断は運用リスクとして扱い対策を別途明記する』; 『本番当日のインターネット接続を前提』; 『QR→氏名自己入力・1人=1台』
gap: Countermeasures / reconnection / session-resume behavior are deferred ('別途明記')
  but not yet specified
```

<!-- codd:finding
{"details": {"evidence": "E-2『問題は DB に保持』（問題データ限定）; E-3残『各問がどのモードまで進んだか（b/c/d）を保持する設計が要る』", "gap": "Persistence/recovery of runtime game/session state (as opposed to question data) is not addressed"}, "id": "game_state_persistence_across_restart_undefined", "kind": "state-durability gap", "name": "Durability of live game state (players, balances, per-question progress) is unspecified", "question": "Is live game state — connected players, current balances, and each question's progress (b/c/d) needed for E-3残 re-scoring — held only in server memory, or persisted? Does it survive a cloud server restart mid-game? The DB is described only for question data and live-edit updates.", "rationale": "For a cloud-hosted live event, losing balances/progress on a restart would end the game; whether state is durable is an architectural decision the requirements leave open.", "related_requirement_ids": ["req:save-money-switcher-requirements"], "severity": "medium", "source": "greenfield"}
-->
## game_state_persistence_across_restart_undefined - Durability of live game state (players, balances, per-question progress) is unspecified

- approval: [ ] `game_state_persistence_across_restart_undefined`
- id: `game_state_persistence_across_restart_undefined`
- kind: `state-durability gap`
- severity: `medium`
- name: Durability of live game state (players, balances, per-question progress) is unspecified
- question: Is live game state — connected players, current balances, and each question's progress (b/c/d) needed for E-3残 re-scoring — held only in server memory, or persisted? Does it survive a cloud server restart mid-game? The DB is described only for question data and live-edit updates.
- rationale: For a cloud-hosted live event, losing balances/progress on a restart would end the game; whether state is durable is an architectural decision the requirements leave open.
- related_requirement_ids: `req:save-money-switcher-requirements`

```yaml
evidence: E-2『問題は DB に保持』（問題データ限定）; E-3残『各問がどのモードまで進んだか（b/c/d）を保持する設計が要る』
gap: Persistence/recovery of runtime game/session state (as opposed to question data)
  is not addressed
```

<!-- codd:finding
{"details": {"evidence": "論点9改『ホスト画面の QR を読み氏名を自己入力・1人=1台』; 『なりすまし・取り違え耐性は本推奨の根拠として検討・記録しておらぬ』", "gap": "No dedup/validation/re-identification rules; requirements explicitly note anti-spoofing/mix-up was not considered"}, "id": "self_entered_name_identity_undefined", "kind": "identity / data-integrity gap", "name": "Self-entered names: duplicates, validation, and re-identification are undefined", "question": "With names self-entered and no auth, how are duplicate or blank names handled? On a tablet reload/reconnect, how is the device re-associated with its existing player and balance? Any constraints on name length/characters?", "rationale": "Names key the b/d/e scoring tables; duplicate or lost identity breaks per-player scoring.", "related_requirement_ids": ["req:save-money-switcher-requirements"], "severity": "medium", "source": "greenfield"}
-->
## self_entered_name_identity_undefined - Self-entered names: duplicates, validation, and re-identification are undefined

- approval: [ ] `self_entered_name_identity_undefined`
- id: `self_entered_name_identity_undefined`
- kind: `identity / data-integrity gap`
- severity: `medium`
- name: Self-entered names: duplicates, validation, and re-identification are undefined
- question: With names self-entered and no auth, how are duplicate or blank names handled? On a tablet reload/reconnect, how is the device re-associated with its existing player and balance? Any constraints on name length/characters?
- rationale: Names key the b/d/e scoring tables; duplicate or lost identity breaks per-player scoring.
- related_requirement_ids: `req:save-money-switcher-requirements`

```yaml
evidence: 論点9改『ホスト画面の QR を読み氏名を自己入力・1人=1台』; 『なりすまし・取り違え耐性は本推奨の根拠として検討・記録しておらぬ』
gap: No dedup/validation/re-identification rules; requirements explicitly note anti-spoofing/mix-up
  was not considered
```

<!-- codd:finding
{"details": {"evidence": "『🟨（未確定・真の設計分岐）家族限定のアクセス制御: URL を知る者のみか・認証を設けるか』", "status": "Marked 未確定 and assigned to greenfield ('家族限定アクセス制御 … greenfield 実装時に MAS が決める'); surfaced here for its gameplay-integrity implication"}, "id": "family_access_control_undecided", "kind": "security / access-control", "name": "Family-limited access control is explicitly undecided", "question": "Should the cloud public URL be protected (auth, room/PIN code, one-time link), or is 'anyone who has the URL may join' acceptable? Note the gameplay-integrity impact: an uninvited joiner counts as a player and can affect the pitari transfer pool and scoring.", "rationale": "A publicly reachable cloud URL with no auth lets outsiders join and influence scoring; the requirement itself leaves the policy open.", "related_requirement_ids": ["req:save-money-switcher-requirements"], "severity": "medium", "source": "greenfield"}
-->
## family_access_control_undecided - Family-limited access control is explicitly undecided

- approval: [ ] `family_access_control_undecided`
- id: `family_access_control_undecided`
- kind: `security / access-control`
- severity: `medium`
- name: Family-limited access control is explicitly undecided
- question: Should the cloud public URL be protected (auth, room/PIN code, one-time link), or is 'anyone who has the URL may join' acceptable? Note the gameplay-integrity impact: an uninvited joiner counts as a player and can affect the pitari transfer pool and scoring.
- rationale: A publicly reachable cloud URL with no auth lets outsiders join and influence scoring; the requirement itself leaves the policy open.
- related_requirement_ids: `req:save-money-switcher-requirements`

```yaml
evidence: '『🟨（未確定・真の設計分岐）家族限定のアクセス制御: URL を知る者のみか・認証を設けるか』'
status: Marked 未確定 and assigned to greenfield ('家族限定アクセス制御 … greenfield 実装時に MAS が決める');
  surfaced here for its gameplay-integrity implication
```

<!-- codd:finding
{"details": {"evidence": "論点7『取り消しの具体挙動（直近操作のみ戻せるのか／任意の問題を再開示できるのか等）は未確定』;『曖昧が残れば推測実装せず F028 で殿判断』", "status": "Known gap; requirements direct escalation via F028 rather than guessing"}, "id": "undo_action_scope_undefined", "kind": "known-undefined-behavior (flagged for escalation)", "name": "Undo (取り消し) concrete behavior is explicitly undefined", "question": "What exactly does the host 'undo' revert — only the most recent lock/open/settlement action, or arbitrary re-open/re-scoring of any past question? How does undo interact with the per-question progress state (b/c/d) and the automatic E-3残 re-scoring?", "rationale": "Undo is in scope from v1 and interacts with progress state and auto re-scoring; its scope must be pinned before implementation.", "related_requirement_ids": ["req:save-money-switcher-requirements"], "severity": "medium", "source": "greenfield"}
-->
## undo_action_scope_undefined - Undo (取り消し) concrete behavior is explicitly undefined

- approval: [ ] `undo_action_scope_undefined`
- id: `undo_action_scope_undefined`
- kind: `known-undefined-behavior (flagged for escalation)`
- severity: `medium`
- name: Undo (取り消し) concrete behavior is explicitly undefined
- question: What exactly does the host 'undo' revert — only the most recent lock/open/settlement action, or arbitrary re-open/re-scoring of any past question? How does undo interact with the per-question progress state (b/c/d) and the automatic E-3残 re-scoring?
- rationale: Undo is in scope from v1 and interacts with progress state and auto re-scoring; its scope must be pinned before implementation.
- related_requirement_ids: `req:save-money-switcher-requirements`

```yaml
evidence: 論点7『取り消しの具体挙動（直近操作のみ戻せるのか／任意の問題を再開示できるのか等）は未確定』;『曖昧が残れば推測実装せず F028 で殿判断』
status: Known gap; requirements direct escalation via F028 rather than guessing
```

<!-- codd:finding
{"details": {"evidence": "第三要件 TV a=出題動画; N-3 は 順送り/戻る/個別ジャンプ の『モード切替』のみ規定; N-2 フォールバック 動画→画像→テキスト", "gap": "Playback controls within mode a (play/pause/replay/autoplay/loop) are not defined; only mode switching is specified"}, "id": "question_video_playback_control_undefined", "kind": "presentation / control gap", "name": "Video playback control for TV mode a (出題動画) is unspecified", "question": "In mode a, does the question video autoplay, loop, or wait for a trigger? Can the host pause/replay/seek it, and is playback driven from the control panel? What is the relationship between video end and advancing from a to b?", "rationale": "Live hosting typically needs replay/pause control; absent this spec the question-presentation flow may be unusable in practice.", "related_requirement_ids": ["req:save-money-switcher-requirements"], "severity": "medium", "source": "greenfield"}
-->
## question_video_playback_control_undefined - Video playback control for TV mode a (出題動画) is unspecified

- approval: [ ] `question_video_playback_control_undefined`
- id: `question_video_playback_control_undefined`
- kind: `presentation / control gap`
- severity: `medium`
- name: Video playback control for TV mode a (出題動画) is unspecified
- question: In mode a, does the question video autoplay, loop, or wait for a trigger? Can the host pause/replay/seek it, and is playback driven from the control panel? What is the relationship between video end and advancing from a to b?
- rationale: Live hosting typically needs replay/pause control; absent this spec the question-presentation flow may be unusable in practice.
- related_requirement_ids: `req:save-money-switcher-requirements`

```yaml
evidence: 第三要件 TV a=出題動画; N-3 は 順送り/戻る/個別ジャンプ の『モード切替』のみ規定; N-2 フォールバック 動画→画像→テキスト
gap: Playback controls within mode a (play/pause/replay/autoplay/loop) are not defined;
  only mode switching is specified
```
