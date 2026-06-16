declare module "*.u8" {
    // Loaded via esbuild "binary" loader → raw bytes (CRLF preserved).
    const content: Uint8Array;
    export default content;
}
declare module "*.idx" {
    const content: string;
    export default content;
}
