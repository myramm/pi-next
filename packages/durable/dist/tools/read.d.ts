import { type Static, Type } from "typebox";
import type { ToolRegistration } from "../harness/types.ts";
import { type TruncationResult } from "../truncate.ts";
import { type ImageProcessor } from "./image-processor.ts";
declare const readSchema: Type.TObject<{
    path: Type.TString;
    offset: Type.TOptional<Type.TNumber>;
    limit: Type.TOptional<Type.TNumber>;
}>;
export type ReadToolInput = Static<typeof readSchema>;
export type ReadToolDetails = {
    /** How the shown text was cut; the text itself is the result content. */
    truncation?: Omit<TruncationResult, "content">;
};
export type ReadToolOptions = {
    /** Resizes and converts images; without one, images within `DEFAULT_IMAGE_LIMITS.maxBytes` pass through as they are. */
    readonly images?: ImageProcessor;
};
/**
 * Reads text files and images. Remarks about truncation, continuation, and image processing are diagnostics; the content
 * is only file text, or one image, which programs get as its `ImageContent`.
 */
export declare function createReadTool(options?: ReadToolOptions): ToolRegistration<typeof readSchema, ReadToolDetails>;
export {};
//# sourceMappingURL=read.d.ts.map