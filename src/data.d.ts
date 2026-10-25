declare module "*.u8" {
    // Raw CC-CEDICT text, embedded as a string literal (CRLF preserved).
    const content: string;
    export default content;
}
declare module "*.idx" {
    const content: string;
    export default content;
}
