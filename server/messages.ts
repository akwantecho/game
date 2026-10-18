import type { AccountView, ErrorCode } from "../shared/protocol";
import { BANK } from "./questions";
import { MAX_FAILURES, type Account, type LoginResult, type Store } from "./store";

/** Error messages shown to players, shared by the WebSocket hub and the app's HTTP API. */
export const ERRORS: Record<ErrorCode, string> = {
  bad_code: "الرمز غير صحيح. تأكد منه وأعد المحاولة.",
  room_full: "هذه الغرفة ممتلئة.",
  name_taken: "اختر اسماً مختلفاً عن اسم صاحب الغرفة.",
  bad_name: "اكتب اسمك أولاً.",
  session_lost: "انتهت الغرفة. أنشئ غرفة جديدة أو انضم إلى أخرى.",
  login_required: "سجّل الدخول أولاً.",
  bad_email: "اكتب بريداً إلكترونياً صحيحاً.",
  bad_pin_format: "الرمز 4 أرقام.",
  bad_pin: "الرمز غير صحيح.",
  locked: `أُقفل الحساب مؤقتاً بعد ${MAX_FAILURES} محاولات خاطئة.`,
  too_many: "محاولات كثيرة من هذا الجهاز. انتظر قليلاً ثم أعد المحاولة.",
  auth_lost: "انتهت جلسة الدخول. سجّل الدخول مرة أخرى.",
};

export const TOTAL_QUESTIONS = BANK.filter((q) => q.isActive).length;

export const accountView = (store: Store, a: Account): AccountView => ({
  email: a.email,
  name: a.name,
  seen: store.seenCount(a.id),
  total: TOTAL_QUESTIONS,
});

/** The code and message for a failed login, with attempts left or minutes to wait filled in. */
export function loginFailure(res: Exclude<LoginResult, { ok: true }>): { code: ErrorCode; message: string } {
  if (res.code === "bad_pin") return { code: res.code, message: `${ERRORS.bad_pin} بقيت لك ${res.left} ${res.left === 1 ? "محاولة" : "محاولات"}.` };
  if (res.code === "locked") return { code: res.code, message: `${ERRORS.locked} حاول بعد ${res.minutes} دقيقة.` };
  return { code: res.code, message: ERRORS[res.code] };
}
