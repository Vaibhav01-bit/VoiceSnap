const fs = require('fs');
const transparentPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const buffer = Buffer.from(transparentPngBase64, 'base64');
fs.writeFileSync('d:/sceernshotboom/icons/icon16.png', buffer);
fs.writeFileSync('d:/sceernshotboom/icons/icon48.png', buffer);
fs.writeFileSync('d:/sceernshotboom/icons/icon128.png', buffer);
console.log("Icons generated");
