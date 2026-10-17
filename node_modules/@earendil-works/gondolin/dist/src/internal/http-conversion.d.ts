import type { InternalHttpRequest, InternalHttpResponse, InternalHttpResponseHeaders } from "./http-types.js";
type RequestLike = Pick<Request, "url" | "method" | "headers" | "body"> & {
    arrayBuffer?: () => Promise<ArrayBuffer>;
};
type ResponseLike = Pick<Response, "status" | "statusText" | "headers" | "body"> & {
    arrayBuffer?: () => Promise<ArrayBuffer>;
};
export declare function webRequestToInternalHttpRequest(value: RequestLike, options: {
    allowBody: boolean;
    maxBodyBytes: number | null;
}): Promise<InternalHttpRequest>;
export declare function webResponseToInternalHttpResponse(value: ResponseLike, options: {
    maxBodyBytes: number | null;
}): Promise<InternalHttpResponse>;
export declare function responseHeadersToRecord(headers: Headers): InternalHttpResponseHeaders;
export declare function internalHttpRequestToWebRequest(request: InternalHttpRequest): Request;
export declare function internalHttpResponseToWebResponse(response: InternalHttpResponse): Response;
export {};
//# sourceMappingURL=http-conversion.d.ts.map