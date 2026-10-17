/** `conflict: "error"` rejects two objects registering one key; `"last"` keeps the later registration. */
export const defineRegistry = (name, options = {}) => ({
    name,
    conflict: options.conflict ?? "error",
});
//# sourceMappingURL=registry.js.map