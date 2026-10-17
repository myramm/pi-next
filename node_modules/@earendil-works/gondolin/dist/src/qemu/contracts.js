/** internal marker for onRequest hooks safe for pre-body policy precheck */
export const ON_REQUEST_EARLY_POLICY_SAFE = Symbol.for("gondolin.http.onRequestEarlyPolicySafe");
const GUEST_CLOSED_MARKER = Symbol.for("gondolin.net.guestClosed");
export function createGuestClosedError() {
    const error = new Error("guest closed");
    error.name = "GuestClosedError";
    error[GUEST_CLOSED_MARKER] = true;
    return error;
}
export function isGuestClosedError(error) {
    let current = error;
    for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
        const candidate = current;
        if (candidate[GUEST_CLOSED_MARKER] === true) {
            return true;
        }
        current = candidate.cause;
    }
    return false;
}
//# sourceMappingURL=contracts.js.map