// Fixed native sandbox request. User Markdown arrives only as a named byte buffer, never source code.
android.consumeNamedDataAsArrayBuffer('request').then(buffer => {
  const bytes = new Uint8Array(buffer), parts = [];
  let chunk = [];
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++];
    let point;
    if (first < 128) point = first;
    else if (first < 224) point = ((first & 31) << 6) | (bytes[i++] & 63);
    else if (first < 240) point = ((first & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else point = ((first & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    if (point <= 65535) chunk.push(point);
    else { point -= 65536; chunk.push(55296 + (point >> 10), 56320 + (point & 1023)); }
    if (chunk.length >= 4096) { parts.push(String.fromCharCode(...chunk)); chunk = []; }
  }
  parts.push(String.fromCharCode(...chunk));
  return EverplainDocumentDiff.diffJson(parts.join(''));
});
