import { type ReadToolOptions } from "./read.ts";
export { type BashExecution, type BashPrepare, type BashToolInput, type BashToolOptions, createBashTool, createPowerShellTool, type PowerShellToolInput, type PowerShellToolOptions, } from "./bash.ts";
export { createEditTool, type EditToolDetails, type EditToolInput } from "./edit.ts";
export { DEFAULT_IMAGE_LIMITS, type ImageLimits, type ImageProcessor, type PreparedImage, } from "./image-processor.ts";
export { createReadTool, type ReadToolDetails, type ReadToolInput, type ReadToolOptions } from "./read.ts";
export { createWriteTool, type WriteToolInput } from "./write.ts";
/**
 * The `coding-tools` extension: `read`, `write`, `edit`, and `bash`; nothing installs it automatically.
 * `createPowerShellTool()` adds `powershell`. `images` prepares the images `read` returns (see `ReadToolOptions`).
 */
export declare function createCodingTools(options?: ReadToolOptions): import("../index.ts").Extension<import("../index.ts").ToolRegistration<import("typebox").TObject<{
    command: import("typebox").TString;
    timeout: import("typebox").TOptional<import("typebox").TNumber>;
}>> | import("../index.ts").ToolRegistration<import("typebox").TObject<{
    path: import("typebox").TString;
    content: import("typebox").TString;
}>> | import("../index.ts").ToolRegistration<import("typebox").TObject<{
    path: import("typebox").TString;
    edits: import("typebox").TArray<import("typebox").TObject<{
        oldText: import("typebox").TString;
        newText: import("typebox").TString;
    }>>;
}>, import("./edit.ts").EditToolDetails> | import("../index.ts").ToolRegistration<import("typebox").TObject<{
    path: import("typebox").TString;
    offset: import("typebox").TOptional<import("typebox").TNumber>;
    limit: import("typebox").TOptional<import("typebox").TNumber>;
}>, import("./read.ts").ReadToolDetails>>;
/** `createCodingTools()` without an image processor. */
export declare const CodingTools: import("../index.ts").Extension<import("../index.ts").ToolRegistration<import("typebox").TObject<{
    command: import("typebox").TString;
    timeout: import("typebox").TOptional<import("typebox").TNumber>;
}>> | import("../index.ts").ToolRegistration<import("typebox").TObject<{
    path: import("typebox").TString;
    content: import("typebox").TString;
}>> | import("../index.ts").ToolRegistration<import("typebox").TObject<{
    path: import("typebox").TString;
    edits: import("typebox").TArray<import("typebox").TObject<{
        oldText: import("typebox").TString;
        newText: import("typebox").TString;
    }>>;
}>, import("./edit.ts").EditToolDetails> | import("../index.ts").ToolRegistration<import("typebox").TObject<{
    path: import("typebox").TString;
    offset: import("typebox").TOptional<import("typebox").TNumber>;
    limit: import("typebox").TOptional<import("typebox").TNumber>;
}>, import("./read.ts").ReadToolDetails>>;
//# sourceMappingURL=index.d.ts.map