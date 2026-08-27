/**
 * ログイン面 `/login` の描画（`module:auth`・設計 D4・surface_copy_obligations の作法に倣う）。
 *
 * 純粋なビュー投影であり、照合も設定解決も行わない。可視文言の義務:
 *   - 失敗理由の詳細を出さない。「ID が無い」と「パスワードが違う」を区別できる文言は、
 *     存在するログイン ID の探索を助けるため用いない（単一の平易文だけを出す・設計 D4）。
 *   - 内部ロール識別子（host/answerer/audience）・設定キー名・アクセス制御方式を露出しない。
 *   - パスワードは入力欄にも再表示しない（{@link LoginFieldSpec} は値を持たない）。
 */

/** ログイン面の見出し。 */
export const LOGIN_HEADING = "ログイン";

/** ログイン ID 入力欄の可視ラベル。 */
export const LOGIN_ID_LABEL = "ログインID";

/** パスワード入力欄の可視ラベル。 */
export const LOGIN_PASSWORD_LABEL = "パスワード";

/** 送信ボタンの可視ラベル。 */
export const LOGIN_SUBMIT_LABEL = "ログイン";

/** 照合失敗時の平易文（理由の詳細を出さない単一文言）。 */
export const LOGIN_FAILED_MESSAGE = "IDまたはパスワードが違います";

/** 保護面へ未認証で到達した者へ示す誘導文。 */
export const LOGIN_REQUIRED_MESSAGE = "この画面を開くにはログインが必要です";

/** 入力欄の用途。ログイン ID とパスワードの 2 つに限る。 */
export type LoginFieldPurpose = "login_id" | "password";

/** ログイン面の入力欄（値を保持しない構造だけの仕様）。 */
export interface LoginFieldSpec {
  readonly purpose: LoginFieldPurpose;
  readonly label: string;
  readonly control: "text" | "password";
}

/** ログイン面のビューモデル。 */
export interface LoginSurfaceViewModel {
  readonly heading: string;
  readonly fields: readonly LoginFieldSpec[];
  readonly submitLabel: string;
  /** 直前の照合失敗、または要ログイン誘導の平易文（無ければ持たない）。 */
  readonly message?: string;
  /** ログイン後に戻る先（保護面から誘導されたときのみ）。 */
  readonly redirectTo?: string;
}

/** ログイン面の描画入力。 */
export interface LoginSurfaceInput {
  /** 直前の送信が照合に失敗した。 */
  readonly failed?: boolean;
  /** 保護面から未認証で誘導されてきた。 */
  readonly loginRequired?: boolean;
  /** ログイン後に戻る先（同一オリジンの絶対パスのみ・呼出側が検証済み）。 */
  readonly redirectTo?: string;
}

/** ログイン面を描画する。失敗文言が要ログイン誘導文より優先される（直近の操作結果を優先）。 */
export function renderLoginSurface(input: LoginSurfaceInput = {}): LoginSurfaceViewModel {
  const message =
    input.failed === true
      ? LOGIN_FAILED_MESSAGE
      : input.loginRequired === true
        ? LOGIN_REQUIRED_MESSAGE
        : undefined;
  return {
    heading: LOGIN_HEADING,
    fields: [
      { purpose: "login_id", label: LOGIN_ID_LABEL, control: "text" },
      { purpose: "password", label: LOGIN_PASSWORD_LABEL, control: "password" },
    ],
    submitLabel: LOGIN_SUBMIT_LABEL,
    ...(message !== undefined ? { message } : {}),
    ...(input.redirectTo !== undefined ? { redirectTo: input.redirectTo } : {}),
  };
}
