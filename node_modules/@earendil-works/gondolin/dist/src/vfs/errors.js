import { getSystemErrorName } from "util";
export function createErrnoError(errno, syscall, path) {
    let code = "EUNKNOWN";
    try {
        code = getSystemErrorName(errno);
    }
    catch {
        code = `ERRNO_${errno}`;
    }
    const message = path
        ? `${code}: ${syscall} '${path}'`
        : `${code}: ${syscall}`;
    const error = new Error(message);
    error.code = code;
    error.errno = errno;
    error.syscall = syscall;
    if (path)
        error.path = path;
    return error;
}
//# sourceMappingURL=errors.js.map