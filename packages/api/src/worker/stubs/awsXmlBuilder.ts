// Wrangler bundles for the browser platform, where the SDK's XML builder
// swaps its parser for one built on DOMParser; workerd has no DOM, so every
// S3 response carrying XML (multipart uploads, listings) failed to decode.
// The package's Node parser is dependency-free, so the Worker uses it by
// aliasing the package to this module.
export { XmlNode } from "@aws-sdk/xml-builder/dist-es/XmlNode.js";
export { XmlText } from "@aws-sdk/xml-builder/dist-es/XmlText.js";
export { parseXML } from "@aws-sdk/xml-builder/dist-es/xml-parser.js";
