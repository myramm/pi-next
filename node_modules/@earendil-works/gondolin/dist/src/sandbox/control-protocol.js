const OUTPUT_HEADER_BYTES = 5;
export function encodeOutputFrame(id, stream, data) {
    if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) {
        throw new RangeError("id must be a uint32");
    }
    const header = Buffer.alloc(OUTPUT_HEADER_BYTES);
    header.writeUInt8(stream === "stdout" ? 1 : 2, 0);
    header.writeUInt32BE(id, 1);
    return Buffer.concat([header, data]);
}
export function decodeOutputFrame(frame) {
    if (frame.length < OUTPUT_HEADER_BYTES) {
        throw new Error("output frame too short");
    }
    const streamFlag = frame.readUInt8(0);
    const stream = streamFlag === 1 ? "stdout" : "stderr";
    const id = frame.readUInt32BE(1);
    return {
        id,
        stream,
        data: frame.slice(OUTPUT_HEADER_BYTES),
    };
}
//# sourceMappingURL=control-protocol.js.map