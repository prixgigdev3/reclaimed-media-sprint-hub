declare module "*.png" {
  // esbuild `base64` loader inlines the file as a base64-encoded string.
  // Decode with `Buffer.from(value, "base64")` at the use site.
  const data: string;
  export default data;
}
